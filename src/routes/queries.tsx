import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { PositionDots, SourceTag } from "@/components/terminal/primitives";
import {
  queryState,
  aggregateQueryState,
  groupPollsByQuery,
  llmsPolled,
  tagSource,
  recommendedBrands,
  normalizeLlm,
  type QueryState,
} from "@/components/terminal/derive";
import { normalizeDomain, citationCategory } from "@/lib/audit/source-classifier";
import type {
  Audit,
  PollResult,
  Citation,
  LlmSource,
  WhyNamed,
  YouInfluence,
  DecisiveFactor,
  SourceType,
} from "@/lib/db/types";

const LLM_LABEL: Record<LlmSource, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};
const LLM_SHORT: Record<LlmSource, string> = {
  chatgpt: "GPT",
  perplexity: "PPX",
  gemini: "GEM",
};

export const Route = createFileRoute("/queries")({
  head: () => ({ meta: [{ title: "Queries — Compass" }] }),
  component: QueriesPage,
});

const DECISIVE_LABEL: Record<DecisiveFactor, string> = {
  citations: "Cited sources",
  third_party: "Third-party presence",
  own_site: "Own-site signals",
};
const SRC_LABEL: Record<SourceType, string> = {
  review_directory: "review",
  analyst: "analyst",
  editorial: "listicle/editorial",
  competitor: "vendor",
  own: "owned",
  other: "source",
};

function Bar({ val, color, label }: { val: number; color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
      <span className="mono" style={{ fontSize: 9, width: 30, color: "var(--ink-3)" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 6, background: "var(--grid)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(val * 100)}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 9, width: 30, textAlign: "right", color: "var(--ink-3)" }}>
        {Math.round(val * 100)}%
      </span>
    </div>
  );
}

function FactorRow({
  label,
  x,
  you,
  primary,
}: {
  label: string;
  x: number;
  you: number;
  primary?: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: primary ? "6px 8px" : "0 0 0 8px",
        borderLeft: primary ? "2px solid var(--warn)" : "2px solid var(--grid)",
        background: primary ? "var(--warn-bg)" : "transparent",
        borderRadius: primary ? 3 : 0,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: primary ? "var(--ink)" : "var(--ink-3)",
          fontWeight: primary ? 800 : 700,
        }}
      >
        {label}
        {primary && <span style={{ color: "var(--warn)" }}> · primary signal</span>}
      </div>
      <Bar val={x} color="var(--ink-2)" label="them" />
      <Bar val={you} color="var(--you)" label="you" />
    </div>
  );
}

function InfluenceBlock({
  w,
  you,
}: {
  w: WhyNamed;
  you: YouInfluence | null;
}) {
  const yf = you?.factors ?? { cited: 0, third_party: 0, own_site: 0 };
  return (
    <div
      style={{
        marginBottom: 18,
        paddingBottom: 16,
        borderBottom: "1px solid var(--grid)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14, color: "var(--ink)" }}>{w.brand}</b>
        <span className="tm-badge" style={{ background: "var(--neg-bg)", color: "var(--neg)" }}>
          Named as recommended
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--warn)", fontWeight: 700 }}>
          decisive: {DECISIVE_LABEL[w.decisive]}
        </span>
      </div>

      <FactorRow label="Cited sources" x={w.factors.cited} you={yf.cited} primary />
      <FactorRow label="Third-party presence" x={w.factors.third_party} you={yf.third_party} />
      <FactorRow label="Own-site signals" x={w.factors.own_site} you={yf.own_site} />

      <div style={{ marginTop: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>
          Cited sources naming {w.brand} · {w.named_in_sources.length} of {w.cited_total}
        </div>
        {w.named_in_sources.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            none of this query's cited sources name it
          </span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {w.named_in_sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tm-chip"
                style={{ textDecoration: "none" }}
                title={s.url}
              >
                {s.domain}
                <small style={{ marginLeft: 5, opacity: 0.7 }}>{SRC_LABEL[s.source_type]}</small>
              </a>
            ))}
          </div>
        )}
      </div>

      <p className="nar" style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)", marginTop: 10 }}>
        {w.verdict}
      </p>
    </div>
  );
}

function QueriesPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <QueriesView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

type Filter = "all" | "absent" | "weak" | "cited";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HlTerm = { term: string; cls: "me" | "comp" };

function buildTerms(brand: string, compNames: string[]): HlTerm[] {
  const terms: HlTerm[] = [];
  const seen = new Set<string>();
  const add = (term: string, cls: "me" | "comp") => {
    const t = (term || "").trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      terms.push({ term: t, cls });
    }
  };
  add(brand, "me");
  for (const c of compNames) add(c, "comp");
  terms.sort((a, b) => b.term.length - a.term.length);
  return terms;
}

/** Highlight brand/competitor names within a plain text run. */
function highlightInline(text: string, terms: HlTerm[], kb: string): ReactNode[] {
  if (!text) return [];
  if (terms.length === 0) return [text];
  const re = new RegExp(`\\b(${terms.map((t) => escapeRe(t.term)).join("|")})\\b`, "gi");
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const matched = m[0];
    const cls =
      terms.find((t) => t.term.toLowerCase() === matched.toLowerCase())?.cls ?? "comp";
    out.push(
      <span key={`${kb}-${key++}`} className={cls}>
        {matched}
      </span>
    );
    last = m.index + matched.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline markdown (**bold**) + brand/competitor highlighting for one text run. */
function renderInline(text: string, terms: HlTerm[], kb: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      const inner = part.slice(2, -2);
      out.push(<strong key={`${kb}-b${i}`}>{highlightInline(inner, terms, `${kb}-b${i}`)}</strong>);
    } else {
      out.push(...highlightInline(part, terms, `${kb}-t${i}`));
    }
  });
  return out;
}

/**
 * Render the verbatim answer with light formatting: strips inline citation
 * markers ("[1]", "[3][4]"), renders **bold** and bullet/numbered lists, and
 * highlights the brand (--you) and competitors (--neg). LLM answers are
 * markdown — showing it raw made the panel look broken.
 */
function renderRichAnswer(text: string, brand: string, compNames: string[]): ReactNode {
  const terms = buildTerms(brand, compNames);
  const cleaned = (text || "").replace(/\s*\[\d+\](?:\s*\[\d+\])*/g, "");
  const lines = cleaned.split(/\n/);
  const blocks: ReactNode[] = [];
  let li: ReactNode[] = [];
  const flush = (k: number) => {
    if (li.length) {
      blocks.push(
        <ul key={`ul-${k}`} style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
          {li}
        </ul>
      );
      li = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flush(i);
      return;
    }
    const b = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (b) {
      li.push(
        <li key={`li-${i}`} style={{ marginBottom: 3 }}>
          {renderInline(b[1], terms, `li-${i}`)}
        </li>
      );
    } else {
      flush(i);
      blocks.push(
        <p key={`p-${i}`} style={{ margin: "0 0 8px" }}>
          {renderInline(line, terms, `p-${i}`)}
        </p>
      );
    }
  });
  flush(lines.length);
  return <>{blocks}</>;
}

interface QueryGroup {
  query: string;
  state: QueryState;
  polls: Map<LlmSource, PollResult>;
}

/** Honest methodology note — pre-empts the "but I see a different answer in the
 *  chat UI" objection by framing the report as an AGGREGATE, API-based
 *  measurement (many queries) vs a single volatile UI sample. */
