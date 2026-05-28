import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import type { Audit, SuggestionSituation } from "@/lib/db/types";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Compass" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <AnalyticsView audit={audit} pollsCount={polls.length} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

interface RunPoint {
  id: string;
  date: string;
  score: number;
  cited: number;
  total: number;
  blind: number;
  high: number;
}

const OUTCOME_LABEL: Record<SuggestionSituation, string> = {
  losing_to_competitor: "Losing to competitor",
  weak_position: "Weak position",
  open_opportunity: "Open opportunity",
  authority_gap: "Authority gap",
  winning: "Winning",
};
const OUTCOME_COLOR: Record<SuggestionSituation, string> = {
  winning: "var(--pos)",
  weak_position: "var(--warn)",
  open_opportunity: "var(--ink-3)",
  losing_to_competitor: "var(--neg)",
  authority_gap: "var(--grid-2)",
};

function runOf(a: Audit): RunPoint {
  const total = a.summary?.total_queries ?? a.progress_total ?? 0;
  const cited = a.summary?.brand_cited_queries ?? 0;
  return {
    id: a.id,
    date: a.completed_at ?? a.created_at,
    score: a.visibility_score ?? 0,
    cited,
    total,
    blind: Math.max(0, total - cited),
    high: a.insights?.high_severity_count ?? 0,
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Line over runs. Axis labels + dots are HTML overlays; the line is an SVG
 *  stretched to fill, with a non-scaling stroke so width stays crisp. */
function LineChart({
  values,
  labels,
  yMax,
  color,
  unit = "",
}: {
  values: number[];
  labels: string[];
  yMax: number;
  color: string;
  unit?: string;
}) {
  const n = values.length;
  const max = Math.max(1, yMax);
  const pts = values
    .map((v, i) => {
      const x = n === 1 ? 50 : (i / (n - 1)) * 100;
      const y = 100 - (v / max) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div style={{ position: "relative", height: 168, paddingLeft: 30, paddingBottom: 18 }}>
      <div className="tm-yaxis mono">
        <span>{max}{unit}</span>
        <span>{Math.round(max / 2)}{unit}</span>
        <span>0</span>
      </div>
      <div className="tm-gridline" style={{ top: 0 }} />
      <div className="tm-gridline" style={{ top: "50%" }} />
      <div className="tm-gridline" style={{ bottom: 18 }} />
      <div style={{ position: "absolute", left: 30, right: 0, top: 0, bottom: 18 }}>
        {n >= 2 && (
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0 }}
          >
            <polyline
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
        {values.map((v, i) => {
          const left = n === 1 ? 50 : (i / (n - 1)) * 100;
          const bottom = (v / max) * 100;
          return (
            <span
              key={i}
              title={`${v}${unit}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                bottom: `${bottom}%`,
                width: 7,
                height: 7,
                marginLeft: -3.5,
                marginBottom: -3.5,
                borderRadius: "50%",
                background: i === n - 1 ? color : "var(--bg)",
                border: `2px solid ${color}`,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -16,
            display: "flex",
            justifyContent: n === 1 ? "center" : "space-between",
          }}
        >
          {labels.map((l, i) => (
            <span
              key={i}
              className="mono"
              style={{ fontSize: 8.5, color: "var(--ink-3)" }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CoverageBars({ runs }: { runs: RunPoint[] }) {
  const max = Math.max(1, ...runs.map((r) => r.total));
  return (
    <div className="tm-sov" style={{ paddingTop: 8 }}>
      <div className="tm-sov-chart" style={{ height: 130, marginBottom: 8 }}>
        <div className="tm-yaxis mono">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="tm-gridline" style={{ top: 0 }} />
        <div className="tm-gridline" style={{ top: "50%" }} />
        <div className="tm-gridline" style={{ bottom: 18 }} />
        <div className="tm-sov-bars">
          {runs.map((r) => (
            <div className="tm-sov-col" key={r.id}>
              <div className="stk" style={{ height: `${(r.total / max) * 100}%` }}>
                <span style={{ display: "block", height: `${r.total ? (r.blind / r.total) * 100 : 0}%`, background: "var(--grid-2)" }} />
                <span style={{ display: "block", height: `${r.total ? (r.cited / r.total) * 100 : 0}%`, background: "var(--you)" }} />
              </div>
              <span className="lbl">{fmtDate(r.date)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tm-sov-legend">
        <div className="tm-lg">
          <span className="sq" style={{ background: "var(--you)" }} />
          <span className="nm">Cited</span>
        </div>
        <div className="tm-lg">
          <span className="sq" style={{ background: "var(--grid-2)" }} />
          <span className="nm">Blind</span>
        </div>
      </div>
    </div>
  );
}

function OutcomeMix({ audit }: { audit: Audit }) {
  const dist = audit.insights?.situation_distribution;
  const entries = dist
    ? (Object.entries(dist) as [SuggestionSituation, number][]).filter(([, n]) => n > 0)
    : [];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0)
    return (
      <div className="tm-empty" style={{ padding: "28px 20px" }}>
        No outcome breakdown for this run.
      </div>
    );
  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          height: 22,
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        {entries.map(([s, n]) => (
          <span
            key={s}
            title={`${OUTCOME_LABEL[s]}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, background: OUTCOME_COLOR[s] }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map(([s, n]) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: OUTCOME_COLOR[s] }}
            />
            <span style={{ color: "var(--ink-2)" }}>{OUTCOME_LABEL[s]}</span>
            <b className="mono" style={{ marginLeft: "auto", color: "var(--ink)" }}>
              {n}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsView({ audit, pollsCount }: { audit: Audit; pollsCount: number }) {
  const { audits } = useWorkspace();

  const runs: RunPoint[] = audits
    .filter(
      (a) =>
        a.status === "completed" &&
        a.brand_name === audit.brand_name &&
        a.domain === audit.domain &&
        a.visibility_score != null
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(runOf);

  const multi = runs.length >= 2;
  const labels = runs.map((r) => fmtDate(r.date));
  const current = runOf(audit);

  return (
    <div className="tm-grid">
      {/* FOCAL: visibility index over time */}
      <div className="tm-panel tm-gap-span tm-reveal">
        <div className="tm-phead">
          <h2>▤ Visibility index · over time</h2>
          <span className="meta">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
        </div>
        {multi ? (
          <>
            <div style={{ padding: "18px 16px 8px" }}>
              <LineChart
                values={runs.map((r) => r.score)}
                labels={labels}
                yMax={100}
                color="var(--pos)"
              />
            </div>
            <div className="tm-rows">
              <div
                className="mono"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 64px 80px 70px",
                  gap: 8,
                  padding: "8px 16px",
                  fontSize: 9.5,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  borderBottom: "1px solid var(--grid)",
                  background: "var(--panel)",
                }}
              >
                <span>Run</span>
                <span style={{ textAlign: "right" }}>Score</span>
                <span style={{ textAlign: "right" }}>Cited</span>
                <span style={{ textAlign: "right" }}>Blind</span>
              </div>
              {[...runs].reverse().map((r, i) => {
                const prev = runs[runs.length - 2 - i];
                const d = prev ? r.score - prev.score : null;
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 64px 80px 70px",
                      gap: 8,
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--grid)",
                      alignItems: "center",
                      background: r.id === audit.id ? "var(--you-bg)" : undefined,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{fmtDate(r.date)}</span>
                    <span className="mono" style={{ textAlign: "right", fontWeight: 700, color: "var(--ink)" }}>
                      {r.score}
                      {d != null && (
                        <small
                          style={{
                            marginLeft: 5,
                            fontWeight: 600,
                            color: d >= 0 ? "var(--pos)" : "var(--neg)",
                          }}
                        >
                          {d >= 0 ? `+${d}` : d}
                        </small>
                      )}
                    </span>
                    <span className="mono" style={{ textAlign: "right", color: "var(--ink-2)" }}>
                      {r.cited}/{r.total}
                    </span>
                    <span
                      className="mono"
                      style={{ textAlign: "right", color: r.blind > 0 ? "var(--hot)" : "var(--ink-3)" }}
                    >
                      {r.blind}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ padding: 24 }}>
            <div className="tm-trend" style={{ padding: "8px 0 18px", borderBottom: "1px solid var(--grid)" }}>
              <div>
                <div className="lab">Visibility index · this run</div>
                <div className="big">
                  {current.score}
                  <small>/100</small>
                </div>
                <div className="tm-chg mono flat">— single run</div>
              </div>
            </div>
            <div className="tm-insight" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div className="k">⚑ Need a baseline</div>
              <p>
                Trends chart movement across runs of the same brand. Only{" "}
                <b>one completed run</b> exists for {audit.brand_name} — run the
                same brand + domain again to plot the index, coverage, and
                blind-spot trajectory.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Coverage over runs */}
      <div className="tm-panel tm-reveal" style={{ animationDelay: ".05s" }}>
        <div className="tm-phead">
          <h2>◫ Coverage · cited vs blind</h2>
          <span className="meta">{multi ? "per run" : "this run"}</span>
        </div>
        <CoverageBars runs={multi ? runs : [current]} />
      </div>

      {/* Outcome mix for the selected run */}
      <div
        className="tm-panel tm-reveal"
        style={{ borderBottom: "none", animationDelay: ".1s" }}
      >
        <div className="tm-phead">
          <h2>◐ Query outcomes · this run</h2>
          <span className="meta">{pollsCount} queries</span>
        </div>
        <OutcomeMix audit={audit} />
      </div>
    </div>
  );
}
