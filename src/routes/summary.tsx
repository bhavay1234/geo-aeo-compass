import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { BleedBar, StatePill, Sparkline, Favicon, LlmIcon } from "@/components/terminal/primitives";
import {
  buildGapRows,
  buildLlmScorecards,
  computeShareOfVoice,
  buildCompetitorTable,
  buildDomainStats,
  llmsPolled,
  topGetListedTargets,
  type GapRow,
} from "@/components/terminal/derive";
import type {
  Audit,
  PollResult,
  LlmSource,
  CitationAnalysisEntry,
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

export const Route = createFileRoute("/summary")({
  head: () => ({ meta: [{ title: "Summary — Compass" }] }),
  component: SummaryPage,
});

function SummaryPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <SummaryView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function subline(g: GapRow, multiLlm: boolean): { __html: string } {
  if (g.state === "absent") {
    const where = multiLlm ? `absent in all LLMs` : `you're absent`;
    if (g.who.length === 0) return { __html: `competitors cited — ${where}` };
    const names =
      g.who.length > 3
        ? `<b>${g.who.length} competitors</b>`
        : `<b>${g.who.join(" · ")}</b>`;
    return { __html: `${names} recommended — ${where}` };
  }
  if (g.state === "weak") {
    // Multi-LLM "weak" usually means partial coverage (cited in some LLMs,
    // absent in others) — say that, not "buried", when it's the real story.
    if (multiLlm && g.absentLlms.length > 0)
      return {
        __html: `cited in <b>${g.citedLlms.length}</b> of <b>${
          g.citedLlms.length + g.absentLlms.length
        }</b> LLMs · absent in ${g.absentLlms.join(", ")}`,
      };
    return {
      __html: `cited <b>${g.position ? ordinal(g.position) : "low"}</b> · buried below the fold`,
    };
  }
  const everywhere = multiLlm ? ` in every LLM` : "";
  return {
    __html:
      g.position === 1
        ? `cited <b>1st</b>${everywhere} · strong, defend this`
        : `cited <b>${g.position ? ordinal(g.position) : ""}</b>${everywhere} · category fit`,
  };
}

function SummaryView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const { audits } = useWorkspace();
  const brand = audit.brand_name;
  const gaps = buildGapRows(audit, polls);
  const sovFull = computeShareOfVoice(audit, polls);
  const llms = llmsPolled(audit);
  const scorecards = buildLlmScorecards(audit, polls);

  // Off-page "where to get cited" rollup — the core AEO action, surfaced up top.
  const citeEntries = (audit.citation_analysis ?? []) as CitationAnalysisEntry[];
  const titleByUrl = new Map<string, string>();
  for (const p of polls)
    for (const c of p.citations ?? [])
      if (c.url && c.title && !titleByUrl.has(c.url)) titleByUrl.set(c.url, c.title);
  const getListed = topGetListedTargets(audit, citeEntries, titleByUrl, 6);
  const citationsAnalyzing =
    audit.citation_status === "analyzing" || audit.citation_status == null;
  const compTable = buildCompetitorTable(audit, polls);
  const { domains: domainRows, byType } = buildDomainStats(audit, citeEntries);
  const TYPE_COLORS = [
    "var(--you)",
    "var(--hot)",
    "var(--warn)",
    "var(--pos)",
    "var(--ink-3)",
    "#8b5cf6",
    "#0891b2",
    "#db2777",
  ];

  // total = distinct queries (one per gap row after per-query aggregation).
  // Per-LLM answers = queries × LLMs — the buyer-facing denominator on multi-LLM
  // audits ("invisible in N of {queries × 3} high-intent AI answers").
  const total = gaps.length;
  const absent = gaps.filter((g) => g.state === "absent").length;
  const weak = gaps.filter((g) => g.state === "weak").length;
  const held = gaps.filter((g) => g.state === "held").length;
  // Answer counts come from ACTUAL captured polls — identical to the
  // StatusBar's math, and failed polls (no row) are never counted as
  // "invisible" answers that ChatGPT/Gemini/Perplexity didn't actually give.
  const totalAnswers = polls.length;
  const absentAnswers = polls.filter((p) => !p.brand_cited).length;

  // Plain-language headline: inferred category + who leads citation share.
  const category = (audit.category ?? "").trim();
  const leader = sovFull[0] ?? null;
  const youEntry = sovFull.find((s) => s.isYou) ?? null;
  const youRank = sovFull.findIndex((s) => s.isYou) + 1; // 0 → not cited at all
  const topComps = sovFull
    .filter((s) => !s.isYou)
    .slice(0, 2)
    .map((s) => s.name);

  // Always show the brand in the SoV chart — at 0% ("not cited") if absent — so
  // the panel never collapses to a broken-looking blank for a first-time viewer.
  const hasSov = sovFull.length > 0;
  const sov = youEntry
    ? sovFull.slice(0, 5)
    : [
        ...sovFull.slice(0, 4),
        { name: brand, domain: audit.domain, count: 0, pct: 0, isYou: true },
      ];
  const sovMax = Math.max(1, ...sov.map((s) => s.pct));

  // Trajectory from prior completed runs of the same brand+domain.
  const runs = audits
    .filter(
      (a) =>
        a.status === "completed" &&
        a.brand_name === audit.brand_name &&
        a.domain === audit.domain &&
        a.visibility_score != null
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  const scores = runs.map((r) => r.visibility_score as number);
  const score = audit.visibility_score ?? 0;
  const delta =
    scores.length >= 2 ? score - scores[scores.length - 2] : null;

  const compClause =
    topComps.length > 0 ? (
      <>
        {" "}— competitors like{" "}
        <b style={{ color: "var(--ink)" }}>{topComps.join(" and ")}</b> are being
        recommended instead
      </>
    ) : null;

  const acrossLlms =
    llms.length > 1 ? (
      <>
        {" "}across <b>{llms.length} LLMs</b>
      </>
    ) : null;

  const verdict =
    total === 0 ? (
      <>Run in progress — no queries scored yet.</>
    ) : absent > 0 && llms.length > 1 ? (
      <>
        <b style={{ color: "var(--you)" }}>{brand}</b> is{" "}
        <b style={{ color: "var(--hot)" }}>invisible</b> in{" "}
        <b style={{ color: "var(--hot)" }}>
          {absentAnswers} of {totalAnswers}
        </b>{" "}
        high-intent AI answers{acrossLlms}
        {compClause}.
      </>
    ) : absent > 0 ? (
      <>
        <b style={{ color: "var(--you)" }}>{brand}</b> is{" "}
        <b style={{ color: "var(--hot)" }}>invisible</b> in{" "}
        <b style={{ color: "var(--hot)" }}>
          {absent} of {total}
        </b>{" "}
        high-intent ChatGPT queries{compClause}.
      </>
    ) : weak > 0 ? (
      <>
        <b style={{ color: "var(--you)" }}>{brand}</b> is cited in all{" "}
        <b>{total}</b> high-intent queries{acrossLlms} but ranks below the top on{" "}
        <b style={{ color: "var(--warn)" }}>{weak}</b>
        {topComps.length > 0 ? (
          <>
            {" "}— <b style={{ color: "var(--ink)" }}>{topComps.join(" and ")}</b>{" "}
            are cited above it
          </>
        ) : null}
        .
      </>
    ) : (
      <>
        <b style={{ color: "var(--you)" }}>{brand}</b> is cited in{" "}
        <b style={{ color: "var(--pos)" }}>all {total}</b> high-intent queries
        {acrossLlms}
        {youEntry ? (
          <>
            {" "}and leads citation share at <b>{youEntry.pct}%</b>
          </>
        ) : null}
        .
      </>
    );

  return (
    <>
      <div
        style={{
          padding: "20px 20px 18px",
          borderBottom: "1px solid var(--grid-2)",
          background: "var(--panel)",
        }}
      >
        <p
          className="nar"
          style={{
            fontSize: 22,
            lineHeight: 1.42,
            fontWeight: 500,
            color: "var(--ink-2)",
            maxWidth: 1040,
            letterSpacing: "-.01em",
          }}
        >
          {verdict}
        </p>
      </div>

      {/* Per-LLM scorecards — individual visibility per engine, never merged. */}
      {llms.length > 1 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${scorecards.length}, 1fr)`,
            borderBottom: "1px solid var(--grid-2)",
          }}
        >
          {scorecards.map((s, i) => (
            <div
              key={s.llm}
              className="tm-reveal"
              style={{
                padding: "16px 18px",
                borderRight: i < scorecards.length - 1 ? "1px solid var(--grid)" : "none",
                background: "var(--bg)",
                animationDelay: `${i * 0.05}s`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <LlmIcon llm={s.llm} size={16} />
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-2)",
                  }}
                >
                  {LLM_LABEL[s.llm]}
                </span>
                {s.answers < s.expected && (
                  <span className="mono" style={{ fontSize: 9, color: "var(--warn)" }}>
                    {s.expected - s.answers} answer{s.expected - s.answers === 1 ? "" : "s"} missing
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                <span
                  style={{
                    fontFamily: "Archivo",
                    fontWeight: 800,
                    fontSize: 34,
                    letterSpacing: "-.03em",
                    lineHeight: 0.9,
                    color:
                      s.visibility >= 67
                        ? "var(--pos)"
                        : s.visibility > 0
                          ? "var(--warn)"
                          : "var(--hot)",
                  }}
                >
                  {s.answers ? s.visibility : "—"}
                </span>
                {s.answers > 0 && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    /100 visibility
                  </span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 8 }}>
                named in answer{" "}
                <b style={{ color: s.namedIn > 0 ? "var(--pos)" : "var(--hot)" }}>
                  {s.namedIn}/{s.answers}
                </b>
                {" · "}in citations{" "}
                <b style={{ color: s.citedIn > 0 ? "var(--pos)" : "var(--hot)" }}>
                  {s.citedIn}/{s.answers}
                </b>
              </div>
              {s.sov.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {s.sov.slice(0, 3).map((e) => (
                    <div
                      key={e.name}
                      style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: e.isYou ? 700 : 500,
                          color: e.isYou ? "var(--you)" : "var(--ink-2)",
                          width: 90,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.name}
                      </span>
                      <div style={{ flex: 1, height: 5, background: "var(--grid)", borderRadius: 2, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${e.pct}%`,
                            background: e.isYou ? "var(--you)" : "var(--ink-3)",
                          }}
                        />
                      </div>
                      <span className="mono" style={{ fontSize: 9.5, width: 28, textAlign: "right", color: "var(--ink-3)" }}>
                        {e.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* WHERE TO GET CITED — the off-page action, surfaced up top. Third-party
          pages the LLMs pull from that don't mention the brand yet. */}
      <div
        style={{
          padding: "16px 20px 18px",
          borderBottom: "1px solid var(--grid-2)",
          background: "var(--bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--hot)",
              margin: 0,
            }}
          >
            ↗ Where to get cited · off-page targets
          </h2>
          <Link
            to="/citations"
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-3)" }}
          >
            full worklist →
          </Link>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "6px 0 12px", maxWidth: 900 }}>
          Third-party pages the AI engines already pull from that{" "}
          <b style={{ color: "var(--ink-2)" }}>don't mention {brand} yet</b> — the
          highest-leverage places to get listed so you start showing up in answers.
        </p>
        {getListed.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {citationsAnalyzing
              ? "◴ Analyzing where the AI engines source their answers…"
              : "No missing off-page targets found for this run."}
          </p>
        ) : (
          getListed.map((t, i) => (
            <div
              key={t.url}
              className="tm-reveal"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "8px 0",
                borderTop: i > 0 ? "1px solid var(--grid)" : "none",
                animationDelay: `${i * 0.04}s`,
              }}
            >
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", width: 18 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <Favicon domain={t.domain} size={16} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                >
                  {t.title || t.domain}
                </a>
                <span
                  style={{
                    fontSize: 10,
                    marginLeft: 8,
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: "var(--panel-2)",
                    color: "var(--ink-3)",
                  }}
                >
                  {t.label}
                </span>
                {t.reason && (
                  <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                    {t.reason}
                  </div>
                )}
              </div>
              <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                {t.llms.map((l) => LLM_SHORT[l]).join(" · ")}
              </span>
            </div>
          ))
        )}
      </div>

      {/* COMPETITOR COMPARISON — you vs rivals: visibility share + avg position. */}
      {compTable.length > 0 && (
        <div style={{ padding: "16px 20px 18px", borderBottom: "1px solid var(--grid-2)", background: "var(--bg)" }}>
          <h2
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--ink-2)",
              margin: "0 0 10px",
            }}
          >
            ◑ Competitors · you vs the field
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--ink-3)", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700 }}>Brand</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 200 }}>Visibility</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 100 }}>Sentiment</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 90 }}>Avg position</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 70 }}>Queries</th>
                </tr>
              </thead>
              <tbody>
                {compTable.map((c) => (
                  <tr
                    key={c.name}
                    style={{
                      borderTop: "1px solid var(--grid)",
                      background: c.isYou ? "var(--panel-2)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Favicon domain={c.domain} size={16} />
                        <span style={{ fontWeight: c.isYou ? 800 : 600, color: c.isYou ? "var(--you)" : "var(--ink)" }}>
                          {c.name}
                        </span>
                        {c.isYou && <span className="tm-badge" style={{ background: "var(--panel)", color: "var(--you)" }}>you</span>}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ width: 34, color: "var(--ink-2)" }}>{c.visibilityPct}%</span>
                        <span style={{ flex: 1, height: 6, background: "var(--grid)", borderRadius: 3, overflow: "hidden", maxWidth: 150 }}>
                          <span style={{ display: "block", height: "100%", width: `${c.visibilityPct}%`, background: c.isYou ? "var(--you)" : "var(--ink-3)" }} />
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>
                      {c.sentiment == null ? (
                        <span className="mono" style={{ color: "var(--ink-3)" }}>—</span>
                      ) : (
                        <span
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color:
                              c.sentimentLabel === "positive"
                                ? "var(--pos)"
                                : c.sentimentLabel === "negative"
                                  ? "var(--hot)"
                                  : "var(--warn)",
                          }}
                          title={c.sentimentLabel ?? ""}
                        >
                          {c.sentiment}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px" }} className="mono">
                      {c.avgPosition != null ? c.avgPosition.toFixed(1) : "—"}
                    </td>
                    <td style={{ padding: "8px" }} className="mono">{c.citedIn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DOMAINS + SOURCES BY TYPE — where the models pull from, and the mix. */}
      {domainRows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr",
            borderBottom: "1px solid var(--grid-2)",
          }}
        >
          <div style={{ padding: "16px 20px 18px", borderRight: "1px solid var(--grid)", background: "var(--bg)" }}>
            <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-2)", margin: "0 0 10px" }}>
              ⛁ Top source domains
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--ink-3)", textAlign: "left" }}>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700 }}>Domain</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 130 }}>Type</th>
                  <th style={{ padding: "4px 8px 8px", fontWeight: 700, width: 80 }}>Used</th>
                </tr>
              </thead>
              <tbody>
                {domainRows.map((d) => (
                  <tr key={d.domain} style={{ borderTop: "1px solid var(--grid)" }}>
                    <td style={{ padding: "8px" }}>
                      <a href={`https://${d.domain}/`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--ink)", textDecoration: "none" }}>
                        <Favicon domain={d.domain} size={16} />
                        {d.domain}
                      </a>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span className="tm-badge" style={{ background: "var(--panel-2)", color: "var(--ink-2)" }}>{d.type}</span>
                    </td>
                    <td style={{ padding: "8px" }} className="mono">{d.used}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "16px 20px 18px", background: "var(--bg)" }}>
            <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink-2)", margin: "0 0 10px" }}>
              Sources by type
            </h2>
            {/* Stacked bar as the "by type" mix. */}
            <div style={{ display: "flex", height: 12, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
              {byType.map((t, i) => (
                <span key={t.key} title={`${t.label} ${t.pct}%`} style={{ width: `${t.pct}%`, background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
              ))}
            </div>
            {byType.map((t, i) => (
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: TYPE_COLORS[i % TYPE_COLORS.length], flexShrink: 0 }} />
                <span style={{ flex: 1, color: "var(--ink-2)" }}>{t.label}</span>
                <span className="mono" style={{ color: "var(--ink-3)" }}>{t.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tm-grid">
        {/* FOCAL: visibility gaps */}
      <div className="tm-panel tm-gap-span tm-reveal">
        <div className="tm-phead">
          <h2>◧ Visibility gaps · ranked by lost demand</h2>
          <span className="meta">
            {gaps.length} queries
            {llms.length > 1 ? ` × ${llms.length} LLMs` : ""}
          </span>
        </div>
        {gaps.length === 0 ? (
          <div className="tm-empty">No queries scored in this run yet.</div>
        ) : (
          gaps.map((g, i) => (
            <Link
              key={g.id}
              to="/queries"
              search={(prev) => ({ ...prev })}
              className={`tm-gap ${g.state}`}
            >
              <span className="tm-rank">{String(i + 1).padStart(2, "0")}</span>
              <div className="tm-q">
                <div className="t">{g.query}</div>
                <div className="s" dangerouslySetInnerHTML={subline(g, llms.length > 1)} />
                {llms.length > 1 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    {g.perLlm.map((c) => (
                      <span
                        key={c.llm}
                        title={`${LLM_LABEL[c.llm]} · ${
                          c.cited
                            ? `cited${c.position ? ` #${c.position}` : ""}`
                            : "absent"
                        }`}
                        className="mono"
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 2,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          background: c.cited ? "var(--pos-bg)" : "var(--hot-bg)",
                          color: c.cited ? "var(--pos)" : "var(--hot)",
                        }}
                      >
                        {LLM_SHORT[c.llm]}
                        {c.cited ? " ✓" : " ✗"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <BleedBar state={g.state} seed={i} />
              <div className="tm-gstate">
                <StatePill state={g.state} />
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Share of voice */}
      <div className="tm-panel tm-reveal" style={{ animationDelay: ".05s" }}>
        <div className="tm-phead">
          <h2>◫ Share of recommendations</h2>
          <span className="meta">brands named · this run</span>
        </div>
        <div className="tm-sov">
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              padding: "2px 0 14px",
            }}
          >
            {category && (
              <>
                <span style={{ color: "var(--ink-3)" }}>Category</span>{" "}
                <b style={{ color: "var(--ink)" }}>{category}</b>
                {"  ·  "}
              </>
            )}
            {leader && (
              <>
                <span style={{ color: "var(--ink-3)" }}>Most recommended</span>{" "}
                <b style={{ color: leader.isYou ? "var(--you)" : "var(--ink)" }}>
                  {leader.name}
                </b>{" "}
                <span className="mono">{leader.pct}%</span>
                {"  ·  "}
              </>
            )}
            <span style={{ color: "var(--ink-3)" }}>You</span>{" "}
            <b style={{ color: "var(--you)" }}>{youEntry ? youEntry.pct : 0}%</b>
            {youRank > 0 && (
              <span className="mono" style={{ color: "var(--ink-3)" }}>
                {" "}({ordinal(youRank)})
              </span>
            )}
          </div>
          {!hasSov && (
            <div className="tm-empty" style={{ padding: "28px 8px 8px" }}>
              No brands cited in this run yet.
            </div>
          )}
          <div className="tm-sov-chart">
            <div className="tm-yaxis">
              <span>{sovMax}%</span>
              <span>{Math.round(sovMax / 2)}%</span>
              <span>0</span>
            </div>
            <div className="tm-gridline" style={{ top: 0 }} />
            <div className="tm-gridline" style={{ top: "50%" }} />
            <div className="tm-gridline" style={{ bottom: "18px" }} />
            <div className="tm-sov-bars">
              {sov.map((s) => (
                <div className="tm-sov-col" key={s.name}>
                  <div
                    className="stk"
                    style={{ height: `${(s.pct / sovMax) * 100}%` }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        background: s.isYou ? "var(--you)" : "var(--ink-3)",
                      }}
                    />
                  </div>
                  <span
                    className="lbl"
                    style={
                      s.isYou
                        ? { color: "var(--you)", fontWeight: 700 }
                        : undefined
                    }
                  >
                    {s.name.length > 9 ? s.name.slice(0, 8) + "…" : s.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="tm-sov-legend">
            {sov.map((s) => (
              <div className="tm-lg" key={s.name}>
                <span
                  className="sq"
                  style={{
                    background: s.isYou ? "var(--you)" : "var(--ink-3)",
                  }}
                />
                <span className="nm">{s.name}</span>
                <b className="mono">
                  {s.isYou && s.pct === 0 ? "not cited" : `${s.pct}%`}
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trajectory + pattern */}
      <div
        className="tm-panel tm-reveal"
        style={{ borderBottom: "none", animationDelay: ".1s" }}
      >
        <div className="tm-phead">
          <h2>◰ Trajectory</h2>
          <span className="meta">{runs.length} runs</span>
        </div>
        <div className="tm-trend">
          <div>
            <div className="lab">Visibility index</div>
            <div className="big">
              {score}
              <small>/100</small>
            </div>
            {delta != null ? (
              <div className={`tm-chg mono ${delta >= 0 ? "up" : "down"}`}>
                {delta >= 0 ? "▲" : "▼"} {delta >= 0 ? `+${delta}` : delta} (
                {runs.length} runs)
              </div>
            ) : (
              <div className="tm-chg mono flat">— single run</div>
            )}
          </div>
          {scores.length >= 2 ? (
            <Sparkline values={scores} color="var(--pos)" />
          ) : null}
        </div>
        <div className="tm-insight">
          <div className="k">⚑ The pattern</div>
          <p>
            {total === 0 ? (
              <>No queries in this run yet.</>
            ) : absent === 0 && weak === 0 ? (
              <>
                You're cited on <b>all {total}</b> queries
                {youEntry ? (
                  <>
                    {" "}and hold <b>{youEntry.pct}%</b> of citation share
                  </>
                ) : null}
                . No blind spots — defend these and watch for competitors
                climbing into the answers.
              </>
            ) : absent === 0 ? (
              <>
                You're cited on every query but ranked low on <b>{weak}</b> —
                strengthen those pages before competitors climb above you.
              </>
            ) : held === 0 ? (
              <>
                You're invisible on <b>{absent}</b> of <b>{total}</b> queries —
                competitors own this category in ChatGPT. Start with the
                highest-intent gaps above.
              </>
            ) : (
              <>
                You hold <b>{held}</b> queries but are invisible on{" "}
                <b>{absent}</b> — including high-intent ones where competitors
                are cited and you are not. Close the blind spots before
                defending what you already own.
              </>
            )}
          </p>
        </div>
      </div>
      </div>
    </>
  );
}
