import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { PositionDots, SourceTag } from "@/components/terminal/primitives";
import { queryState, tagSource, type QueryState } from "@/components/terminal/derive";
import { normalizeDomain } from "@/lib/audit/source-classifier";
import { deriveBrandName } from "@/components/CitedBrands";
import type { Audit, PollResult, Citation } from "@/lib/db/types";

export const Route = createFileRoute("/queries")({
  head: () => ({ meta: [{ title: "Queries — Compass" }] }),
  component: QueriesPage,
});

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

  const compNames = [
    ...(poll.competitors_cited ?? []).map((c) => c.name),
    ...(poll.discovered_in_query ?? [])
      .filter((d) => d.label === "competitor")
      .map((d) => deriveBrandName(d.title, d.domain)),
  ];

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
          <PositionDots position={poll.brand_position} />{" "}
          {poll.brand_position ? `#${poll.brand_position}` : "—"}
        </div>
        <div className="tm-qr-srcs mono">{citations.length} cited</div>
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
          </div>
          <div className="tm-srcs">
            <div className="lbl">Cited sources · {ordered.length}</div>
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