function MethodologyNote({ queryCount }: { queryCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--grid)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 12,
        background: "var(--panel-2)",
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--ink-2)",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--ink)",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: ".04em",
          textTransform: "uppercase",
        }}
      >
        {open ? "▾" : "▸"} Measured via official APIs, aggregated across{" "}
        {queryCount} {queryCount === 1 ? "query" : "queries"} — a one-off chat-UI
        check may differ (that's expected)
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          We query ChatGPT (OpenAI), Perplexity, and Gemini through their{" "}
          <strong>official APIs</strong>, running <strong>{queryCount}</strong>{" "}
          buyer {queryCount === 1 ? "query" : "queries"} in a{" "}
          <strong>cold, no-login session</strong> and aggregating the results —
          what a <strong>fresh buyer</strong> sees, not a personalized account.
          <br />
          <br />
          If you check the same question in the chat app and see a different
          answer, that's <strong>expected</strong>, not a discrepancy in this
          report. AI answers are <strong>non-deterministic and personalized</strong>{" "}
          — they shift by account memory, session, region, A/B tests, and time. A
          single UI answer is one <em>volatile sample</em>.
          <br />
          <br />
          This report deliberately measures the <strong>pattern across many
          queries</strong> (how often you're cited, and where the models source
          their answers) — which is the reliable signal, not any one screenshot.
        </div>
      )}
    </div>
  );
}

/** Free "try it yourself" link — opens ChatGPT with the prompt prefilled. This
 *  runs LIVE in the viewer's own (personalized) session, so it is NOT proof of
 *  the audit; the cold-session answer + sources shown here are the record. Same
 *  deep-link DFS's scraper returns as check_url, constructed for free (no ~10x
 *  scraper call). */
function OpenInChatGPT({ query }: { query: string }) {
  const url = `https://chatgpt.com/?prompt=${encodeURIComponent(query)}&hints=search`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mono"
      title="Opens ChatGPT with this prompt — runs live in YOUR personalized account, so it may differ from this cold-session audit. Not proof."
      style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap" }}
    >
      ↗ Try in ChatGPT (live)
    </a>
  );
}

function QueriesView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const llms = llmsPolled(audit);
  const ownNorm = normalizeDomain(audit.domain);
  const namedNorm = new Set(
    (audit.competitors ?? [])
      .map((c) => normalizeDomain(c))
      .filter(Boolean)
  );

  // ONE row per query — each holds its per-LLM polls. State aggregates across
  // the LLMs polled (held = cited-well everywhere, absent = cited nowhere).
  const groups: QueryGroup[] = Array.from(groupPollsByQuery(polls).entries()).map(
    ([query, group]) => {
      const byLlm = new Map<LlmSource, PollResult>();
      for (const p of group) byLlm.set(normalizeLlm(p.llm_source), p);
      return {
        query,
        state: aggregateQueryState(group.map(queryState), llms.length),
        polls: byLlm,
      };
    }
  );
  const w = { absent: 3, weak: 2, held: 1 };
  groups.sort(
    (a, b) => w[b.state] - w[a.state] || a.query.localeCompare(b.query)
  );

  const counts = {
    all: groups.length,
    absent: groups.filter((g) => g.state === "absent").length,
    weak: groups.filter((g) => g.state === "weak").length,
    cited: groups.filter((g) => g.state === "held").length,
  };

  const visible = groups.filter((g) => {
    if (filter === "all") return true;
    if (filter === "cited") return g.state === "held";
    return g.state === filter;
  });

  const segClass = (k: Filter) => `tm-seg ${filter === k ? "on" : ""}`;

  return (
    <div>
      <MethodologyNote queryCount={counts.all} />
      <div className="tm-toolbar">
        <button className={segClass("all")} onClick={() => setFilter("all")}>
          All <span className="n">{counts.all}</span>
        </button>
        <button className={segClass("absent")} onClick={() => setFilter("absent")}>
          Absent <span className="n">{counts.absent}</span>
        </button>
        <button className={segClass("weak")} onClick={() => setFilter("weak")}>
          Weak <span className="n">{counts.weak}</span>
        </button>
        <button className={segClass("cited")} onClick={() => setFilter("cited")}>
          Cited <span className="n">{counts.cited}</span>
        </button>
        <span className="sp" />
        <span className="tm-sort mono">
          {llms.length > 1 ? `${llms.length} LLMs · ` : ""}SORT: lost demand ↓
        </span>
      </div>

      <div className="tm-rows">
        {visible.length === 0 ? (
          <div className="tm-empty">No queries in this filter.</div>
        ) : (
          visible.map((g) => (
            <QueryRow
              key={g.query}
              group={g}
              llms={llms}
              open={openId === g.query}
              onToggle={() => setOpenId((cur) => (cur === g.query ? null : g.query))}
              audit={audit}
              ownNorm={ownNorm}
              namedNorm={namedNorm}
            />
          ))
        )}
      </div>
    </div>
  );
}

