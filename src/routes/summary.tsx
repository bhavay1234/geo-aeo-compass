import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import {
  BleedBar,
  StatePill,
  Favicon,
  LlmIcon,
  InfoTip,
  Icon,
  Gauge,
  Donut,
  scoreBand,
  type IconName,
} from "@/components/terminal/primitives";
import type { ReactNode } from "react";
import {
  buildGapRows,
  buildLlmScorecards,
  computeShareOfVoice,
  buildCompetitorTable,
  buildDomainStats,
  llmsPolled,
  normalizeLlm,
  topGetListedTargets,
  type GapRow,
  type CompetitorRow,
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
  head: () => ({ meta: [{ title: "Overview · Compass" }] }),
  component: SummaryPage,
});

/** Card section header: accent icon + title + optional info tip + right action. */
function Head({
  icon,
  title,
  tip,
  action,
  border,
}: {
  icon: IconName;
  title: string;
  tip?: string;
  action?: ReactNode;
  border?: boolean;
}) {
  return (
    <div className={`tm-ch ${border ? "bd" : ""}`}>
      <h3>
        <span className="ico"><Icon name={icon} size={17} /></span>
        {title}
        {tip && <InfoTip text={tip} />}
      </h3>
      {action}
    </div>
  );
}

/** Metric mini-card: label + big number (+ optional suffix, tone, footnote). */
function MetricBox({
  label,
  value,
  suffix,
  tone,
  foot,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  tone?: "pos" | "neg" | "hot";
  foot?: ReactNode;
}) {
  return (
    <div className="tm-mbox">
      <span className="lab">{label}</span>
      <span className={`num ${tone ?? ""}`}>
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      {foot && <span className="foot">{foot}</span>}
    </div>
  );
}

/** Visibility-over-runs line chart (own brand) - a fuller, dated trend than the
 *  trajectory sparkline. Competitor lines will layer in once per-run SoV
 *  snapshots accumulate across audits. */
