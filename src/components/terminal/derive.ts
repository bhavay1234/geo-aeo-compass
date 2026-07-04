import type {
  Audit,
  PollResult,
  Citation,
  CitationAnalysisEntry,
  DecisiveFactor,
  LlmSource,
} from "@/lib/db/types";
import {
  normalizeDomain,
  competitorToDomain,
  citationCategory,
  CITATION_CATEGORY_META,
  type CitationCategory,
} from "@/lib/audit/source-classifier";
import { isBrandLike, brandInProse } from "@/lib/audit/prose-brands";

export interface CitationCategoryGroup {
  key: CitationCategory;
  label: string;
  entries: CitationAnalysisEntry[];
  total: number;
  /** Sources in this category where the brand does NOT appear (the worklist). */
  missing: number;
}

/** Domains of the audited brand's REAL rivals — the tracked competitors plus
 *  the intent+feature classified competitor_brands (real domains). Deliberately
 *  EXCLUDES discovered_competitors: that's a loose per-citation "competitor"
 *  label (100s of domains) that would flood the Competitors bucket with every
 *  vendor/listicle the LLM happened to tag. Lets cited rival sites bucket into
 *  "Competitors" instead of the generic "Vendor" pile — accurately. */
export function competitorDomainSet(audit: Audit): Set<string> {
  const s = new Set<string>();
  for (const c of audit.competitors ?? []) {
    const d = normalizeDomain(competitorToDomain(c));
    if (d) s.add(d);
  }
  for (const c of audit.insights?.competitor_brands ?? []) {
    const d = normalizeDomain(c.domain || competitorToDomain(c.name));
    if (d) s.add(d);
  }
  return s;
}

/**
 * Club the cited-source rollup into the 10 buyer-facing categories. Categories
 * are ordered most-cited first; within each, missing-you sources lead (the
 * get-listed worklist), then by cross-query cite count.
 */
