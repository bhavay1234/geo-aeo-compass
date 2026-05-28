import { pollChatGPT } from '../llm/openai-client';
import { parseCitations } from './citation-parser';
import { classifySource, competitorToDomain } from './source-classifier';
import { buildSuggestion } from './suggestion-engine';
import { getSupabaseAdmin } from '../db/supabase';
import { finalizeAuditFast, enrichAudit } from './orchestrator';
import { analyzeCitations } from './citation-analysis';
import type { Citation, InlineCitation } from '../db/types';
import type { Env, AuditQueueMessage } from '../db/supabase';

/**
 * Shape of a Cloudflare queue message. We only need `body`; ack/retry
 * are called on the MessageBatch in src/server.ts.
 */
export interface QueueMessageLike<T> {
  body: T;
}

/** Case-insensitive whole-word match. Used for uncited mention detection. */
function mentionsWord(text: string, word: string): boolean {
  const w = word.trim();
  if (!text || !w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Consumer for the audit-jobs queue. Cloudflare delivers up to
 * `max_batch_size` (3) messages per invocation; we process them in
 * parallel, save each poll_result, atomically bump progress_done,
 * and finalize any audits that hit progress_done >= progress_total
 * inside this batch.
 *
 * Errors on individual queries are caught locally so one bad query
 * doesn't poison a batch ack. If the whole batch throws (e.g. Supabase
 * is down), src/server.ts calls batch.retryAll().
 */
export async function processQueueBatch(
  messages: Array<QueueMessageLike<AuditQueueMessage>>,
  env: Env
): Promise<void> {
  const supabase = getSupabaseAdmin(env);
  const auditIdsToCheck = new Set<string>();

  await Promise.allSettled(
    messages.map(async (msg) => {
      const { audit_id, query_text, query_category } = msg.body;

      // Dedicated post-finalize stage: citation/why-cited analysis for the whole
      // audit. Runs in its own queue invocation (fresh CPU budget), not a query.
      if (msg.body.kind === 'citations') {
        try {
          await analyzeCitations(audit_id, env);
        } catch (err: any) {
          console.error(`[queue] citation analysis failed for ${audit_id}:`, err?.message || err);
        }
        return;
      }

      auditIdsToCheck.add(audit_id);

      try {
        const { data: audit, error: auditErr } = await supabase
          .from('audits')
          .select('*')
          .eq('id', audit_id)
          .single();

        if (auditErr || !audit) {
          console.error(`[queue] audit ${audit_id} not found:`, auditErr);
          return;
        }

        const competitorList = (audit.competitors as string[]) || [];

        const result = await pollChatGPT(query_text, env);
        console.log(
          '[citations]',
          result.citations.length,
          'for',
          query_text.slice(0, 40)
        );

        const citation = parseCitations(
          result.response_text,
          audit.brand_name,
          audit.domain,
          competitorList
        );

        // Classify each web-search citation, then build the deterministic
        // per-query suggestion from the classified set + brand result.
        const competitorDomains = competitorList.map(competitorToDomain);
        const classify = (domain: string) =>
          classifySource(domain, { brandDomain: audit.domain, competitorDomains });

        const enrichedCitations: Citation[] = result.citations.map((c) => ({
          url: c.url,
          title: c.title,
          domain: c.domain,
          source_type: classify(c.domain),
        }));

        // Faithful inline trail — ordered, un-deduped, anchor text + source_type.
        const rawCitations: InlineCitation[] = result.raw_citations.map((rc) => ({
          ...rc,
          source_type: classify(rc.domain),
        }));

        const suggestion = buildSuggestion({
          query: query_text,
          brand_cited: citation.brand_cited,
          brand_position: citation.brand_position,
          citations: enrichedCitations,
        });

        // Uncited-mention signals: the model named the brand/competitor in the
        // answer text but no formal citation backed it. Distinct from brand_cited.
        const fullResponse = result.response_text || '';
        const brandMentionedUncited =
          mentionsWord(fullResponse, audit.brand_name) && !citation.brand_cited;

        const citedCompNames = new Set(
          citation.competitors_cited.map((c) => c.name)
        );
        const competitorsMentionedUncited = competitorList.filter(
          (comp) => mentionsWord(fullResponse, comp) && !citedCompNames.has(comp)
        );

        console.log(
          '[raw-cit]',
          rawCitations.length,
          'uncited-brand:',
          brandMentionedUncited,
          'for',
          query_text.slice(0, 30)
        );

        await supabase.from('poll_results').insert({
          audit_id,
          query_text,
          query_category,
          llm_source: 'openai',
          raw_response: fullResponse.slice(0, 5000),
          full_response: fullResponse,
          brand_cited: citation.brand_cited,
          brand_position: citation.brand_position,
          brand_mentioned_uncited: brandMentionedUncited,
          competitors_cited: citation.competitors_cited,
          competitors_mentioned_uncited: competitorsMentionedUncited,
          citations: enrichedCitations,
          raw_citations: rawCitations,
          suggestion,
        });

        // Atomic counter bump via Postgres function — avoids the read/write
        // race that would happen if we SELECT then UPDATE across parallel
        // consumer workers.
        await supabase.rpc('increment_progress', {
          audit_id_param: audit_id,
        });

        console.log(`[queue] processed: ${query_text.slice(0, 60)}`);
      } catch (err: any) {
        console.error(
          `[queue] error processing query "${query_text}":`,
          err?.message || err
        );
      }
    })
  );

  // After all messages in this batch are persisted, check each touched audit
  // for completion. The last consumer that bumps progress_done to total runs
  // the finalize. If two consumers race and both see the threshold, the
  // second one's update is a harmless no-op (status flip is idempotent).
  for (const auditId of auditIdsToCheck) {
    const { data: audit } = await supabase
      .from('audits')
      .select('*')
      .eq('id', auditId)
      .single();

    if (!audit) continue;
    if (audit.status === 'completed' || audit.status === 'failed') continue;
    if ((audit.progress_done ?? 0) < (audit.progress_total ?? 0)) continue;

    // Two-phase finalize. FAST: a CAS claim (running → finalizing) flips the
    // audit to 'completed' with deterministic data so the UI unblocks
    // immediately — only the CAS winner proceeds (no double-finalize). ENRICH:
    // the LLM step (positioning + per-query suggestions + competitor
    // reclassification) patches the rows in place; the UI upgrades tiers live.
    const claimed = await finalizeAuditFast(auditId, env);
    if (claimed) {
      await enrichAudit(auditId, env);
      // Kick off citation analysis in its own queue invocation — enrich has
      // written citation_roles by now, which the vendor/competitor split needs.
      try {
        await env.AUDIT_QUEUE.send({
          audit_id: auditId,
          query_text: '',
          query_category: '',
          query_index: -1,
          kind: 'citations',
        });
      } catch (err: any) {
        console.error(`[queue] failed to enqueue citations for ${auditId}:`, err?.message || err);
      }
    }
  }
}