function TrendChart({ scores, dates }: { scores: number[]; dates: string[] }) {
  const w = 680;
  const h = 150;
  const padX = 10;
  const padY = 14;
  const n = scores.length;
  const x = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * padX));
  const y = (v: number) => h - padY - (Math.max(0, Math.min(100, v)) / 100) * (h - 2 * padY);
  const line = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${(h - padY).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${(h - padY).toFixed(1)}`;
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
        {[0, 25, 50, 75, 100].map((g) => (
          <line key={g} x1={padX} x2={w - padX} y1={y(g)} y2={y(g)} stroke="var(--grid)" strokeWidth={1} />
        ))}
        <polygon points={area} fill="var(--you)" opacity={0.1} />
        <polyline points={line} fill="none" stroke="var(--you)" strokeWidth={2.5} strokeLinejoin="round" />
        {scores.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s)} r={3.5} fill="var(--you)" stroke="var(--bg)" strokeWidth={1.5} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{fmt(dates[0])}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{fmt(dates[dates.length - 1])}</span>
      </div>
    </div>
  );
}

type Metric = "visibility" | "sentiment" | "position";

/** Tabbed competitor comparison - Visibility / Sentiment / Position, mirroring a
 *  tracking dashboard's metric toggle (bars, since trend needs multiple runs). */
function MetricComparison({ rows }: { rows: CompetitorRow[] }) {
  const hasSent = rows.some((r) => r.sentiment != null);
  const [metric, setMetric] = useState<Metric>("visibility");
  const m: Metric = metric === "sentiment" && !hasSent ? "visibility" : metric;
  const tabs: { k: Metric; label: string }[] = [
    { k: "visibility", label: "Visibility" },
    ...(hasSent ? [{ k: "sentiment" as Metric, label: "Sentiment" }] : []),
    { k: "position", label: "Position" },
  ];
  const maxPos = Math.max(2, ...rows.map((r) => r.avgPosition ?? 0));
  const rawVal = (r: CompetitorRow) =>
    m === "visibility" ? r.visibilityPct : m === "sentiment" ? r.sentiment ?? 0 : r.avgPosition;
  const barPct = (r: CompetitorRow) => {
    if (m === "position") {
      const p = r.avgPosition;
      return p == null ? 0 : Math.round((1 - (p - 1) / (maxPos - 1)) * 100);
    }
    return (rawVal(r) as number) ?? 0;
  };
  const display = (r: CompetitorRow) =>
    m === "position"
      ? r.avgPosition != null
        ? r.avgPosition.toFixed(1)
        : "-"
      : `${(rawVal(r) as number) ?? 0}${m === "visibility" ? "%" : ""}`;
  const sorted = [...rows].sort((a, b) =>
    m === "position"
      ? (a.avgPosition ?? 99) - (b.avgPosition ?? 99)
      : ((rawVal(b) as number) ?? 0) - ((rawVal(a) as number) ?? 0)
  );
  const hint =
    m === "position" ? "lower is better · longer bar = better rank" : "higher is better";

  return (
    <div style={{ padding: "14px 0 2px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 3, background: "var(--panel-2)", borderRadius: 8 }}>
          {tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setMetric(t.k)}
              style={{
                border: "none",
                borderRadius: 6,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: m === t.k ? "var(--bg)" : "transparent",
                color: m === t.k ? "var(--ink)" : "var(--ink-2)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {hint}
          <InfoTip text="Visibility = share of recommendations across queries. Position = average rank where named (lower is better; the bar inverts so a longer bar = a better rank). Sentiment = 0–100 score of how positively each brand is described (gpt-4o-mini over the answers). Same data as the table below." />
        </span>
      </div>
      {sorted.map((r) => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: 150, minWidth: 150 }}>
            <Favicon domain={r.domain} size={15} />
            <span style={{ fontSize: 12.5, fontWeight: r.isYou ? 800 : 500, color: r.isYou ? "var(--you)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </span>
          </span>
          <span style={{ flex: 1, height: 8, background: "var(--grid)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, barPct(r)))}%`, background: r.isYou ? "var(--you)" : "var(--ink-3)" }} />
          </span>
          <span className="mono" style={{ fontSize: 12, width: 46, textAlign: "right", color: "var(--ink-2)", fontWeight: 700 }}>
            {display(r)}
          </span>
        </div>
      ))}
    </div>
  );
}

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
    if (g.who.length === 0) return { __html: `competitors cited - ${where}` };
    const names =
      g.who.length > 3
        ? `<b>${g.who.length} competitors</b>`
        : `<b>${g.who.join(" · ")}</b>`;
    return { __html: `${names} recommended - ${where}` };
  }
  if (g.state === "weak") {
    // Multi-LLM "weak" usually means partial coverage (cited in some LLMs,
    // absent in others) - say that, not "buried", when it's the real story.
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

export function SummaryView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const { audits } = useWorkspace();
  const brand = audit.brand_name;
  const gaps = buildGapRows(audit, polls);
  const sovFull = computeShareOfVoice(audit, polls);
  const llms = llmsPolled(audit);
  const scorecards = buildLlmScorecards(audit, polls);

  // Off-page "where to get cited" rollup - the core AEO action, surfaced up top.
  const citeEntries = (audit.citation_analysis ?? []) as CitationAnalysisEntry[];
  const titleByUrl = new Map<string, string>();
  for (const p of polls)
    for (const c of p.citations ?? [])
      if (c.url && c.title && !titleByUrl.has(c.url)) titleByUrl.set(c.url, c.title);
  const getListed = topGetListedTargets(audit, citeEntries, titleByUrl, 6);
  const citationsAnalyzing =
    audit.citation_status === "analyzing" || audit.citation_status == null;
  // Per-model filter - recompute the competitor comparison for one LLM or all.
  const [model, setModel] = useState<"all" | LlmSource>("all");
  const modelPolls =
    model === "all" ? polls : polls.filter((p) => normalizeLlm(p.llm_source) === model);
  const compTableFull = buildCompetitorTable(audit, modelPolls);
  // Cap at the top 10 by visibility, but always keep the brand's own row.
  const compTable = (() => {
    const head = compTableFull.slice(0, 10);
    if (compTableFull.some((r) => r.isYou) && !head.some((r) => r.isYou)) {
      return [...head.slice(0, 9), compTableFull.find((r) => r.isYou)!];
    }
    return head;
  })();
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
  // Per-LLM answers = queries × LLMs - the buyer-facing denominator on multi-LLM
  // audits ("invisible in N of {queries × 3} high-intent AI answers").
  const total = gaps.length;
  const absent = gaps.filter((g) => g.state === "absent").length;
  const weak = gaps.filter((g) => g.state === "weak").length;
  const held = gaps.filter((g) => g.state === "held").length;
  // Answer counts come from ACTUAL captured polls - identical to the
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

  // Always show the brand in the SoV chart - at 0% ("not cited") if absent - so
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
  const trendDates = runs.map((r) => r.created_at as string);
  const score = audit.visibility_score ?? 0;
  const delta =
    scores.length >= 2 ? score - scores[scores.length - 2] : null;

  const compClause =
    topComps.length > 0 ? (
      <>
        {" "}- competitors like{" "}
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
      <>Run in progress - no queries scored yet.</>
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
            {" "}- <b style={{ color: "var(--ink)" }}>{topComps.join(" and ")}</b>{" "}
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
  const cited = totalAnswers - absentAnswers;
  const band = scoreBand(score);
  const competitorCount = compTableFull.filter((c) => !c.isYou).length;
  const bandBlurb =
    total === 0
      ? "Audit still running. The score will settle once every query is answered."
      : score >= 67
        ? `${brand} is consistently surfaced in AI answers. Defend these positions and widen your lead.`
        : score >= 34
          ? `${brand} is occasionally mentioned in AI answers, but visibility can improve.`
          : `${brand} rarely appears in AI answers yet. There is a lot of ground to gain.`;
  const donutSlices = byType.map((t, i) => ({
    label: t.label,
    pct: t.pct,
    color: TYPE_COLORS[i % TYPE_COLORS.length],
  }));

  return (
    <div className="tm-page">
      {/* HERO: AI Visibility gauge + verdict + key metrics */}
      <div className="tm-row hero">
        <div
          className="tm-c"
          style={{ padding: "16px 16px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "stretch" }}>
            <span style={{ color: "var(--accent)", display: "inline-flex" }}>
              <Icon name="gauge" size={17} />
            </span>
            <h3 style={{ fontSize: 13.5, fontWeight: 800, margin: 0, color: "var(--ink)" }}>AI Visibility</h3>
            <InfoTip text="A 0 to 100 index of how present your brand is across the AI answers in this audit. It blends how often you are named in answers and how often your own domain is cited as a source, averaged over every query and engine. Weak 0 to 33, Medium 34 to 66, Strong 67 plus." />
          </div>
          <Gauge value={score} label={band.label} size={196} />
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.5, margin: "2px 4px 0" }}>
            {bandBlurb}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className={`tm-callout ${total === 0 ? "warnbg" : absent > 0 ? "hotbg" : weak > 0 ? "warnbg" : "posbg"}`}>
            {verdict}
          </div>
          <div className="tm-row c4">
            <MetricBox
              label="Answers cited"
              value={`${cited}/${totalAnswers}`}
              tone={cited > 0 ? "pos" : "hot"}
              foot={llms.length > 1 ? `across ${llms.length} engines` : "AI answers"}
            />
            <MetricBox
              label="Blind spots"
              value={absentAnswers}
              tone={absentAnswers > 0 ? "hot" : "pos"}
              foot="answers with no mention"
            />
            <MetricBox
              label="Competitors"
              value={competitorCount}
              foot="named in the answers"
            />
            <MetricBox
              label="Your rank"
              value={youRank > 0 ? ordinal(youRank) : "unranked"}
              foot={leader ? `leader ${leader.name}` : "share of voice"}
            />
          </div>
        </div>
      </div>

      {/* VISIBILITY TREND across runs */}
      {scores.length >= 2 && (
        <div className="tm-c">
          <Head
            icon="trend"
            title="Visibility trend"
            tip="Your visibility index (0 to 100) for each completed run of this brand, oldest to newest. Re-run the audit periodically to track whether your AI presence is improving."
            border
            action={
              <span className="pill">
                {runs.length} runs · now {score}/100
                {delta != null && (
                  <b style={{ marginLeft: 6, color: delta >= 0 ? "var(--pos)" : "var(--hot)" }}>
                    {delta >= 0 ? `+${delta}` : delta}
                  </b>
                )}
              </span>
            }
          />
          <div className="tm-c-pad">
            <TrendChart scores={scores} dates={trendDates} />
          </div>
        </div>
      )}

      {/* GAPS + SHARE OF RECOMMENDATIONS */}
      <div className="tm-row split">
        <div className="tm-c">
          <Head
            icon="target"
            title="Visibility gaps"
            tip="Every query in this audit, ranked by lost demand: queries where competitors are recommended and you are absent rank highest. Click any row to read the full answers on the Queries tab."
            border
            action={
              <Link to="/queries" search={(prev) => ({ ...prev })} className="act">
                All queries <Icon name="arrow" size={13} />
              </Link>
            }
          />
          {gaps.length === 0 ? (
            <div className="tm-empty">No queries scored in this run yet.</div>
          ) : (
            gaps.slice(0, 8).map((g, i) => (
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
                            c.cited ? `cited${c.position ? ` #${c.position}` : ""}` : "absent"
                          }`}
                          className="mono"
                          style={{
                            fontSize: 9,
                            padding: "1px 5px",
                            borderRadius: 4,
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

        <div className="tm-c">
          <Head
            icon="bars"
            title="Share of recommendations"
            tip="Across every query, how often each brand is named in the answers, as a share of all brand mentions this run. Your brand is highlighted."
            border
          />
          <div className="tm-c-pad">
            <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 14 }}>
              {category && (
                <>
                  <span style={{ color: "var(--ink-3)" }}>Category</span>{" "}
                  <b style={{ color: "var(--ink)" }}>{category}</b>
                  {leader ? "  ·  " : ""}
                </>
              )}
              {leader && (
                <>
                  <span style={{ color: "var(--ink-3)" }}>Most recommended</span>{" "}
                  <b style={{ color: leader.isYou ? "var(--you)" : "var(--ink)" }}>{leader.name}</b>{" "}
                  <span className="mono">{leader.pct}%</span>
                </>
              )}
            </div>
            {!hasSov ? (
              <div className="tm-empty" style={{ padding: "20px 8px" }}>No brands cited in this run yet.</div>
            ) : (
              <div className="tm-hbars">
                {sov.map((s) => (
                  <div className="tm-hbar" key={s.name}>
                    <span className={`nm ${s.isYou ? "you" : ""}`}>
                      <Favicon domain={s.domain || ""} size={15} />
                      {s.name}
                    </span>
                    <span className="track">
                      <span
                        className="fill"
                        style={{
                          width: `${Math.max(2, (s.pct / sovMax) * 100)}%`,
                          background: s.isYou ? "var(--you)" : "var(--ink-3)",
                        }}
                      />
                    </span>
                    <span className="val">{s.isYou && s.pct === 0 ? "-" : `${s.pct}%`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SOURCES: top domains table + sources-by-type donut */}
      {domainRows.length > 0 && (
        <div className="tm-row split">
          <div className="tm-c">
            <Head
              icon="layers"
              title="Top source domains"
              tip="Every URL the engines cited across the audit, grouped by domain. Used is that domain's share of all cited sources. Type is the page category inferred from the URL and domain."
              border
            />
            <div style={{ padding: "6px 6px 4px" }}>
              <table className="tm-table">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th style={{ width: 130 }}>Type</th>
                    <th style={{ width: 70 }}>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {domainRows.map((d) => (
                    <tr key={d.domain}>
                      <td>
                        <a
                          href={`https://${d.domain}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ink)", textDecoration: "none", fontWeight: 600 }}
                        >
                          <Favicon domain={d.domain} size={16} />
                          {d.domain}
                        </a>
                      </td>
                      <td>
                        <span className="tm-badge" style={{ background: "var(--panel-2)", color: "var(--ink-2)" }}>{d.type}</span>
                      </td>
                      <td className="mono">{d.used}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tm-c">
            <Head
              icon="pie"
              title="Sources by type"
              tip="The mix of page types the engines pulled from, as a share of all cited sources. Categories are inferred from each cited URL and domain."
              border
            />
            <div className="tm-c-pad" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
              <Donut
                slices={donutSlices}
                size={140}
                thickness={20}
                center={
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-.03em", lineHeight: 1 }}>
                      {domainRows.length}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 600 }}>domains</div>
                  </div>
                }
              />
              <div className="tm-leg" style={{ flex: 1, minWidth: 150 }}>
                {byType.map((t, i) => (
                  <div className="it" key={t.key}>
                    <span className="sq" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                    <span className="nm">{t.label}</span>
                    <span className="v">{t.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VISIBILITY BY ENGINE (multi-LLM only) */}
      {llms.length > 1 && (
        <div className="tm-c">
          <Head
            icon="bars"
            title="Visibility by engine"
            tip="Per-engine visibility is the share of that engine's answers where your brand is named in the answer text. Computed over only that engine's answers."
            border
          />
          <div className="tm-c-pad tm-hbars">
            {scorecards.map((s) => {
              const c =
                s.visibility >= 67 ? "var(--pos)" : s.visibility > 0 ? "var(--warn)" : "var(--hot)";
              return (
                <div className="tm-hbar" key={s.llm} style={{ gridTemplateColumns: "150px 1fr 170px" }}>
                  <span className="nm">
                    <LlmIcon llm={s.llm} size={16} />
                    {LLM_LABEL[s.llm]}
                  </span>
                  <span className="track">
                    <span className="fill" style={{ width: `${s.answers ? s.visibility : 0}%`, background: c }} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                      named {s.namedIn}/{s.answers} · cited {s.citedIn}/{s.answers}
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 15, color: c, minWidth: 26, textAlign: "right" }}>
                      {s.answers ? s.visibility : "-"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* COMPETITORS: metric toggle + comparison bars + detail table */}
      {compTable.length > 0 && (
        <div className="tm-c">
          <Head
            icon="competitors"
            title="Competitors · you vs the field"
            tip="Visibility is share of recommendations across every query. Avg position is the mean rank in the answers where the brand is named (1 is named first). Sentiment is a 0 to 100 score of how positively the brand is described. Queries is the count of distinct queries where the brand is named."
            border
            action={
              llms.length > 1 ? (
                <div className="tm-seg2">
                  {(["all", ...llms] as const).map((opt) => (
                    <button key={opt} className={model === opt ? "on" : ""} onClick={() => setModel(opt)}>
                      {opt !== "all" && <LlmIcon llm={opt} size={13} />}
                      {opt === "all" ? "All" : LLM_LABEL[opt]}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          />
          <div className="tm-c-pad" style={{ paddingTop: 4 }}>
            <MetricComparison rows={compTable} />
            <div style={{ overflowX: "auto", marginTop: 4 }}>
              <table className="tm-table">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th style={{ width: 200 }}>Visibility</th>
                    <th style={{ width: 100 }}>Sentiment</th>
                    <th style={{ width: 90 }}>Avg position</th>
                    <th style={{ width: 70 }}>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  {compTable.map((c) => (
                    <tr key={c.name} className={c.isYou ? "you-row" : ""}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Favicon domain={c.domain} size={16} />
                          <span style={{ fontWeight: c.isYou ? 800 : 600, color: c.isYou ? "var(--you)" : "var(--ink)" }}>
                            {c.name}
                          </span>
                          {c.isYou && <span className="tm-badge" style={{ background: "var(--panel)", color: "var(--you)" }}>you</span>}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ width: 34, color: "var(--ink-2)" }}>{c.visibilityPct}%</span>
                          <span style={{ flex: 1, height: 7, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden", maxWidth: 150 }}>
                            <span style={{ display: "block", height: "100%", width: `${c.visibilityPct}%`, background: c.isYou ? "var(--you)" : "var(--ink-3)" }} />
                          </span>
                        </span>
                      </td>
                      <td>
                        {c.sentiment == null ? (
                          <span className="mono" style={{ color: "var(--ink-3)" }}>-</span>
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
                      <td className="mono">{c.avgPosition != null ? c.avgPosition.toFixed(1) : "-"}</td>
                      <td className="mono">{c.citedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* WHERE TO GET CITED: off-page targets */}
      <div className="tm-c">
        <Head
          icon="flag"
          title="Where to get cited"
          tip="Third-party pages the engines already cite that do not mention your brand yet, ranked by cross-engine leverage. Excludes your own pages, homepages, single-product profiles, off-niche sources, and dead links."
          border
          action={
            <Link to="/citations" search={(prev) => ({ ...prev })} className="act">
              Full worklist <Icon name="arrow" size={13} />
            </Link>
          }
        />
        <div className="tm-c-pad">
          <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "0 0 12px", maxWidth: 900, lineHeight: 1.5 }}>
            Third-party pages the AI engines already pull from that{" "}
            <b style={{ color: "var(--ink)" }}>do not mention {brand} yet</b>. These are the highest-leverage
            places to get listed so you start showing up in answers.
          </p>
          {getListed.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {citationsAnalyzing
                ? "Analyzing where the AI engines source their answers…"
                : "No missing off-page targets found for this run."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {getListed.map((t, i) => (
                <div
                  key={t.url}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 11,
                    padding: "10px 0",
                    borderTop: i > 0 ? "1px solid var(--grid)" : "none",
                  }}
                >
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", width: 18 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Favicon domain={t.domain} size={16} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                      {t.title || t.domain}
                    </a>
                    <span style={{ fontSize: 10, marginLeft: 8, padding: "1px 6px", borderRadius: 5, background: "var(--panel-2)", color: "var(--ink-3)" }}>
                      {t.label}
                    </span>
                    {t.reason && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.45 }}>{t.reason}</div>
                    )}
                  </div>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                    {t.llms.map((l) => LLM_SHORT[l]).join(" · ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