export function categorizeCitations(
  audit: Audit,
  entries: CitationAnalysisEntry[]
): CitationCategoryGroup[] {
  const compDomains = competitorDomainSet(audit);
  const groups = new Map<CitationCategory, CitationAnalysisEntry[]>();
  for (const e of entries) {
    // For Gemini, e.url is the vertexaisearch proxy; the real deep path lives in
    // resolved_url. Category detection (listicle/review URL patterns) must run on
    // the resolved URL or every Gemini source falls through to 'vendor'.
    const cat = citationCategory(e.resolved_url || e.url, e.domain, e.source_type, compDomains);
    const arr = groups.get(cat);
    if (arr) arr.push(e);
    else groups.set(cat, [e]);
  }
  return Array.from(groups.entries())
    .map(([key, es]) => ({
      key,
      label: CITATION_CATEGORY_META[key].label,
      total: es.length,
      missing: es.filter((e) => !e.brand_present).length,
      entries: es
        .slice()
        .sort(
          (a, b) =>
            Number(a.brand_present) - Number(b.brand_present) ||
            b.query_count - a.query_count ||
            (b.llms_citing?.length ?? 0) - (a.llms_citing?.length ?? 0)
        ),
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        CITATION_CATEGORY_META[a.key].order - CITATION_CATEGORY_META[b.key].order
    );
}

export type QueryState = "absent" | "weak" | "held";

export const ALL_LLMS: LlmSource[] = ["chatgpt", "perplexity", "gemini"];

/** Normalize legacy 'openai' rows to 'chatgpt' so LLM buckets don't split. */
export function normalizeLlm(s: string | null | undefined): LlmSource {
  if (s === "perplexity" || s === "gemini") return s;
  return "chatgpt";
}

/** LLMs actually polled for this audit (denominator for cross-LLM signals). */
export function llmsPolled(audit: Audit): LlmSource[] {
  const raw = audit.llms_polled ?? [];
  const clean = raw.filter((l): l is LlmSource =>
    l === "chatgpt" || l === "perplexity" || l === "gemini"
  );
  return clean.length > 0 ? clean : ["chatgpt"];
}

/** Per-poll state: absent (not cited), weak (cited but rank > 2), held (rank ≤ 2). */
export function queryState(p: Pick<PollResult, "brand_cited" | "brand_position">): QueryState {
  if (!p.brand_cited) return "absent";
  if ((p.brand_position ?? 99) > 2) return "weak";
  return "held";
}

/** Aggregate query state across all LLMs that were polled for it.
 *  held = cited-well in ALL LLMs · weak = cited in some / cited-low · absent = cited in NONE. */
export function aggregateQueryState(perPoll: QueryState[], nLlmsPolled: number): QueryState {
  if (perPoll.length === 0) return "absent";
  const held = perPoll.filter((s) => s === "held").length;
  const cited = perPoll.filter((s) => s !== "absent").length;
  if (cited === 0) return "absent";
  if (held === perPoll.length && perPoll.length === nLlmsPolled) return "held";
  return "weak";
}

export type SourceTagKind = "you" | "comp" | "agg" | "ed";

/** Tag a citation Comp/Agg/Ed/You, preferring the per-query LLM role judgment. */
export function tagSource(
  c: Citation,
  ownDomain: string,
  namedNorm: Set<string>,
  competitorJudged: Set<string>
): { kind: SourceTagKind; subtype: string } {
  const d = normalizeDomain(c.domain);
  const own = normalizeDomain(ownDomain);
  if (own && (d === own || d.endsWith("." + own))) return { kind: "you", subtype: "your site" };
  if (
    namedNorm.has(d) ||
    competitorJudged.has(d) ||
    c.source_type === "competitor"
  )
    return { kind: "comp", subtype: "vendor" };
  if (c.source_type === "review_directory") return { kind: "agg", subtype: "review dir" };
  if (c.source_type === "analyst") return { kind: "agg", subtype: "analyst" };
  if (c.source_type === "editorial") return { kind: "ed", subtype: "editorial" };
  return { kind: "agg", subtype: "source" };
}

/**
 * Same-industry competitor domains cited in ONE answer, decided by the
 * per-query LLM role judgment (citation_roles) plus the discovered_in_query
 * competitor label — NOT a static vendor-domain guess. Returns normalized
 * domains.
 */
export function competitorDomainsInPoll(p: PollResult): Set<string> {
  const out = new Set<string>();
  for (const r of p.citation_roles ?? []) {
    if (r.role !== "competitor") continue;
    const d = normalizeDomain(r.domain);
    if (d) out.add(d);
  }
  for (const d of p.discovered_in_query ?? []) {
    if (d.label !== "competitor") continue;
    const nd = normalizeDomain(d.domain);
    if (nd) out.add(nd);
  }
  return out;
}

/**
 * Competitor brands ChatGPT NAMED in ONE answer's prose (excl. the audited
 * brand). The real competitor signal: union of tracked-list prose matches
 * (competitors_cited) + the LLM-extracted brands_named. NOT cited domains —
 * those are sources, tagged separately via tagSource.
 */
/** Brand-name match tolerant of product variants: "Oracle" ~ "Oracle
 *  Transportation Management", "Descartes" ~ "Descartes MacroPoint". Word-
 *  boundary prefix/suffix only (not loose substring) to avoid "ori" ~ "category".
 *  Lets a consolidated parent brand aggregate its variant mentions. */
export function brandMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return (
    x.startsWith(y + " ") ||
    y.startsWith(x + " ") ||
    x.endsWith(" " + y) ||
    y.endsWith(" " + x)
  );
}

/**
 * Merge product-variant brand names to ONE canonical (the shortest/parent form),
 * so "Descartes MacroPoint" and "Descartes" collapse to "Descartes" instead of
 * double-counting as two competitors. Returns lowercased-name → canonical
 * display. Uses the same word-boundary variant rule as brandMatches.
 */
export function buildBrandCanonicalizer(names: string[]): Map<string, string> {
  const uniq = Array.from(
    new Set(names.map((n) => (n || "").trim()).filter(Boolean))
  ).sort((a, b) => a.length - b.length); // shortest first → parents win
  const reps: string[] = [];
  for (const nm of uniq) if (!reps.some((r) => brandMatches(r, nm))) reps.push(nm);
  const map = new Map<string, string>();
  for (const nm of uniq) {
    const rep = reps.find((r) => brandMatches(r, nm)) ?? nm;
    map.set(nm.toLowerCase(), rep);
  }
  return map;
}

/** Collapse a list of brand names, merging product variants to their parent. */
export function dedupeBrandVariants(names: string[]): string[] {
  const canon = buildBrandCanonicalizer(names);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const nm of names) {
    const rep = canon.get((nm || "").trim().toLowerCase());
    if (!rep) continue;
    const k = rep.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(rep);
  }
  return out;
}

