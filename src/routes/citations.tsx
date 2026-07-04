import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { SourceTag } from "@/components/terminal/primitives";
import {
  llmsPolled,
  categorizeCitations,
  type SourceTagKind,
} from "@/components/terminal/derive";
import { normalizeDomain } from "@/lib/audit/source-classifier";
import type { CitationCategory } from "@/lib/audit/source-classifier";
import type {
  Audit,
  CitationAnalysisEntry,
  LlmSource,
  PollResult,
  SourceType,
} from "@/lib/db/types";

/** Broken link: permanently/really dead. Bot-block / auth / rate-limit statuses
 *  (401/403/429) are NOT dead — the page exists, it just refused our probe. */
function isDeadLink(e: CitationAnalysisEntry): boolean {
  const s = e.status_code;
  return s != null && s >= 400 && s !== 401 && s !== 403 && s !== 429;
}

const LLM_LABEL: Record<LlmSource, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

export const Route = createFileRoute("/citations")({
  head: () => ({ meta: [{ title: "Citations — Compass" }] }),
  component: CitationsPage,
});

function CitationsPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <CitationsView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

const KIND: Record<SourceType, { kind: SourceTagKind; label: string }> = {
  own: { kind: "you", label: "owned" },
  competitor: { kind: "comp", label: "vendor" },
  review_directory: { kind: "agg", label: "review dir" },
  analyst: { kind: "agg", label: "analyst" },
  editorial: { kind: "ed", label: "editorial" },
  other: { kind: "agg", label: "source" },
};

function hint(t: SourceType): string {
  if (t === "competitor") return "competitor territory";
  if (t === "editorial") return "earn a mention";
  return "get listed here";
}

function Row({
  e,
  rank,
  llmCount,
  title,
  query,
}: {
  e: CitationAnalysisEntry;
  rank: number;
  llmCount: number;
  title: string;
  query?: string;
}) {
  const k = KIND[e.source_type] ?? KIND.other;
  const citingCount = (e.llms_citing ?? []).length || 1;
  // Real destination — resolves Gemini's vertexaisearch redirect to the actual page.
  const link = e.resolved_url || e.url;
  return (
    <div className="tm-card" style={{ position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: e.brand_present ? "var(--pos)" : "var(--hot)",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--ink-3)", width: 22, paddingTop: 2 }}
        >
          {String(rank).padStart(2, "0")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Page title — the real link text, not just the bare domain. */}
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}
            >
              {title || e.domain}
            </a>
            <SourceTag kind={k.kind} />
            {llmCount > 1 && citingCount >= 2 && (
              <span
                className="mono"
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".05em",
                  padding: "2px 6px",
                  borderRadius: 2,
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  textTransform: "uppercase",
                }}
                title="Cited by multiple LLMs — a universal citation source"
              >
                Universal · {citingCount}/{llmCount}
              </span>
            )}
          </div>
          {/* Complete URL of the cited page (final destination). */}
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--ink-2)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
              marginTop: 3,
              overflowWrap: "anywhere",
              wordBreak: "break-all",
            }}
            title={link}
          >
            {link}
          </a>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
            cited by <b style={{ color: "var(--ink-2)" }}>{citingCount}/{llmCount}</b>{" "}
            LLM{llmCount === 1 ? "" : "s"} · across {e.query_count} quer
            {e.query_count === 1 ? "y" : "ies"}
            {!e.brand_present && ` · ${hint(e.source_type)}`}
          </div>
          {query && (
            <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
              ↳ answers: <span style={{ color: "var(--ink-2)" }}>{query}</span>
            </div>
          )}
        </div>
        <span
          className="tm-badge"
          style={
            e.brand_present
              ? { background: "var(--pos-bg)", color: "var(--pos)" }
              : { background: "var(--hot-bg)", color: "var(--hot)" }
          }
        >
          {e.brand_present ? "You appear" : "Missing"}
        </span>
      </div>
    </div>
  );
}

