import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { PositionDots, SourceTag } from "@/components/terminal/primitives";
import {
  queryState,
  tagSource,
  recommendedBrands,
  type QueryState,
} from "@/components/terminal/derive";
import { normalizeDomain } from "@/lib/audit/source-classifier";
import type {
  Audit,
  PollResult,
  Citation,
  WhyNamed,
  YouInfluence,
  DecisiveFactor,
  SourceType,
} from "@/lib/db/types";

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

/** Highlight the verbatim answer: brand in --you, competitors in --neg. */
function highlightAnswer(
  text: string,
  brand: string,
  compNames: string[]
): ReactNode[] {
  const terms: { term: string; cls: "me" | "comp" }[] = [];
  const seen = new Set<string>();
  const add = (term: string, cls: "me" | "comp") => {
    const t = term.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      terms.push({ term: t, cls });
    }
  };
  add(brand, "me");
  for (const c of compNames) add(c, "comp");
  if (terms.length === 0) return [text];

  terms.sort((a, b) => b.term.length - a.term.length);
  const re = new RegExp(`\\b(${terms.map((t) => escapeRe(t.term)).join("|")})\\b`, "gi");
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const matched = m[0];
    const cls =
      terms.find((t) => t.term.toLowerCase() === matched.toLowerCase())?.cls ??
      "comp";
    out.push(
      <span key={key++} className={cls}>
        {matched}
      </span>
    );
    last = m.index + matched.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function QueriesView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const ownNorm = normalizeDomain(audit.domain);
  const namedNorm = new Set(
    (audit.competitors ?? [])
      .map((c) => normalizeDomain(c))
      .filter(Boolean)
  );

  const rows = polls
    .map((p) => ({ p, state: queryState(p) }))
    .sort((a, b) => {
      const w = { absent: 3, weak: 2, held: 1 };
      return w[b.state] - w[a.state];
    });

  const counts = {
    all: rows.length,
    absent: rows.filter((r) => r.state === "absent").length,
    weak: rows.filter((r) => r.state === "weak").length,
    cited: rows.filter((r) => r.state === "held").length,
  };

  const visible = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "cited") return r.state === "held";
    return r.state === filter;
  });

  const segClass = (k: Filter) => `tm-seg ${filter === k ? "on" : ""}`;

  return (
    <div>
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
        <span className="tm-sort mono">SORT: lost demand ↓</span>
      </div>

      <div className="tm-rows">
        {visible.length === 0 ? (
          <div className="tm-empty">No queries in this filter.</div>
        ) : (
          visible.map(({ p, state }) => (
            <QueryRow
              key={p.id}
              poll={p}
              state={state}
              open={openId === p.id}
              onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
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
  poll,
  state,
  open,
  onToggle,
  audit,
  ownNorm,
  namedNorm,
}: {
  poll: PollResult;
  state: QueryState;
  open: boolean;
  onToggle: () => void;
  audit: Audit;
  ownNorm: string;
  namedNorm: Set<string>;
}) {
  const stateClass =
    state === "absent" ? "absent" : state === "weak" ? "weak" : "cited";
  const badge =
    state === "absent"
      ? { cls: "ba", txt: "Absent" }
      : state === "weak"
        ? { cls: "bw", txt: "Weak" }
        : { cls: "bc", txt: "Cited" };

  const citations = (poll.citations ?? []) as Citation[];
  const ordered =
    poll.raw_citations && poll.raw_citations.length > 0
      ? [...poll.raw_citations].sort((a, b) => a.order - b.order)
      : citations.map((c, i) => ({ ...c, order: i, anchor_text: "" }));

  const competitorJudged = new Set(
    (poll.citation_roles ?? [])
      .filter((r) => r.role === "competitor")
      .map((r) => normalizeDomain(r.domain))
  );

  const analyzing = audit.citation_status !== "done";

  // BRANDS NAMED in the prose — the real competitor signal (≠ cited domains).
  const namedSet = new Set((audit.competitors ?? []).map((c) => c.toLowerCase()));
  const recommended = recommendedBrands(poll, audit.brand_name).map((name) => ({
    name,
    tracked: namedSet.has(name.toLowerCase()),
  }));
  const compNames = recommended.map((r) => r.name);

  return (
    <div className={`tm-qr ${stateClass} ${open ? "open" : ""}`}>
      <button className="tm-qr-head" onClick={onToggle} aria-expanded={open}>
        <span className="tm-tw" aria-hidden>
          ▶
        </span>
        <div>
          <div className="tm-qr-q">{poll.query_text}</div>
          <div className="tm-qr-q sub">
            {state === "absent"
              ? "you're absent"
              : state === "weak"
                ? "cited but buried"
                : "you're cited"}
          </div>
        </div>
        <div className="tm-qr-pos">
          {poll.brand_position ? (
            <>
              <PositionDots position={poll.brand_position} /> #{poll.brand_position}
            </>
          ) : (
            <span style={{ color: "var(--ink-3)" }}>—</span>
          )}
        </div>
        <div
          className="tm-qr-srcs mono"
          title="competitor brands recommended · sources cited"
        >
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>
            {recommended.length}
          </span>{" "}
          rec
          <span style={{ color: "var(--ink-3)" }}> · {citations.length} src</span>
        </div>
        <span className={`tm-badge ${badge.cls === "ba" ? "tm-b-inv" : badge.cls === "bw" ? "tm-b-weak" : "tm-b-held"}`}>
          {badge.txt}
        </span>
      </button>

      {open && (
        <div className="tm-qr-body">
          <div className="tm-answer">
            <div className="lbl">
              <span className="ai">G</span> ChatGPT answer · web search
            </div>
            <div className="txt">
              {poll.full_response
                ? highlightAnswer(poll.full_response, audit.brand_name, compNames)
                : poll.raw_response || "No answer text stored."}
              {!poll.brand_cited && (
                <>
                  {" "}
                  <span className="tm-none">
                    ⚑ {audit.brand_name} not mentioned in this answer
                  </span>
                </>
              )}
            </div>

            {/* Why ChatGPT NAMED these brands — led by which cited sources name them. */}
            {poll.why_cited && poll.why_cited.length > 0 ? (
              <div style={{ marginTop: 20 }}>
                <div className="lbl">Why ChatGPT named these — and not you</div>
                {poll.why_cited.map((w, i) => (
                  <InfluenceBlock key={i} w={w} you={poll.own_page} />
                ))}
              </div>
            ) : analyzing ? (
              <div style={{ marginTop: 20 }}>
                <div className="lbl">Why ChatGPT named these</div>
                <p className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  ◴ analyzing influence signals…
                </p>
              </div>
            ) : null}
          </div>
          <div className="tm-srcs">
            {/* Panel 1: the competitor signal — brands NAMED in the prose. */}
            <div className="lbl" style={{ color: "var(--hot)" }}>
              Recommended instead of you · {recommended.length}
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

            {/* Panel 2: where ChatGPT sourced this — the "get listed" signal. */}
            <div className="lbl">Where ChatGPT sourced this · {ordered.length}</div>
            {ordered.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
                No live sources — answered from training.
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
                return (
                  <div className="tm-src" key={`${c.url}-${i}`}>
                    <span className="o">{i + 1}</span>
                    <div className="d">
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        {c.domain}
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
      )}
    </div>
  );
}