export function recommendedBrands(p: PollResult, ownName: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const own = (ownName || "").trim().toLowerCase();
  const add = (name: string) => {
    const nm = (name || "").trim();
    const key = nm.toLowerCase();
    if (!nm || key === own || seen.has(key)) return;
    seen.add(key);
    out.push(nm);
  };
  for (const c of p.competitors_cited ?? []) add(c.name);
  // brands_named must actually appear in the answer — the LLM occasionally
  // invents rivals on educational answers ("recommended instead of you" with
  // brands never in the text). Verify against the prose before counting them.
  for (const b of p.brands_named ?? [])
    if (isBrandLike(b) && brandInProse(b, p.full_response)) add(b);
  return out;
}

/** Competitor brands recommended in a query (excl. own) — the gap-row signal. */
export function whoCited(p: PollResult, ownName: string): string[] {
  return recommendedBrands(p, ownName);
}

export interface InfluenceRollup {
  queriesNamed: number;
  totalQueries: number;
  dominant: DecisiveFactor;
  topSources: string[]; // domains most consistently driving the mentions
  youInSourcesCount: number; // # of those driving source-domains we also appear in
}

/** Audit-wide influence summary for one competitor brand (Competitors tab).
 *  Counts DISTINCT QUERIES (not polls) — a multi-LLM audit has N polls per
 *  query, and "named in 6/8 queries" must not inflate to 18/24. */
export function influenceRollup(
  polls: PollResult[],
  brandName: string
): InfluenceRollup | null {
  const bl = brandName.toLowerCase();
  const factorTally: Record<string, number> = {};
  const srcCount = new Map<string, number>();
  const compDomains = new Set<string>();
  const youDomains = new Set<string>();
  const namedQueries = new Set<string>();

  const groups = groupPollsByQuery(polls);
  for (const [query, group] of groups) {
    for (const p of group) {
      for (const s of p.own_page?.named_in_sources ?? []) youDomains.add(s.domain);
      const w = (p.why_cited ?? []).find((x) => x.brand.toLowerCase() === bl);
      if (!w) continue;
      namedQueries.add(query);
      factorTally[w.decisive] = (factorTally[w.decisive] ?? 0) + 1;
      for (const s of w.named_in_sources) {
        srcCount.set(s.domain, (srcCount.get(s.domain) ?? 0) + 1);
        compDomains.add(s.domain);
      }
    }
  }
  if (namedQueries.size === 0) return null;
  const topSources = Array.from(srcCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([d]) => d);
  const dominant = (Object.entries(factorTally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "citations") as DecisiveFactor;
  let youInSourcesCount = 0;
  for (const d of compDomains) if (youDomains.has(d)) youInSourcesCount++;
  return {
    queriesNamed: namedQueries.size,
    totalQueries: groups.size,
    dominant,
    topSources,
    youInSourcesCount,
  };
}

/** Unique competitor brands surfaced across the run (named + discovered).
 *  Mirrors the Competitors-tab logic so the tab COUNT matches the cards:
 *  tracked competitors always count; discovered ones need >= 2 distinct queries
 *  (recurrence) to count, so a single-mention long-tail doesn't inflate it. */
export function allCompetitorBrands(audit: Audit, polls: PollResult[]): string[] {
  // Preferred: the intent+feature classification (tracked competitors + the
  // classified rivals, already consolidated) — no recurrence gate, so real
  // one-mention rivals are kept and wrong-category noise is already dropped.
  const classified = audit.insights?.competitor_brands ?? [];
  if (classified.length > 0) {
    const out = [...(audit.competitors ?? [])];
    const seen = new Set(out.map((n) => n.toLowerCase()));
    for (const c of classified) {
      const k = c.name.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c.name);
      }
    }
    // Collapse product variants ("Descartes MacroPoint" → "Descartes") the LLM
    // classifier may have missed — never list the same competitor twice.
    return dedupeBrandVariants(out);
  }
  // Fallback (OpenAI-off / pre-classifier audits): recurrence >= 2 distinct
  // queries; tracked competitors always count.
  const namedLower = new Set(
    (audit.competitors ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)
  );
  const rec = new Map<string, { display: string; queries: Set<string> }>();
  for (const p of polls) {
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const k = nm.toLowerCase();
      const ex = rec.get(k);
      if (ex) ex.queries.add(p.query_text);
      else rec.set(k, { display: nm, queries: new Set([p.query_text]) });
    }
  }
  const out: string[] = [];
  for (const [k, v] of rec) {
    if (namedLower.has(k) || v.queries.size >= 2) out.push(v.display);
  }
  return out;
}

