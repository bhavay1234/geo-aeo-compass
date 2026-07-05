import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import {
  Favicon,
  LlmIcon,
  InfoTip,
  Icon,
  RingGauge,
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
  type LlmScorecard,
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

/** Card section header: accent icon + title (+ subtitle, info tip, right action). */
function Head({
  icon,
  title,
  sub,
  tip,
  action,
  border,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  tip?: string;
  action?: ReactNode;
  border?: boolean;
}) {
  return (
    <div className={`tm-ch ${border ? "bd" : ""}`}>
      <div style={{ minWidth: 0 }}>
        <h3>
          <span className="ico"><Icon name={icon} size={17} /></span>
          {title}
          {tip && <InfoTip text={tip} />}
        </h3>
        {sub && <div className="sub" style={{ marginTop: 3 }}>{sub}</div>}
      </div>
      {action && <div style={{ marginLeft: "auto", flexShrink: 0 }}>{action}</div>}
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
  tip,
  right,
  chip,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  tone?: "pos" | "neg" | "hot";
  foot?: ReactNode;
  tip?: string;
  right?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <div className="tm-mbox">
      <span className="lab">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className={`num ${tone ?? ""}`} style={{ flex: 1, minWidth: 0 }}>
          {value}
          {suffix && <small> {suffix}</small>}
          {chip && <span style={{ marginLeft: 8, verticalAlign: "middle" }}>{chip}</span>}
        </span>
        {right}
      </span>
      {foot && <span className="foot">{foot}</span>}
    </div>
  );
}

/** Visibility-over-runs line chart (own brand) - a fuller, dated trend than the
 *  trajectory sparkline. Competitor lines will layer in once per-run SoV
 *  snapshots accumulate across audits. */
function TrendChart({ scores, dates }: { scores: number[]; dates: string[] }) {
  const w = 960;
  const h = 264;
  const padL = 34;
  const padR = 14;
  const padY = 18;
  const n = scores.length;
  // Dynamic domain so score movement is visually meaningful (never a flat line
  // hugging the bottom of a fixed 0-100 axis).
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const lo = Math.max(0, Math.floor((rawMin - 8) / 10) * 10);
  const hi = Math.min(100, Math.ceil((rawMax + 8) / 10) * 10);
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const y = (v: number) => h - padY - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * (h - 2 * padY);
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
    <figure style={{ margin: 0 }} aria-label={`AI visibility across ${n} audits, from ${scores[0]} to ${scores[n - 1]} out of 100`}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
        {ticks.map((g) => (
          <g key={g}>
            <line x1={padL} x2={w - padR} y1={y(g)} y2={y(g)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 8} y={y(g) + 3.5} textAnchor="end" style={{ fontSize: 11, fill: "var(--ink-3)" }}>
              {Math.round(g)}
            </text>
          </g>
        ))}
        <polygon points={area} fill="var(--you)" opacity={0.08} />
        <polyline points={line} fill="none" stroke="var(--you)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {scores.map((s, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(s)}
            r={i === n - 1 ? 4.5 : 3}
            fill={i === n - 1 ? "var(--you)" : "var(--panel)"}
            stroke="var(--you)"
            strokeWidth={i === n - 1 ? 2 : 1.6}
          >
            <title>{`${fmt(dates[i])} · visibility ${s}/100${i > 0 ? ` · ${s - scores[i - 1] >= 0 ? "+" : ""}${s - scores[i - 1]} vs prior` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: padL }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmt(dates[0])}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{fmt(dates[dates.length - 1])}</span>
      </div>
    </figure>
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

/** Domain-level multi-LLM presence: per-engine Mentions vs Cited, as bars. */
function DistributionByLlm({ scorecards }: { scorecards: LlmScorecard[] }) {
  const [metric, setMetric] = useState<"mentions" | "cited">("mentions");
  const val = (s: LlmScorecard) => (metric === "mentions" ? s.namedIn : s.citedIn);
  return (
    <div className="tm-c">
      <Head
        icon="layers"
        title="Distribution by LLM"
        tip="How present your brand is inside each engine's answers. Mentions counts answers where your brand is named in the text. Cited counts answers whose sources include your own domain. Each is measured over only that engine's answers in this audit."
        border
        action={
          <div className="tm-seg2">
            <button className={metric === "mentions" ? "on" : ""} onClick={() => setMetric("mentions")}>
              Mentions
            </button>
            <button className={metric === "cited" ? "on" : ""} onClick={() => setMetric("cited")}>
              Cited
            </button>
          </div>
        }
      />
      <div className="tm-c-pad tm-hbars">
        {scorecards.map((s) => {
          const v = val(s);
          const pct = s.answers ? Math.round((v / s.answers) * 100) : 0;
          const c = pct >= 67 ? "var(--pos)" : pct > 0 ? "var(--warn)" : "var(--hot)";
          return (
            <div className="tm-hbar" key={s.llm} style={{ gridTemplateColumns: "160px 1fr 118px" }}>
              <span className="nm">
                <LlmIcon llm={s.llm} size={17} />
                {LLM_LABEL[s.llm]}
              </span>
              <span className="track">
                <span className="fill" style={{ width: `${pct}%`, background: c }} />
              </span>
              <span style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
                  {v}
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}>
                    /{s.answers}
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: c, minWidth: 34, textAlign: "right" }}>
                  {pct}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact status badge: soft tint + readable text, icon optional. */
function StatusChip({
  tone,
  children,
  icon,
}: {
  tone: "pos" | "warn" | "hot" | "neutral" | "you";
  children: ReactNode;
  icon?: IconName;
}) {
  const map = {
    pos: { bg: "var(--pos-bg)", fg: "var(--pos)" },
    warn: { bg: "var(--warn-bg)", fg: "var(--warn)" },
    hot: { bg: "var(--hot-bg)", fg: "var(--hot)" },
    you: { bg: "var(--you-bg)", fg: "var(--you)" },
    neutral: { bg: "var(--panel-2)", fg: "var(--ink-2)" },
  }[tone];
  return (
    <span className="tm-badge" style={{ background: map.bg, color: map.fg }}>
      {icon && <Icon name={icon} size={11} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

/** Per-engine coverage chip: engine mark + mentioned/absent state (icon + label). */
function EngineChip({ llm, cited, position }: { llm: LlmSource; cited: boolean; position?: number | null }) {
  return (
    <span
      className="tm-echip"
      style={{ height: 24, padding: "0 8px", gap: 5, fontSize: 11.5, color: cited ? "var(--pos)" : "var(--ink-3)", borderColor: cited ? "color-mix(in srgb,var(--pos) 30%,transparent)" : "var(--grid)" }}
      title={`${LLM_LABEL[llm]}: ${cited ? `mentioned${position ? `, position ${position}` : ""}` : "not mentioned"}`}
    >
      <LlmIcon llm={llm} size={12} />
      <Icon name={cited ? "check" : "x"} size={11} strokeWidth={2.4} />
    </span>
  );
}

/** Executive priority insight - replaces the loud alert banner. */
function PriorityInsight({
  brand,
  absentAnswers,
  totalAnswers,
  weak,
  total,
  topComps,
  competitorCount,
  llmCount,
}: {
  brand: string;
  absentAnswers: number;
  totalAnswers: number;
  weak: number;
  total: number;
  topComps: string[];
  competitorCount: number;
  llmCount: number;
}) {
  const level: "hot" | "warn" | "pos" =
    absentAnswers > 0 ? "hot" : weak > 0 ? "warn" : "pos";
  const accent = level === "hot" ? "var(--hot)" : level === "warn" ? "var(--warn)" : "var(--pos)";
  const label = level === "pos" ? "On track" : "High priority";
  const headline =
    total === 0
      ? "Audit in progress"
      : level === "hot"
        ? `${brand} is missing from ${absentAnswers} high-intent AI answer${absentAnswers === 1 ? "" : "s"}`
        : level === "warn"
          ? `${brand} ranks below the top answer on ${weak} quer${weak === 1 ? "y" : "ies"}`
          : `${brand} is mentioned across all ${total} tracked queries`;
  const description =
    total === 0
      ? "Results will land here as each query completes."
      : level === "hot"
        ? `Competitors${topComps.length ? ` including ${topComps.join(" and ")}` : ""} are being recommended on category prompts where ${brand} has no visibility.`
        : level === "warn"
          ? `${topComps.length ? `${topComps.join(" and ")} are` : "Competitors are"} cited above ${brand} on prompts it already appears in. Strengthening those pages defends the position.`
          : "No blind spots in this run. Defend these positions and watch for competitors climbing into the answers.";
  return (
    <section
      className="tm-c"
      style={{ borderLeft: `3px solid ${accent}`, padding: "18px 20px" }}
      aria-label="Priority insight"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: accent, display: "inline-flex" }}>
          <Icon name={level === "pos" ? "shield" : "alert"} size={15} strokeWidth={1.9} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", textTransform: "uppercase", color: accent }}>
          {label}
        </span>
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-.02em", color: "var(--ink)", margin: "8px 0 4px", lineHeight: 1.3 }}>
        {headline}
      </h2>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 760, margin: 0, lineHeight: 1.55 }}>
        {description}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
          <b className="num" style={{ color: "var(--ink)" }}>{absentAnswers}</b> blind spots
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
          <b className="num" style={{ color: "var(--ink)" }}>{competitorCount}</b> competitors mentioned
        </span>
        {llmCount > 1 && (
          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
            across <b className="num" style={{ color: "var(--ink)" }}>{llmCount}</b> engines
          </span>
        )}
        <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          Estimated opportunity:{" "}
          <b style={{ color: accent }}>{level === "hot" ? "High" : level === "warn" ? "Medium" : "Maintain"}</b>
        </span>
        <span className="tm-spacer" />
        <Link to="/queries" search={(prev) => ({ ...prev })} className="tm-btn tm-btn-sm" style={{ textDecoration: "none" }}>
          View blind spots
        </Link>
        <Link to="/competitors" search={(prev) => ({ ...prev })} className="tm-btn tm-btn-ghost tm-btn-sm" style={{ textDecoration: "none" }}>
          Competitor evidence
        </Link>
      </div>
    </section>
  );
}

interface RecoAction {
  title: string;
  detail: string;
  impact: "High" | "Medium";
  effort: "Low" | "Medium" | "High";
  evidence: string[];
}

/** Prioritized opportunities from real suggestion + citation data. */
function RecommendedActions({ actions }: { actions: RecoAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="tm-c">
      <Head
        icon="bolt"
        title="Recommended actions"
        tip="Prioritized opportunities based on blind spots, cited sources, and competitor visibility in this run. Each action links to the evidence behind it."
        border
        action={
          <Link to="/actions" search={(prev) => ({ ...prev })} className="act">
            Action center <Icon name="arrow" size={13} />
          </Link>
        }
      />
      <div className="tm-row c3" style={{ gap: 0 }}>
        {actions.map((a, i) => (
          <div
            key={i}
            style={{
              padding: "16px 20px 18px",
              borderRight: i < actions.length - 1 ? "1px solid var(--grid)" : "none",
              borderTop: "none",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <StatusChip tone={a.impact === "High" ? "hot" : "warn"}>{a.impact} impact</StatusChip>
              <StatusChip tone="neutral">{a.effort} effort</StatusChip>
            </div>
            <div className="tm-clamp4" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", lineHeight: 1.5, letterSpacing: "-.01em" }}>
              {a.title}
            </div>
            {a.detail && (
              <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "6px 0 0", lineHeight: 1.5 }}>{a.detail}</p>
            )}
            {a.evidence.length > 0 && (
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {a.evidence.map((e, j) => (
                  <li key={j} style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--ink-3)", flexShrink: 0, transform: "translateY(-2.5px)" }} />
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
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
  const cited = totalAnswers - absentAnswers;
  const band = scoreBand(score);
  const competitorCount = compTableFull.filter((c) => !c.isYou).length;
  const deltaFirst = scores.length >= 2 ? score - scores[0] : null;
  const donutSlices = byType.map((t, i) => ({
    label: t.label,
    pct: t.pct,
    color: TYPE_COLORS[i % TYPE_COLORS.length],
  }));

  // One representative (highest-severity) suggestion per query, for the
  // recommended-actions rail and the gaps table's next-move column.
  const SEV_RANK = { high: 3, medium: 2, low: 1 } as const;
  const sugByQuery = new Map<string, NonNullable<PollResult["suggestion"]>>();
  for (const p of polls) {
    if (!p.suggestion || p.suggestion.situation === "winning") continue;
    const prev = sugByQuery.get(p.query_text);
    if (!prev || SEV_RANK[p.suggestion.severity] > SEV_RANK[prev.severity]) {
      sugByQuery.set(p.query_text, p.suggestion);
    }
  }
  const recoActions: RecoAction[] = [];
  for (const g of gaps) {
    if (recoActions.length >= 3) break;
    if (g.state === "held") continue;
    const sug = sugByQuery.get(g.query);
    if (!sug) continue;
    const ev: string[] = [];
    if (g.absentLlms.length > 0)
      ev.push(`Missing from ${g.absentLlms.map((l) => LLM_LABEL[l]).join(", ")}`);
    if (g.who.length > 0)
      ev.push(
        `${g.who.slice(0, 2).join(" and ")}${g.who.length > 2 ? ` +${g.who.length - 2} more` : ""} recommended instead`
      );
    const srcCount = polls
      .filter((p) => p.query_text === g.query)
      .reduce((n, p) => n + (p.citations?.length ?? 0), 0);
    if (srcCount > 0) ev.push(`${srcCount} sources cited across engines`);
    recoActions.push({
      title: sug.action,
      detail: `Prompt: "${g.query}"`,
      impact: g.state === "absent" ? "High" : "Medium",
      effort: g.state === "absent" ? "Medium" : "Low",
      evidence: ev,
    });
  }
  if (recoActions.length < 3 && getListed.length > 0) {
    const t = getListed[0];
    recoActions.push({
      title: `Get listed on ${t.domain}`,
      detail: t.reason || t.title || "",
      impact: "High",
      effort: "Medium",
      evidence: [
        `Already cited by ${t.llms.map((l) => LLM_LABEL[l]).join(", ")}`,
        `${t.label} page in the engines' source set`,
      ],
    });
  }

  const stateChip = (g: GapRow) =>
    g.state === "absent" ? (
      <StatusChip tone="hot">Invisible</StatusChip>
    ) : g.state === "weak" ? (
      <StatusChip tone="warn">Weak</StatusChip>
    ) : g.position === 1 ? (
      <StatusChip tone="pos">Leading</StatusChip>
    ) : (
      <StatusChip tone="pos">Competitive</StatusChip>
    );

  return (
    <div className="tm-page">
      {/* 1 · PRIORITY INSIGHT */}
      <PriorityInsight
        brand={brand}
        absentAnswers={absentAnswers}
        totalAnswers={totalAnswers}
        weak={weak}
        total={total}
        topComps={topComps}
        competitorCount={competitorCount}
        llmCount={llms.length}
      />

      {/* 2 · KPI ROW */}
      <div className="tm-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))" }}>
        <MetricBox
          label="AI Visibility"
          tip="A 0 to 100 index of how present your brand is across the AI answers in this audit. It blends how often you are named in answers and how often your own domain is cited as a source. Weak 0-33, Medium 34-66, Strong 67+."
          value={score}
          suffix="/100"
          right={<RingGauge value={score} size={54} />}
          chip={
            <StatusChip tone={band.label === "Strong" ? "pos" : band.label === "Medium" ? "warn" : "hot"}>
              {band.label}
            </StatusChip>
          }
          foot={
            deltaFirst != null ? (
              <>
                <span className={`tm-delta ${deltaFirst >= 0 ? "up" : "down"}`}>
                  <Icon name={deltaFirst >= 0 ? "up" : "down"} size={12} />
                  {deltaFirst >= 0 ? `+${deltaFirst}` : deltaFirst}
                </span>
                since first audit
              </>
            ) : (
              "First audit for this brand"
            )
          }
        />
        <MetricBox
          label="Brand mentions"
          tip="The number of tracked AI answers where the brand is explicitly mentioned or recommended, out of all answers captured in this run."
          value={
            <>
              {cited}
              <small> of {totalAnswers}</small>
            </>
          }
          tone={cited > 0 ? "pos" : "hot"}
          foot={`Mentioned across ${llms.length} tracked engine${llms.length === 1 ? "" : "s"}`}
        />
        <MetricBox
          label="Blind spots"
          tip="High-intent AI answers where the brand does not appear at all. Each blind spot is demand being answered without you."
          value={absentAnswers}
          tone={absentAnswers > 0 ? "hot" : "pos"}
          chip={absentAnswers > 0 ? <StatusChip tone="hot">Needs attention</StatusChip> : <StatusChip tone="pos">Clear</StatusChip>}
          foot="High-intent prompts with no brand mention"
        />
        <MetricBox
          label="Category rank"
          tip="Your position when every brand named in this run's answers is ranked by share of recommendations."
          value={youRank > 0 ? `#${youRank}` : "-"}
          foot={
            sovFull.length > 0
              ? `Of ${sovFull.length} detected brands${leader && !leader.isYou ? ` · leader ${leader.name}` : youRank === 1 ? " · you lead" : ""}`
              : "No brands detected yet"
          }
        />
        <MetricBox
          label="Citation coverage"
          tip="Third-party pages cited by the engines in this run and analyzed for whether your brand appears on them."
          value={citeEntries.length}
          foot="Cited sources influencing AI answers"
        />
      </div>

      {/* 3 · VISIBILITY TREND */}
      {scores.length >= 2 && (
        <div className="tm-c">
          <Head
            icon="trend"
            title="Visibility trend"
            sub="Track how AI visibility changes across audits"
            tip="Your visibility index (0 to 100) for each completed run of this brand, oldest to newest. Hover a point for the audit date and change vs the prior run."
            border
            action={
              <span className="pill num">
                {runs.length} audits
                {deltaFirst != null && (
                  <b style={{ marginLeft: 6, color: deltaFirst >= 0 ? "var(--pos)" : "var(--hot)" }}>
                    {deltaFirst >= 0 ? `+${deltaFirst}` : deltaFirst} since first
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

      {/* 4 · RECOMMENDED ACTIONS */}
      <RecommendedActions actions={recoActions} />

      {/* 5 · VISIBILITY GAPS TABLE */}
      <div className="tm-c">
        <Head
          icon="target"
          title="Visibility gaps"
          sub={`High-intent prompts where ${brand} is absent or underrepresented`}
          tip="Every tracked query, ranked by lost demand: prompts where competitors are recommended and you are absent rank highest. Open a row on the Queries page to read the full answers and sources."
          border
          action={
            <Link to="/queries" search={(prev) => ({ ...prev })} className="act">
              View all queries <Icon name="arrow" size={13} />
            </Link>
          }
        />
        {gaps.length === 0 ? (
          <div className="tm-empty">No queries scored in this run yet.</div>
        ) : (
          <div style={{ overflowX: "auto", padding: "4px 8px 6px" }}>
            <table className="tm-table">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th style={{ width: 170 }}>Engine coverage</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 150 }}>Competitor leader</th>
                  <th style={{ width: 100 }}>Opportunity</th>
                  <th style={{ width: 260 }}>Recommended next move</th>
                </tr>
              </thead>
              <tbody>
                {gaps.slice(0, 8).map((g) => {
                  const sug = sugByQuery.get(g.query);
                  return (
                    <tr key={g.id}>
                      <td>
                        <Link
                          to="/queries"
                          search={(prev) => ({ ...prev })}
                          style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none", display: "block" }}
                        >
                          {g.query}
                        </Link>
                        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} dangerouslySetInnerHTML={subline(g, llms.length > 1)} />
                      </td>
                      <td>
                        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {g.perLlm.map((c) => (
                            <EngineChip key={c.llm} llm={c.llm} cited={c.cited} position={c.position} />
                          ))}
                        </span>
                      </td>
                      <td>{stateChip(g)}</td>
                      <td>
                        {g.who.length > 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 550 }}>
                            {g.who[0]}
                            {g.who.length > 1 && (
                              <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 450 }}>
                                +{g.who.length - 1}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: "var(--ink-3)" }}>-</span>
                        )}
                      </td>
                      <td>
                        {g.state === "absent" ? (
                          <span style={{ color: "var(--hot)", fontWeight: 600 }}>High</span>
                        ) : g.state === "weak" ? (
                          <span style={{ color: "var(--warn)", fontWeight: 600 }}>Medium</span>
                        ) : (
                          <span style={{ color: "var(--pos)", fontWeight: 600 }}>Defend</span>
                        )}
                      </td>
                      <td>
                        <span className="tm-clamp3" style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                          {sug?.action ?? "Defend the position"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6 · SHARE OF RECOMMENDATIONS + DISTRIBUTION BY LLM */}
      <div className="tm-row c2">
        <div className="tm-c">
          <Head
            icon="bars"
            title="Share of AI recommendations"
            tip="How frequently each brand appears across tracked prompts, as a share of all brand mentions in this run. Your brand is highlighted in indigo; competitors stay neutral."
            border
          />
          <div className="tm-c-pad">
            {!hasSov ? (
              <div className="tm-empty" style={{ padding: "20px 8px" }}>No brands cited in this run yet.</div>
            ) : (
              <>
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
                            background: s.isYou ? "var(--you)" : "var(--grid-2)",
                          }}
                        />
                      </span>
                      <span className="val">{s.isYou && s.pct === 0 ? "0%" : `${s.pct}%`}</span>
                    </div>
                  ))}
                </div>
                {leader && (
                  <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: "14px 0 0", lineHeight: 1.55, borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                    {youRank === 1
                      ? `${brand} leads the category on share of recommendations.`
                      : youRank > 0
                        ? `${brand} ranks ${ordinal(youRank)} overall${absent > 0 ? `, but loses coverage on ${absent} high-intent prompt${absent === 1 ? "" : "s"}` : ""}.`
                        : `${brand} is not yet cited; ${leader.name} leads the category.`}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {llms.length > 1 ? (
          <DistributionByLlm scorecards={scorecards} />
        ) : (
          <div className="tm-c">
            <Head icon="layers" title="Engine coverage" border />
            <div className="tm-c-pad" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              This audit tracked a single engine. Re-run to compare coverage across ChatGPT, Perplexity, and Gemini.
            </div>
          </div>
        )}
      </div>

      {/* 7 · SOURCE INTELLIGENCE */}
      {domainRows.length > 0 && (
        <div className="tm-row split">
          <div className="tm-c">
            <Head
              icon="layers"
              title="Top source domains"
              sub="Domains the engines pull from when answering your prompts"
              tip="Every URL cited across the audit, grouped by domain. Used is that domain's share of all cited sources. Type is the page category inferred from the URL and domain."
              border
              action={
                <Link to="/citations" search={(prev) => ({ ...prev })} className="act">
                  Source opportunities <Icon name="arrow" size={13} />
                </Link>
              }
            />
            <div style={{ padding: "4px 8px 6px" }}>
              <table className="tm-table">
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th style={{ width: 150 }}>Type</th>
                    <th style={{ width: 80 }}>Used</th>
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
                          style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--ink)", textDecoration: "none", fontWeight: 550 }}
                        >
                          <Favicon domain={d.domain} size={16} />
                          {d.domain}
                        </a>
                      </td>
                      <td>
                        <StatusChip tone="neutral">{d.type}</StatusChip>
                      </td>
                      <td className="num">{d.used}%</td>
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
            <div className="tm-c-pad" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <Donut
                slices={donutSlices}
                size={136}
                thickness={18}
                center={
                  <div>
                    <div className="num" style={{ fontSize: 22, fontWeight: 650, color: "var(--ink)", letterSpacing: "-.03em", lineHeight: 1 }}>
                      {domainRows.length}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 500 }}>domains</div>
                  </div>
                }
              />
              <div className="tm-leg" style={{ flex: 1, minWidth: 150 }}>
                {byType.map((t, i) => (
                  <div className="it" key={t.key}>
                    <span className="sq" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                    <span className="nm">{t.label}</span>
                    <span className="v num">{t.pct}%</span>
                  </div>
                ))}
              </div>
              {byType.length > 0 && (
                <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: 0, width: "100%", borderTop: "1px solid var(--grid)", paddingTop: 12, lineHeight: 1.55 }}>
                  {(() => {
                    const top2 = byType.slice(0, 2);
                    const pct = top2.reduce((n, t) => n + t.pct, 0);
                    return `${top2.map((t) => t.label).join(" and ")} account for ${pct}% of cited sources.`;
                  })()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 8 · COMPETITORS */}
      {compTable.length > 0 && (
        <div className="tm-c">
          <Head
            icon="competitors"
            title="Competitors"
            sub="You vs the brands the engines actually recommend"
            tip="Visibility is share of recommendations across every query. Avg position is the mean rank in the answers where the brand is named (1 is named first). Sentiment is a 0 to 100 score of how positively the brand is described. Queries counts distinct prompts where the brand is named."
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
                    <th style={{ width: 96 }}>Avg position</th>
                    <th style={{ width: 70 }}>Queries</th>
                  </tr>
                </thead>
                <tbody>
                  {compTable.map((c) => (
                    <tr key={c.name} className={c.isYou ? "you-row" : ""}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Favicon domain={c.domain} size={16} />
                          <span style={{ fontWeight: c.isYou ? 650 : 550, color: c.isYou ? "var(--you)" : "var(--ink)" }}>
                            {c.name}
                          </span>
                          {c.isYou && <StatusChip tone="you">You</StatusChip>}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="num" style={{ width: 38, color: "var(--ink-2)" }}>{c.visibilityPct}%</span>
                          <span style={{ flex: 1, height: 7, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden", maxWidth: 150 }}>
                            <span style={{ display: "block", height: "100%", width: `${c.visibilityPct}%`, background: c.isYou ? "var(--you)" : "var(--grid-2)" }} />
                          </span>
                        </span>
                      </td>
                      <td>
                        {c.sentiment == null ? (
                          <span style={{ color: "var(--ink-3)" }}>-</span>
                        ) : (
                          <span
                            className="num"
                            style={{
                              fontWeight: 600,
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
                      <td className="num">{c.avgPosition != null ? c.avgPosition.toFixed(1) : "-"}</td>
                      <td className="num">{c.citedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 9 · WHERE TO GET CITED */}
      <div className="tm-c">
        <Head
          icon="flag"
          title="Where to get cited"
          sub={`Third-party pages the engines trust that do not mention ${brand} yet`}
          tip="Pages the engines already cite that do not mention your brand, ranked by cross-engine leverage. Excludes your own pages, homepages, single-product profiles, off-niche sources, and dead links."
          border
          action={
            <Link to="/citations" search={(prev) => ({ ...prev })} className="act">
              Full worklist <Icon name="arrow" size={13} />
            </Link>
          }
        />
        <div className="tm-c-pad" style={{ paddingTop: 8 }}>
          {getListed.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: 0 }}>
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
                  <span className="num" style={{ fontSize: 11.5, color: "var(--ink-3)", width: 18 }}>
                    {i + 1}
                  </span>
                  <Favicon domain={t.domain} size={16} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>
                      {t.title || t.domain}
                    </a>
                    <span style={{ marginLeft: 8, verticalAlign: "middle" }}>
                      <StatusChip tone="neutral">{t.label}</StatusChip>
                    </span>
                    {t.reason && (
                      <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>{t.reason}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap", display: "inline-flex", gap: 4 }}>
                    {t.llms.map((l) => (
                      <LlmIcon key={l} llm={l} size={13} />
                    ))}
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