function CitationsView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const entries = audit.citation_analysis ?? [];
  const polledLlms = llmsPolled(audit);
  const [openKey, setOpenKey] = useState<CitationCategory | null>(null);
  const [llmFilter, setLlmFilter] = useState<LlmSource | "all">("all");
  const [landscapeOpen, setLandscapeOpen] = useState(false);

  // URL → page title, mined from the raw poll citations (citation_analysis
  // stores the URL but not the title). First non-empty title for a URL wins.
  const titleByUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of polls) {
      for (const c of p.citations ?? []) {
        if (c.url && c.title && !m.get(c.url)) m.set(c.url, c.title);
      }
      for (const c of p.raw_citations ?? []) {
        if (c.url && c.title && !m.get(c.url)) m.set(c.url, c.title);
      }
    }
    return m;
  }, [polls]);

  // URL → the buyer queries that surfaced it (why this source matters).
  const queriesByUrl = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of polls) {
      for (const c of p.citations ?? []) {
        if (!c.url) continue;
        if (!m.has(c.url)) m.set(c.url, new Set());
        m.get(c.url)!.add(p.query_text);
      }
    }
    return m;
  }, [polls]);
  const queryFor = (url: string): string => {
    const qs = Array.from(queriesByUrl.get(url) ?? []);
    return qs.length === 0 ? "" : qs.length <= 2 ? qs.join(", ") : `${qs[0]} +${qs.length - 1} more`;
  };

  // Niche vocabulary RELATIVE TO THIS BRAND — drawn from its category, buyer
  // queries, positioning, DNA (seeds/products), and its competitors. A listicle
  // is on-niche if it shares this vocabulary. This is category-aware: for an HR
  // brand, "best HR software" IS the niche and is kept; for a supply-chain brand
  // it isn't. No universal blocklist — relevance is always relative to the brand.
  const nicheTerms = useMemo(() => {
    const STOP = new Set([
      "best", "top", "software", "tools", "tool", "platform", "platforms", "solution",
      "solutions", "app", "apps", "vendor", "vendors", "companies", "company", "list",
      "guide", "review", "reviews", "comparison", "alternative", "alternatives", "free",
      "online", "services", "service", "systems", "system", "with", "your", "the", "for",
      "and", "vs", "versus", "using", "based", "leading", "modern", "global", "world",
      "business", "businesses", "enterprise", "management", "data",
    ]);
    const terms = new Set<string>();
    const add = (s?: string | null) => {
      for (const w of (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
        if (w.length > 3 && !STOP.has(w)) terms.add(w);
      }
    };
    add(audit.category);
    add(audit.positioning);
    add(audit.brand_name);
    for (const p of polls) add(p.query_text);
    for (const c of audit.competitors ?? []) add(c);
    const dna = audit.brand_dna as {
      category?: string; positioning?: string; audience?: string;
      seed_phrases?: string[]; products?: string[]; competitors?: string[];
    } | null;
    if (dna) {
      add(dna.category);
      add(dna.positioning);
      add(dna.audience);
      for (const s of dna.seed_phrases ?? []) add(s);
      for (const s of dna.products ?? []) add(s);
      for (const s of dna.competitors ?? []) add(s);
    }
    return terms;
  }, [audit, polls]);
  // Keyword-only fallback for pre-classifier audits (listicles only).
  const isNicheRelevantKeyword = (e: CitationAnalysisEntry): boolean => {
    if (nicheTerms.size < 3) return true;
    const hay = `${titleByUrl.get(e.url) ?? ""} ${e.resolved_url || e.url}`.toLowerCase();
    for (const t of nicheTerms) if (hay.includes(t)) return true;
    return false;
  };

  const recentlyCompleted =
    !!audit.completed_at &&
    Date.now() - new Date(audit.completed_at).getTime() < 5 * 60_000;
  const analyzing =
    audit.citation_status === "analyzing" ||
    (audit.citation_status == null && recentlyCompleted);
  const failed = audit.citation_status === "failed";

  if (entries.length === 0) {
    return (
      <div className="tm-empty">
        {analyzing ? (
          <p className="mono">◴ Analyzing cited sources…</p>
        ) : failed ? (
          <p>Citation analysis was unavailable for this run — try re-running.</p>
        ) : (
          <p>No cited sources recorded in this run.</p>
        )}
      </div>
    );
  }

  // Drop dead links (404/410/5xx…) — "no broken links". Then apply the LLM
  // filter (which LLM cited it). Categories/counts reflect the visible set.
  const liveEntries = entries.filter((e) => !isDeadLink(e));
  const deadCount = entries.length - liveEntries.length;
  const visibleEntries =
    llmFilter === "all"
      ? liveEntries
      : liveEntries.filter((e) => (e.llms_citing ?? []).includes(llmFilter));

  const llmCount = llmFilter === "all" ? polledLlms.length : 1;
  const present = visibleEntries.filter((e) => e.brand_present);
  const universalMissing = visibleEntries.filter(
    (e) => !e.brand_present && (e.llms_citing ?? []).length >= 2
  );
  const groups = categorizeCitations(audit, visibleEntries);
  const totalVisible = visibleEntries.length;

  // AEO lens: you can only "get listed" on third-party surfaces (roundups,
  // directories, editorial, community). Vendor/competitor sites are landscape —
  // you can't add yourself to a rival's homepage. Split accordingly.
  const ACTIONABLE = new Set<CitationCategory>([
    "listicles",
    "reviews",
    "editorial",
    "pr",
    "reddit",
    "youtube",
    "linkedin",
    "community",
  ]);
  // A bare homepage citation ("ibm.com is cited") is low signal — you can't get
  // "listed" on a homepage, and it names no specific page to target. Drop these
  // from the worklist; the signal lives in cited DEEP pages (articles, directory
  // category pages, roundups).
  const isHomepage = (e: CitationAnalysisEntry): boolean => {
    try {
      return new URL(e.resolved_url || e.url).pathname.replace(/\/+$/, "") === "";
    } catch {
      return false;
    }
  };

  const actionableRaw = groups.filter((g) => ACTIONABLE.has(g.key));
  // Keep DEEP pages only; for listicles, also require niche relevance (drop the
  // vague off-topic roundups). Recount after filtering.
  // In-niche? Server LLM verdict wins (any content surface). Reviews/directories
  // are inherently in-niche. Keyword fallback only for listicles on old audits.
  const nicheOk = (g: (typeof groups)[number], e: CitationAnalysisEntry): boolean => {
    if (g.key === "reviews") return true;
    if (typeof e.niche_relevant === "boolean") return e.niche_relevant;
    return g.key === "listicles" ? isNicheRelevantKeyword(e) : true;
  };
  const keepActionable = (g: (typeof groups)[number], e: CitationAnalysisEntry) =>
    !isHomepage(e) && nicheOk(g, e);
  const actionableGroups = actionableRaw
    .map((g) => {
      const entries = g.entries.filter((e) => keepActionable(g, e));
      return {
        ...g,
        entries,
        total: entries.length,
        missing: entries.filter((e) => !e.brand_present).length,
      };
    })
    .filter((g) => g.total > 0);
  const homepagesHidden = actionableRaw.reduce(
    (n, g) => n + g.entries.filter(isHomepage).length,
    0
  );
  const offNicheHidden = actionableRaw.reduce(
    (n, g) => n + g.entries.filter((e) => !isHomepage(e) && !nicheOk(g, e)).length,
    0
  );
  const landscapeGroups = groups.filter((g) => !ACTIONABLE.has(g.key));
  const actionableMissing = actionableGroups.reduce((n, g) => n + g.missing, 0);

  // What to actually DO with each get-listed surface.
  const ACTION: Partial<Record<CitationCategory, string>> = {
    reviews: "Get a profile & reviews",
    listicles: "Pitch to be included",
    editorial: "Earn a mention",
    pr: "Distribute a release",
    reddit: "Engage in the thread",
    youtube: "Get featured",
    linkedin: "Publish / get tagged",
    community: "Contribute an answer",
  };

  // The worklist: get-listable DEEP pages you're missing, ranked by cross-LLM
  // leverage (cited by more LLMs / more queries = higher payoff to land).
  const topTargets = actionableGroups
    .flatMap((g) =>
      g.entries.filter((e) => !e.brand_present).map((e) => ({ e, key: g.key, label: g.label }))
    )
    .sort(
      (a, b) =>
        (b.e.llms_citing?.length ?? 0) - (a.e.llms_citing?.length ?? 0) ||
        b.e.query_count - a.e.query_count
    )
    .slice(0, 8);

  // Own-site signal: pages on YOUR domain the LLMs cite directly (strongest AEO
  // proof), plus total sources that mention you.
  const ownNorm = normalizeDomain(audit.domain);
  const ownDomainCited = visibleEntries.filter(
    (e) => e.source_type === "own" || normalizeDomain(e.domain) === ownNorm
  ).length;
  // Graded own-site score (0–100): own pages cited weigh most; breadth of being
  // named across sources is secondary.
  const namedRate = totalVisible ? present.length / totalVisible : 0;
  const ownScore = Math.min(
    100,
    Math.round(ownDomainCited * 30 + Math.min(present.length, 8) * 5 + namedRate * 60)
  );
  const ownGrade = ownScore >= 60 ? "Strong" : ownScore >= 25 ? "Moderate" : "Weak";
  const ownGradeColor =
    ownScore >= 60 ? "var(--pos)" : ownScore >= 25 ? "var(--warn)" : "var(--hot)";

  // Universal blind spots — cited by ALL polled LLMs but missing you. Highest ROI
  // (every engine agrees this source matters). Get-listable surfaces only.
  const universalTargets = actionableGroups
    .flatMap((g) => g.entries.map((e) => ({ e, label: g.label })))
    .filter(
      ({ e }) => !e.brand_present && (e.llms_citing?.length ?? 0) >= polledLlms.length && polledLlms.length > 1
    )
    .sort((a, b) => b.e.query_count - a.e.query_count)
    .slice(0, 6);

  // Landscape rolled up by DOMAIN — hundreds of vendor/competitor homepage rows
  // are noise; the useful view is "which rival/vendor domains do the LLMs cite,
  // and how often". One row per domain.
  const landscapeDomains = (() => {
    const m = new Map<
      string,
      { domain: string; count: number; present: boolean; sampleUrl: string; label: string }
    >();
    for (const g of landscapeGroups)
      for (const e of g.entries) {
        const d = e.domain;
        const ex = m.get(d);
        if (ex) {
          ex.count++;
          ex.present = ex.present || e.brand_present;
        } else {
          m.set(d, {
            domain: d,
            count: 1,
            present: e.brand_present,
            sampleUrl: e.resolved_url || e.url,
            label: g.label,
          });
        }
      }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  })();

  const groupSection = (g: (typeof groups)[number], muted: boolean) => {
    const open = openKey === g.key;
    return (
      <div key={g.key}>
        <button
          type="button"
          onClick={() => setOpenKey(open ? null : g.key)}
          className="tm-phead"
          style={{
            cursor: "pointer",
            width: "100%",
            border: "none",
            background: "transparent",
            textAlign: "left",
            opacity: muted && !open ? 0.72 : 1,
          }}
          aria-expanded={open}
        >
          <h2>
            <span className="mono" style={{ color: "var(--ink-3)", marginRight: 8, fontSize: 13 }}>
              {open ? "▾" : "▸"}
            </span>
            {g.label}
          </h2>
          <span className="meta">
            {ACTION[g.key] && !muted ? `${ACTION[g.key]} · ` : ""}
            {g.total} source{g.total === 1 ? "" : "s"}
            {g.missing > 0 && (
              <span style={{ color: "var(--hot)" }}> · {g.missing} missing you</span>
            )}
          </span>
        </button>
        {open && (
          <div className="tm-rows">
            {g.entries.map((e, i) => (
              <Row
                key={e.url}
                e={e}
                rank={i + 1}
                llmCount={llmCount}
                title={titleByUrl.get(e.url) ?? ""}
                query={queryFor(e.url)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div
        style={{
          padding: "20px 20px 18px",
          borderBottom: "1px solid var(--grid-2)",
          background: "var(--panel)",
        }}
      >
        <p
          className="nar"
          style={{ fontSize: 22, lineHeight: 1.42, fontWeight: 500, color: "var(--ink-2)", maxWidth: 1040 }}
        >
          {llmFilter === "all" && polledLlms.length > 1 ? (
            <>
              <b style={{ color: "var(--ink)" }}>{polledLlms.length} LLMs</b>{" "}
              collectively cited{" "}
              <b style={{ color: "var(--ink)" }}>{totalVisible}</b> source
              {totalVisible === 1 ? "" : "s"} — you appear on{" "}
              <b style={{ color: present.length > 0 ? "var(--pos)" : "var(--hot)" }}>
                {present.length}
              </b>{" "}
              of them
              {universalMissing.length > 0 ? (
                <>
                  {" "}·{" "}
                  <b style={{ color: "var(--hot)" }}>{universalMissing.length}</b>{" "}
                  are cited by multiple LLMs but missing you
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              <b style={{ color: "var(--ink)" }}>
                {llmFilter === "all" ? "ChatGPT" : LLM_LABEL[llmFilter]}
              </b>{" "}
              cited <b style={{ color: "var(--ink)" }}>{totalVisible}</b>{" "}
              source{totalVisible === 1 ? "" : "s"} — you appear on{" "}
              <b style={{ color: present.length > 0 ? "var(--pos)" : "var(--hot)" }}>
                {present.length}
              </b>{" "}
              of them.
            </>
          )}
          {analyzing && (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 10 }}>
              ◴ analyzing…
            </span>
          )}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>
          Two things that matter for AEO: <b>where to get listed</b> (third-party
          surfaces you're missing) and <b>your own-site signal</b>. Vendor &
          competitor sites are landscape — you can't list yourself there.
          {deadCount > 0 && (
            <span> {deadCount} dead link{deadCount === 1 ? "" : "s"} hidden.</span>
          )}
        </p>

        {/* Own-site signal — the strongest AEO proof is your own pages being cited. */}
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 6,
            border: "1px solid var(--grid-2)",
            background: ownDomainCited > 0 ? "var(--pos-bg)" : "var(--hot-bg)",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              ◆ Own-site signal
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: ownGradeColor }}>
              {ownGrade}
            </span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {ownScore}/100
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 4 }}>
            {ownDomainCited > 0 ? (
              <>
                LLMs cite <b>{ownDomainCited}</b> page{ownDomainCited === 1 ? "" : "s"} on
                your own domain
              </>
            ) : (
              <>None of your own pages are cited</>
            )}{" "}
            · you're named on <b>{present.length}</b> of {totalVisible} sources.{" "}
            {ownDomainCited > 0
              ? "Keep those pages authoritative; then close the get-listed gaps below."
              : "Publish authoritative pages the LLMs will cite, and get onto the sources below."}
          </div>
        </div>
      </div>

      {/* View toggle — all sources grouped, or filtered to one LLM's citations. */}
      {polledLlms.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            borderBottom: "1px solid var(--grid-2)",
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".06em" }}
          >
            View
          </span>
          {(["all", ...polledLlms] as const).map((opt) => {
            const active = llmFilter === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setLlmFilter(opt)}
                className="tm-badge"
                style={{
                  cursor: "pointer",
                  border: active ? "1px solid var(--ink)" : "1px solid var(--grid-2)",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--panel)" : "var(--ink-2)",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {opt === "all" ? "All grouped" : LLM_LABEL[opt]}
              </button>
            );
          })}
        </div>
      )}

      {/* ── UNIVERSAL BLIND SPOTS ── every LLM cites it, you're missing. Top ROI. */}
      {universalTargets.length > 0 && (
        <>
          <div className="tm-phead" style={{ borderTop: "none", background: "var(--hot-bg)" }}>
            <h2 style={{ color: "var(--hot)" }}>🎯 Universal blind spots</h2>
            <span className="meta">
              cited by all {polledLlms.length} LLMs but missing you — land these first
            </span>
          </div>
          <div className="tm-rows">
            {universalTargets.map(({ e, label }, i) => (
              <Row
                key={e.url}
                e={e}
                rank={i + 1}
                llmCount={llmCount}
                title={`${titleByUrl.get(e.url) || e.domain}  ·  ${label}`}
                query={queryFor(e.url)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── WHERE TO GET LISTED ── the actionable worklist (deep pages only). */}
      <div className="tm-phead" style={universalTargets.length > 0 ? undefined : { borderTop: "none" }}>
        <h2 style={{ color: "var(--hot)" }}>⚑ Where to get listed</h2>
        <span className="meta">
          {actionableMissing} third-party page{actionableMissing === 1 ? "" : "s"} you're
          missing · highest-leverage first
          {homepagesHidden > 0 && ` · ${homepagesHidden} homepage${
            homepagesHidden === 1 ? "" : "s"
          } hidden`}
          {offNicheHidden > 0 && ` · ${offNicheHidden} off-niche source${
            offNicheHidden === 1 ? "" : "s"
          } hidden`}
        </span>
      </div>

      {topTargets.length > 0 && (
        <div className="tm-rows">
          {topTargets.map(({ e, key, label }, i) => (
            <Row
              key={e.url}
              e={e}
              rank={i + 1}
              llmCount={llmCount}
              title={`${titleByUrl.get(e.url) || e.domain}  ·  ${label}${
                ACTION[key] ? ` → ${ACTION[key]}` : ""
              }`}
              query={queryFor(e.url)}
            />
          ))}
        </div>
      )}

      {/* Full actionable breakdown by category (collapsed). */}
      <div style={{ borderTop: "1px solid var(--grid-2)" }}>
        {actionableGroups.map((g) => groupSection(g, false))}
      </div>

      {/* ── LANDSCAPE ── vendor + competitor DOMAINS (rolled up): intel only. */}
      {landscapeDomains.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setLandscapeOpen((v) => !v)}
            className="tm-phead"
            style={{
              cursor: "pointer",
              width: "100%",
              border: "none",
              background: "var(--panel-2)",
              textAlign: "left",
            }}
            aria-expanded={landscapeOpen}
          >
            <h2 style={{ color: "var(--ink-3)" }}>
              <span className="mono" style={{ marginRight: 8, fontSize: 13 }}>
                {landscapeOpen ? "▾" : "▸"}
              </span>
              ◱ Competitive landscape
            </h2>
            <span className="meta">
              {landscapeDomains.length} vendor & competitor domain
              {landscapeDomains.length === 1 ? "" : "s"} — intel, not get-listable
            </span>
          </button>
          {landscapeOpen && (
            <div className="tm-rows">
              {landscapeDomains.map((d, i) => (
                <div key={d.domain} className="tm-card" style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: "var(--ink-3)", width: 28 }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <a
                      href={d.sampleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: 1,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        textDecoration: "none",
                      }}
                    >
                      {d.domain}
                    </a>
                    <span className="meta" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {d.label} · {d.count} page{d.count === 1 ? "" : "s"} cited
                    </span>
                    <span
                      className="tm-badge"
                      style={
                        d.present
                          ? { background: "var(--pos-bg)", color: "var(--pos)" }
                          : { background: "var(--panel-2)", color: "var(--ink-3)" }
                      }
                    >
                      {d.present ? "You appear" : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