export interface LlmCell {
  llm: LlmSource;
  cited: boolean;
  position: number | null;
}

export interface GapRow {
  id: string; // canonical: query_text
  query: string;
  /** Aggregate state across every LLM polled for this query. */
  state: QueryState;
  /** Best (min) position across LLMs where cited; null if absent everywhere. */
  position: number | null;
  citedCount: number;
  /** Union of recommended competitor brands across all LLM rows. */
  who: string[];
  /** Per-LLM state row (missing LLMs shown as absent). */
  perLlm: LlmCell[];
  citedLlms: LlmSource[];
  absentLlms: LlmSource[];
  rankScore: number;
}

const STATE_WEIGHT: Record<QueryState, number> = { absent: 3, weak: 2, held: 1 };

/** Group poll_results by unique query_text — one entry per query, all LLM rows. */
export function groupPollsByQuery(polls: PollResult[]): Map<string, PollResult[]> {
  const out = new Map<string, PollResult[]>();
  for (const p of polls) {
    const key = p.query_text;
    const arr = out.get(key);
    if (arr) arr.push(p);
    else out.set(key, [p]);
  }
  return out;
}

/**
 * Rank gaps by "lost demand" across LLMs. One row per query (aggregate); each
 * row carries per-LLM cited/absent so the UI can render "invisible in X, cited
 * in Y" chips. Absent-everywhere ranks highest. No fake /mo figures.
 */
export function buildGapRows(audit: Audit, polls: PollResult[]): GapRow[] {
  const llms = llmsPolled(audit);
  const groups = groupPollsByQuery(polls);
  const rows: GapRow[] = [];

  for (const [query, group] of groups) {
    const byLlm = new Map<LlmSource, PollResult>();
    for (const p of group) byLlm.set(normalizeLlm(p.llm_source), p);

    const perLlm: LlmCell[] = llms.map((llm) => {
      const p = byLlm.get(llm);
      return {
        llm,
        cited: !!p?.brand_cited,
        position: p?.brand_position ?? null,
      };
    });
    const citedLlms = perLlm.filter((c) => c.cited).map((c) => c.llm);
    const absentLlms = perLlm.filter((c) => !c.cited).map((c) => c.llm);
    const positions = perLlm
      .map((c) => c.position)
      .filter((n): n is number => typeof n === "number");
    const position = positions.length ? Math.min(...positions) : null;

    const perPollState = group.map(queryState);
    const state = aggregateQueryState(perPollState, llms.length);

    // Union recommended brands across all LLM rows for this query.
    const whoSet = new Set<string>();
    const who: string[] = [];
    for (const p of group) {
      for (const nm of recommendedBrands(p, audit.brand_name)) {
        const k = nm.toLowerCase();
        if (!whoSet.has(k)) {
          whoSet.add(k);
          who.push(nm);
        }
      }
    }
    // Distinct cited source URLs across LLM rows.
    const urlSet = new Set<string>();
    for (const p of group) for (const c of p.citations ?? []) if (c.url) urlSet.add(c.url);
    const citedCount = urlSet.size;

    const rankScore =
      STATE_WEIGHT[state] * 1000 + absentLlms.length * 200 + who.length * 25 + citedCount;

    rows.push({
      id: query,
      query,
      state,
      position,
      citedCount,
      who,
      perLlm,
      citedLlms,
      absentLlms,
      rankScore,
    });
  }

  return rows.sort((a, b) => b.rankScore - a.rankScore);
}