function QueryRow({
  group,
  llms,
  open,
  onToggle,
  audit,
  ownNorm,
  namedNorm,
}: {
  group: QueryGroup;
  llms: LlmSource[];
  open: boolean;
  onToggle: () => void;
  audit: Audit;
  ownNorm: string;
  namedNorm: Set<string>;
}) {
  const { state } = group;
  const stateClass =
    state === "absent" ? "absent" : state === "weak" ? "weak" : "cited";
  const badge =
    state === "absent"
      ? { cls: "ba", txt: "Absent" }
      : state === "weak"
        ? { cls: "bw", txt: "Weak" }
        : { cls: "bc", txt: "Cited" };

  // Which LLM's answer to show when expanded. Default to the first polled LLM
  // that actually has an answer; user can switch via the sub-tabs.
  const available = llms.filter((l) => group.polls.has(l));
  const [activeLlm, setActiveLlm] = useState<LlmSource | null>(null);
  const shown = activeLlm && group.polls.has(activeLlm) ? activeLlm : available[0] ?? null;
  const poll = shown ? group.polls.get(shown)! : null;

  // Aggregate header stats — union across the LLM rows for this query.
  const recSet = new Map<string, boolean>(); // lower -> tracked
  const namedSet = new Set((audit.competitors ?? []).map((c) => c.toLowerCase()));
  const urlSet = new Set<string>();
  for (const p of group.polls.values()) {
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const k = nm.toLowerCase();
      if (!recSet.has(k)) recSet.set(k, namedSet.has(k));
    }
    for (const c of p.citations ?? []) if (c.url) urlSet.add(c.url);
  }
  const positions = Array.from(group.polls.values())
    .map((p) => p.brand_position)
    .filter((n): n is number => typeof n === "number");
  const bestPos = positions.length ? Math.min(...positions) : null;

  const citedIn = llms.filter((l) => group.polls.get(l)?.brand_cited);
  const subline =
    llms.length > 1
      ? state === "absent"
        ? `absent in all ${llms.length} LLMs`
        : state === "held"
          ? `cited by all ${llms.length} LLMs`
          : `cited in ${citedIn.map((l) => LLM_LABEL[l]).join(", ")} · absent in ${llms
              .filter((l) => !group.polls.get(l)?.brand_cited)
              .map((l) => LLM_LABEL[l])
              .join(", ")}`
      : state === "absent"
        ? "you're absent"
        : state === "weak"
          ? "cited but buried"
          : "you're cited";

  return (
    <div className={`tm-qr ${stateClass} ${open ? "open" : ""}`}>
      <button className="tm-qr-head" onClick={onToggle} aria-expanded={open}>
        <span className="tm-tw" aria-hidden>
          ▶
        </span>
        <div>
          <div className="tm-qr-q">
            {group.query}
            {llms.length > 1 && (
              <span style={{ marginLeft: 10, display: "inline-flex", gap: 4, verticalAlign: "middle" }}>
                {llms.map((l) => {
                  const p = group.polls.get(l);
                  const cited = !!p?.brand_cited;
                  return (
                    <span
                      key={l}
                      className="mono"
                      title={`${LLM_LABEL[l]} · ${
                        !p ? "no answer" : cited ? `cited${p.brand_position ? ` #${p.brand_position}` : ""}` : "absent"
                      }`}
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        borderRadius: 2,
                        fontWeight: 700,
                        letterSpacing: ".04em",
                        background: !p
                          ? "var(--panel-2)"
                          : cited
                            ? "var(--pos-bg)"
                            : "var(--hot-bg)",
                        color: !p ? "var(--ink-3)" : cited ? "var(--pos)" : "var(--hot)",
                      }}
                    >
                      {LLM_SHORT[l]}
                      {p ? (cited ? " ✓" : " ✗") : " —"}
                    </span>
                  );
                })}
              </span>
            )}
          </div>
          <div className="tm-qr-q sub">{subline}</div>
        </div>
        <div className="tm-qr-pos">
          {bestPos ? (
            <>
              <PositionDots position={bestPos} /> #{bestPos}
            </>
          ) : (
            <span style={{ color: "var(--ink-3)" }}>—</span>
          )}
        </div>
        <div
          className="tm-qr-srcs mono"
          title="competitor brands recommended · distinct sources cited (across LLMs)"
        >
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>{recSet.size}</span>{" "}
          rec
          <span style={{ color: "var(--ink-3)" }}> · {urlSet.size} src</span>
        </div>
        <span className={`tm-badge ${badge.cls === "ba" ? "tm-b-inv" : badge.cls === "bw" ? "tm-b-weak" : "tm-b-held"}`}>
          {badge.txt}
        </span>
      </button>

      {open && (
        <>
          {llms.length > 1 && (
            <div
              role="tablist"
              aria-label="LLM answers"
              style={{
                display: "flex",
                gap: 0,
                borderTop: "1px solid var(--grid)",
                background: "var(--panel)",
              }}
            >
              {llms.map((l) => {
                const p = group.polls.get(l);
                const on = shown === l;
                return (
                  <button
                    key={l}
                    role="tab"
                    aria-selected={on}
                    disabled={!p}
                    onClick={() => setActiveLlm(l)}
                    className="mono"
                    style={{
                      padding: "8px 16px",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".04em",
                      background: on ? "var(--bg)" : "transparent",
                      color: !p ? "var(--ink-3)" : on ? "var(--ink)" : "var(--ink-2)",
                      border: "none",
                      borderRight: "1px solid var(--grid)",
                      borderBottom: on ? "2px solid var(--ink)" : "2px solid transparent",
                      cursor: p ? "pointer" : "not-allowed",
                      fontFamily: "inherit",
                    }}
                  >
                    {LLM_LABEL[l]}
                    {p ? (
                      <span
                        style={{
                          marginLeft: 6,
                          color: p.brand_cited ? "var(--pos)" : "var(--hot)",
                        }}
                      >
                        {p.brand_cited ? "✓" : "✗"}
                      </span>
                    ) : (
                      <span style={{ marginLeft: 6 }}>—</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {poll ? (
            <PollBody
              poll={poll}
              llm={shown!}
              audit={audit}
              ownNorm={ownNorm}
              namedNorm={namedNorm}
            />
          ) : (
            <div className="tm-empty" style={{ borderTop: "1px solid var(--grid)" }}>
              No answers captured for this query.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** True when a URL points at a site's root ("/", or empty path) — a homepage,
 *  not a deep article/listicle/review page. Query string + hash ignored. */
function isHomepageUrl(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    return p === "";
  } catch {
    return false;
  }
}

/**
 * True when a cited URL is a RECOMMENDATION self-cite — the model naming a
 * product and linking its own site — rather than a third-party source you could
 * get listed on. This is the root cause of "homepages coming as sources": when
 * ChatGPT answers WITHOUT web grounding, DFS returns no `annotations`, so we mine
 * the prose's markdown links, which are the recommended products' homepages.
 *
 * Uses the authoritative `grounded` flag when present. On legacy rows (flag
 * absent) it stays deliberately conservative — only a product/company HOMEPAGE
 * is hidden; reviews, editorial, forums, and any deep third-party page always
 * survive — so we never nuke a real source we can't prove is ungrounded.
 */
function isRecommendationSelfCite(c: Citation): boolean {
  if (c.grounded === true) return false; // real web-search source
  if (c.grounded === false) return true; // authoritative: ungrounded prose link
  // Legacy (no flag): hide only a plain product/company homepage.
  const cat = citationCategory(c.url, c.domain, c.source_type);
  if (cat !== "vendor" && cat !== "competitor") return false;
  return isHomepageUrl(c.url);
}

/** One LLM's answer + influence + sources for the expanded query row. */
function PollBody({
  poll,
  llm,
  audit,
  ownNorm,
  namedNorm,
}: {
  poll: PollResult;
  llm: LlmSource;
  audit: Audit;
  ownNorm: string;
  namedNorm: Set<string>;
}) {
  const llmName = LLM_LABEL[llm];
  const citations = (poll.citations ?? []) as Citation[];
  const orderedRaw =
    poll.raw_citations && poll.raw_citations.length > 0
      ? [...poll.raw_citations].sort((a, b) => a.order - b.order)
      : citations.map((c, i) => ({ ...c, order: i, anchor_text: "" }));
  // Dedup by URL — the same source (e.g. a product's homepage that heads several
  // recommendation blocks) can appear many times in the inline trail; showing it
  // once is the honest count.
  const seenUrl = new Set<string>();
  const orderedAll = orderedRaw.filter((c) => {
    if (!c.url || seenUrl.has(c.url)) return false;
    seenUrl.add(c.url);
    return true;
  });
  // Split real third-party sources from recommendation self-cites (the model
  // linking a product it recommends to its own homepage — not a source you can
  // get listed on).
  const ordered = orderedAll.filter(
    (c) => !isRecommendationSelfCite(c as Citation)
  );
  const selfCiteCount = orderedAll.length - ordered.length;

  const competitorJudged = new Set(
    (poll.citation_roles ?? [])
      .filter((r) => r.role === "competitor")
      .map((r) => normalizeDomain(r.domain))
  );

  // Two different presence signals — the source of the "I'm present, why
  // suggestions?" confusion. namedInAnswer = the brand appears in the prose
  // (the tab ✓). ownCited = the brand's OWN site is in the cited sources rail.
  // You can be named but not cited — the worklist is about getting CITED.
  const namedInAnswer = poll.brand_cited;
  const ownCited = (poll.citations ?? []).some(
    (c) =>
      c.source_type === "own" ||
      (!!ownNorm && normalizeDomain(c.domain) === ownNorm)
  );

  const recentlyCompleted =
    !!audit.completed_at &&
    Date.now() - new Date(audit.completed_at).getTime() < 5 * 60_000;
  const analyzing =
    audit.citation_status === "analyzing" ||
    (audit.citation_status == null && recentlyCompleted);
  const analysisFailed = audit.citation_status === "failed";

  // BRANDS NAMED in the prose — the real competitor signal (≠ cited domains).
  const namedSet = new Set((audit.competitors ?? []).map((c) => c.toLowerCase()));
  const recommended = recommendedBrands(poll, audit.brand_name).map((name) => ({
    name,
    tracked: namedSet.has(name.toLowerCase()),
  }));
  const compNames = recommended.map((r) => r.name);

  return (
    <div className="tm-qr-body">
      <div className="tm-answer">
        <div
          className="lbl"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
        >
          <span>
            <span className="ai">{llmName.charAt(0)}</span> {llmName} answer · web search
          </span>
          {llm === "chatgpt" && <OpenInChatGPT query={poll.query_text} />}
        </div>
        <div className="txt">
          {poll.full_response
            ? renderRichAnswer(poll.full_response, audit.brand_name, compNames)
            : poll.raw_response || "No answer text stored."}
          {!poll.brand_cited && (
            <span className="tm-none">
              ⚑ {audit.brand_name} not mentioned in this answer
            </span>
          )}
        </div>

        {/* When the brand IS named but NOT cited in sources, say so — otherwise
            "and not you" contradicts the ✓ and confuses the reader. */}
        {namedInAnswer && !ownCited && (
          <div
            style={{
              marginTop: 16,
              padding: "8px 10px",
              borderRadius: 4,
              background: "var(--panel-2)",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            ✓ <b>{audit.brand_name} is named in this answer</b> — but your site
            isn't among the <b>cited sources</b> it's built from. The competitors
            below <em>are</em> cited in third-party pages, which is what makes them
            consistently recommended. Getting cited on those pages defends your
            spot.
          </div>
        )}

        {/* Why the LLM NAMED these brands — led by which cited sources name them. */}
        {poll.why_cited && poll.why_cited.length > 0 ? (
          <div style={{ marginTop: 20 }}>
            <div className="lbl">
              {namedInAnswer
                ? `Why ${llmName} cites these competitors in its sources`
                : `Why ${llmName} named these — and not you`}
            </div>
            {poll.why_cited.map((w, i) => (
              <InfluenceBlock key={i} w={w} you={poll.own_page} />
            ))}
          </div>
        ) : analyzing ? (
          <div style={{ marginTop: 20 }}>
            <div className="lbl">Why {llmName} named these</div>
            <p className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              ◴ analyzing influence signals…
            </p>
          </div>
        ) : analysisFailed ? (
          <div style={{ marginTop: 20 }}>
            <div className="lbl">Why {llmName} named these</div>
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Influence analysis unavailable for this run.
            </p>
          </div>
        ) : null}
      </div>
      <div className="tm-srcs">
        {/* Panel 1: the competitor signal — brands NAMED in the prose. */}
        <div className="lbl" style={{ color: namedInAnswer ? "var(--ink-2)" : "var(--hot)" }}>
          {namedInAnswer ? "Also recommended" : "Recommended instead of you"} ·{" "}
          {recommended.length}
        </div>
        {recommended.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 18 }}>
            No competing products named in this answer.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 20,
            }}
          >
            {recommended.map((r, i) => (
              <span
                key={i}
                className="tm-chip"
                title={r.tracked ? "tracked competitor" : "discovered — not on your list"}
                style={{
                  background: r.tracked ? "var(--neg-bg)" : "var(--panel-2)",
                  color: r.tracked ? "var(--neg)" : "var(--ink-2)",
                }}
              >
                {r.name}
                {!r.tracked && (
                  <small style={{ marginLeft: 5, opacity: 0.7, fontWeight: 700 }}>
                    discovered
                  </small>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Panel 2: where this LLM sourced its answer — the "get listed" signal.
            Only THIRD-PARTY sources count; recommendation homepages are excluded
            (they're the products above, not pages you can get listed on). */}
        <div className="lbl">
          Where {llmName} sourced this · {ordered.length}
          {selfCiteCount > 0 && (
            <small style={{ marginLeft: 6, fontWeight: 600, color: "var(--ink-3)" }}>
              · {selfCiteCount} recommendation homepage{selfCiteCount > 1 ? "s" : ""} hidden
            </small>
          )}
        </div>
        {ordered.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {selfCiteCount > 0
              ? `No third-party sources — ${llmName} answered from model knowledge and only linked the recommended products' own sites (shown above). To surface here you need third-party coverage — listicles, reviews, editorial — not a homepage.`
              : "No live sources — answered from training."}
          </p>
        ) : (
          ordered.map((c, i) => {
            const tag = tagSource(
              c as Citation,
              audit.domain,
              namedNorm,
              competitorJudged
            );
            void ownNorm;
            // Full cited URL — Gemini's vertexaisearch proxy has no deep path in
            // the raw poll citation, so show a clean domain-root for it.
            const fullUrl = c.url.includes("vertexaisearch.cloud.google.com")
              ? `https://${c.domain}/`
              : c.url;
            return (
              <div className="tm-src" key={`${c.url}-${i}`}>
                <span className="o">{i + 1}</span>
                <div className="d" style={{ minWidth: 0 }}>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono"
                    style={{ wordBreak: "break-all", overflowWrap: "anywhere", fontSize: 11 }}
                    title={fullUrl}
                  >
                    {fullUrl}
                  </a>
                  <small>{tag.subtype}</small>
                </div>
                <SourceTag kind={tag.kind} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