export interface SovEntry {
  name: string;
  domain: string | null;
  count: number;
  pct: number;
  isYou: boolean;
}

/**
 * Share of RECOMMENDATIONS across queries — the share a buyer understands:
 * "of all the products the LLMs collectively name, how often is it you vs each
 * competitor?" One count per (brand, query) — named in any LLM = one point, so
 * being named in all 3 LLMs for one query doesn't triple-count. Cross-LLM
 * aggregate; use `computeShareOfVoiceByLlm` for per-LLM comparison.
 */
export function computeShareOfVoice(audit: Audit, polls: PollResult[]): SovEntry[] {
  const counts = new Map<string, { name: string; domain: string | null; count: number; isYou: boolean }>();
  const bump = (key: string, name: string, domain: string | null, isYou: boolean) => {
    const ex = counts.get(key);
    if (ex) ex.count++;
    else counts.set(key, { name, domain, count: 1, isYou });
  };

  const groups = groupPollsByQuery(polls);
  // Canonicalize brand variants across the WHOLE audit first, so "Descartes
  // MacroPoint" and "Descartes" count as one competitor everywhere.
  const allNames: string[] = [...(audit.competitors ?? [])];
  for (const [, group] of groups)
    for (const p of group)
      for (const nm of recommendedBrands(p, audit.brand_name)) allNames.push(nm);
  const canon = buildBrandCanonicalizer(allNames);
  const canonOf = (nm: string) => canon.get((nm || "").trim().toLowerCase()) ?? nm.trim();

  for (const [, group] of groups) {
    const youCited = group.some((p) => p.brand_cited);
    if (youCited) bump("__you__", audit.brand_name, audit.domain, true);
    // Dedupe recommended brands WITHIN a query so cross-LLM overlap doesn't
    // triple-count (named in all 3 LLMs → 1 point). lower → display casing.
    const perQueryBrands = new Map<string, string>();
    for (const p of group) {
      for (const nm of recommendedBrands(p, audit.brand_name)) {
        const c = canonOf(nm);
        const k = c.toLowerCase();
        if (!perQueryBrands.has(k)) perQueryBrands.set(k, c);
      }
    }
    for (const [, nm] of perQueryBrands) {
      const orig =
        (audit.competitors ?? []).find((c) => c.toLowerCase() === nm.toLowerCase()) ||
        nm;
      bump("name:" + nm.toLowerCase(), orig, competitorToDomain(orig), false);
    }
  }

  const total = Array.from(counts.values()).reduce((s, e) => s + e.count, 0) || 1;
  return Array.from(counts.values())
    .map((e) => ({ ...e, pct: Math.round((e.count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

/** Per-LLM Share of Recommendations — one SoV list per LLM (for the demo
 *  "who's nastier: ChatGPT or Perplexity" comparison bars). */
export interface LlmScorecard {
  llm: LlmSource;
  /** Answers actually captured from this LLM (rows). */
  answers: number;
  /** Queries polled — answers may be lower if some polls failed. */
  expected: number;
  /** Answers where the brand is NAMED in the answer text ("prompt presence"). */
  namedIn: number;
  /** Answers where the brand's own domain appears in the CITATIONS rail. */
  citedIn: number;
  /** Per-LLM visibility score: named-in-answer share of captured answers. */
  visibility: number;
  /** Per-LLM share of recommendations (top entries, you included). */
  sov: SovEntry[];
}

/**
 * One scorecard per polled LLM — the "don't merge the LLMs" view. Visibility,
 * prompt-presence (named in the answer) vs citation-presence (your domain in
 * the sources rail), and per-LLM share of recommendations, each computed over
 * ONLY that LLM's answers.
 */
export function buildLlmScorecards(audit: Audit, polls: PollResult[]): LlmScorecard[] {
  const expected = groupPollsByQuery(polls).size;
  const ownNorm = normalizeDomain(audit.domain);
  return llmsPolled(audit).map((llm) => {
    const subset = polls.filter((p) => normalizeLlm(p.llm_source) === llm);
    const namedIn = subset.filter((p) => p.brand_cited).length;
    const citedIn = subset.filter((p) =>
      (p.citations ?? []).some((c) => {
        if (c.source_type === "own") return true;
        const d = normalizeDomain(c.domain);
        return !!ownNorm && (d === ownNorm || d.endsWith("." + ownNorm));
      })
    ).length;
    return {
      llm,
      answers: subset.length,
      expected,
      namedIn,
      citedIn,
      visibility: subset.length ? Math.round((namedIn / subset.length) * 100) : 0,
      sov: computeShareOfVoice(audit, subset).slice(0, 4),
    };
  });
}

export function computeShareOfVoiceByLlm(
  audit: Audit,
  polls: PollResult[]
): Record<LlmSource, SovEntry[]> {
  const out = {} as Record<LlmSource, SovEntry[]>;
  for (const llm of llmsPolled(audit)) {
    const subset = polls.filter((p) => normalizeLlm(p.llm_source) === llm);
    out[llm] = computeShareOfVoice(audit, subset);
  }
  return out;
}

export interface BrandConsensus {
  brand: string;
  /** Number of distinct queries where the brand was named in at least one LLM. */
  queriesNamed: number;
  /** Number of distinct LLMs (across the whole audit) that ever named it. */
  llmsNaming: LlmSource[];
  /** Per-LLM count of queries where this LLM named the brand. */
  byLlm: Record<LlmSource, number>;
}

/** Cross-LLM consensus for a single brand — powers the "named by N/M LLMs"
 *  chip on Summary + Competitors. Excludes the audited brand automatically. */
export function brandConsensus(
  audit: Audit,
  polls: PollResult[],
  brandName: string
): BrandConsensus {
  const llms = llmsPolled(audit);
  const groups = groupPollsByQuery(polls);
  const byLlm = Object.fromEntries(llms.map((l) => [l, 0])) as Record<LlmSource, number>;
  const llmsNamingSet = new Set<LlmSource>();
  let queriesNamed = 0;

  for (const [, group] of groups) {
    let namedThisQuery = false;
    const seenLlms = new Set<LlmSource>();
    for (const p of group) {
      const named = recommendedBrands(p, audit.brand_name).some((n) =>
        brandMatches(n, brandName)
      );
      if (!named) continue;
      const llm = normalizeLlm(p.llm_source);
      if (!seenLlms.has(llm)) {
        byLlm[llm] = (byLlm[llm] ?? 0) + 1;
        seenLlms.add(llm);
        llmsNamingSet.add(llm);
      }
      namedThisQuery = true;
    }
    if (namedThisQuery) queriesNamed++;
  }

  return {
    brand: brandName,
    queriesNamed,
    llmsNaming: llms.filter((l) => llmsNamingSet.has(l)),
    byLlm,
  };
}

export interface ProfileSource {
  domain: string;
  kind: SourceTagKind;
  subtype: string;
  count: number;
}

export interface CompetitorProfile {
  name: string;
  domain: string | null;
  isYou: boolean;
  /** Competitor surfaced by role judgment but not on the tracked list. */
  discovered: boolean;
  sovPct: number;
  tier: 1 | 2 | 3;
  /** Same-category classification from intent+features judgment, when available:
   *  'direct' rival vs 'adjacent' cross-shopped neighbor. undefined = you / not classified. */
  category_tier?: "direct" | "adjacent";
  verdict: string;
  strengths: string[];
  beatsYou: string[];
  sources: ProfileSource[];
  /** Cross-LLM consensus: which LLMs named this brand + per-LLM query counts. */
  consensus: BrandConsensus;
}

function tierForPct(pct: number): 1 | 2 | 3 {
  if (pct >= 20) return 1;
  if (pct >= 8) return 2;
  return 3;
}

/** Does this poll NAME the given brand as an answer (prose-based)? */
function pollRecommends(
  p: PollResult,
  isYou: boolean,
  name: string,
  ownName: string
): boolean {
  if (isYou) return p.brand_cited;
  // Fuzzy so a consolidated parent brand ("Oracle") aggregates its variant
  // mentions ("Oracle Transportation Management") into one profile.
  return recommendedBrands(p, ownName).some((b) => brandMatches(b, name));
}

/**
 * Full competitor profiles for the Competitors tab — the user's brand pinned
 * first, then competitors by share of voice. All derived from poll_results +
 * the batched verdicts; nothing fabricated.
 */
export function buildCompetitorProfiles(
  audit: Audit,
  polls: PollResult[]
): CompetitorProfile[] {
  const ownNorm = normalizeDomain(audit.domain);
  const namedNorm = new Set(
    (audit.competitors ?? []).map((c) => normalizeDomain(c)).filter(Boolean)
  );
  const namedLower = new Set(
    (audit.competitors ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)
  );

  // Source-rail tagging only: which CITED DOMAINS are competitor-owned (from the
  // per-query LLM role judgments). Kept separate from the competitor brand list.
  const competitorJudged = new Set<string>([
    ...(audit.discovered_competitors ?? [])
      .filter((d) => d.label === "competitor")
      .map((d) => normalizeDomain(d.domain)),
  ]);
  for (const p of polls) {
    for (const dom of competitorDomainsInPoll(p)) competitorJudged.add(dom);
  }

  // Discovered competitor BRANDS. Preferred: the intent+feature classification
  // (audit.insights.competitor_brands) — genuine same-category rivals judged by
  // what they ARE, consolidated to parent brand, wrong-category noise already
  // dropped; a real rival named in ONE query still surfaces. Fallback for
  // OpenAI-off / pre-classifier audits: recurrence >= 2 distinct queries.
  const classified = audit.insights?.competitor_brands ?? [];
  const tierByKey = new Map<string, "direct" | "adjacent">();
  const domainByName = new Map<string, string | undefined>();
  for (const c of classified) {
    tierByKey.set(c.name.toLowerCase(), c.tier);
    domainByName.set(c.name.toLowerCase(), c.domain);
  }

  const recAll = new Map<string, { display: string; queries: Set<string> }>();
  for (const p of polls) {
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const k = nm.toLowerCase();
      const ex = recAll.get(k);
      if (ex) ex.queries.add(p.query_text);
      else recAll.set(k, { display: nm, queries: new Set([p.query_text]) });
    }
  }
  const DISCOVERED_MIN_QUERIES = 2;

  const verdictByKey = new Map<string, string>();
  for (const v of audit.competitor_verdicts ?? []) {
    verdictByKey.set(v.name.toLowerCase(), v.verdict);
    if (v.domain) verdictByKey.set(normalizeDomain(v.domain), v.verdict);
  }

  const sov = computeShareOfVoice(audit, polls);
  const sovByKey = new Map<string, number>();
  for (const s of sov) {
    if (s.isYou) sovByKey.set("__you__", s.pct);
    else {
      sovByKey.set(s.name.toLowerCase(), s.pct);
      if (s.domain) sovByKey.set(normalizeDomain(s.domain), s.pct);
    }
  }

  type Entity = { name: string; domain: string | null; isYou: boolean; discovered: boolean };
  const discoveredBrands =
    classified.length > 0
      ? classified
          .filter((c) => !namedLower.has(c.name.toLowerCase()))
          .map((c) => c.name)
      : Array.from(recAll.entries())
          .filter(([k, v]) => !namedLower.has(k) && v.queries.size >= DISCOVERED_MIN_QUERIES)
          .map(([, v]) => v.display);
  const entities: Entity[] = [
    { name: audit.brand_name, domain: audit.domain, isYou: true, discovered: false },
    ...(audit.competitors ?? []).map((n) => ({
      name: n,
      domain: competitorToDomain(n),
      isYou: false,
      discovered: false,
    })),
    ...discoveredBrands.map((name) => ({
      name,
      // Real domain from the classifier (citation-grounded or model-known), not
      // a name+".com" guess; guess only as last resort.
      domain: domainByName.get(name.toLowerCase()) || competitorToDomain(name),
      isYou: false,
      discovered: true,
    })),
  ];
  // Dedupe by lowercased name (named entries come first, so they win the tag).
  const seen = new Set<string>();
  const uniq = entities.filter((e) => {
    const k = e.name.toLowerCase();
    if (!e.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const profiles: CompetitorProfile[] = uniq.map((e) => {
    const dn = e.domain ? normalizeDomain(e.domain) : "";
    const appears = polls.filter((p) =>
      pollRecommends(p, e.isYou, e.name, audit.brand_name)
    );
    // Dedupe by query: multi-LLM audits have one row per (query, llm), and a
    // brand recommended by all 3 LLMs must not produce triple chips.
    const strengths = Array.from(new Set(appears.map((p) => p.query_text))).slice(0, 4);
    const beatsYou = e.isYou
      ? []
      : Array.from(
          new Set(
            appears
              .filter((p) => !p.brand_cited || (p.brand_position ?? 99) > 2)
              .map((p) => p.query_text)
          )
        ).slice(0, 5);

    // Co-cited sources across the queries where this entity appears.
    const srcCount = new Map<string, ProfileSource>();
    for (const p of appears) {
      for (const c of p.citations ?? []) {
        const cd = normalizeDomain(c.domain);
        if (!cd || cd === dn) continue;
        if (ownNorm && (cd === ownNorm || cd.endsWith("." + ownNorm))) continue;
        const tag = tagSource(c, audit.domain, namedNorm, competitorJudged);
        const ex = srcCount.get(cd);
        if (ex) ex.count++;
        else
          srcCount.set(cd, {
            domain: c.domain,
            kind: tag.kind,
            subtype: tag.subtype,
            count: 1,
          });
      }
    }
    const sources = Array.from(srcCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // SoV entries are variant-level; a consolidated parent may not key exactly,
    // so fall back to summing the share of every matching variant.
    const sovPct = e.isYou
      ? sovByKey.get("__you__") ?? 0
      : sovByKey.get(e.name.toLowerCase()) ??
        (dn ? sovByKey.get(dn) : undefined) ??
        sov
          .filter((s) => !s.isYou && brandMatches(s.name, e.name))
          .reduce((a, s) => a + s.pct, 0);
    const verdict = e.isYou
      ? audit.brand_verdict ?? ""
      : verdictByKey.get(e.name.toLowerCase()) ?? (dn ? verdictByKey.get(dn) ?? "" : "");

    const consensus = e.isYou
      ? brandConsensus(audit, polls, audit.brand_name)
      : brandConsensus(audit, polls, e.name);

    return {
      name: e.name,
      domain: e.domain,
      isYou: e.isYou,
      discovered: e.discovered,
      sovPct,
      tier: tierForPct(sovPct),
      category_tier: e.isYou ? undefined : tierByKey.get(e.name.toLowerCase()),
      verdict,
      strengths,
      beatsYou,
      sources,
      consensus,
    };
  });

  // Pin the user first, then competitors by SoV desc.
  const you = profiles.filter((p) => p.isYou);
  const rest = profiles
    .filter((p) => !p.isYou)
    .sort((a, b) => b.sovPct - a.sovPct);
  return [...you, ...rest];
}
