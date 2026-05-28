import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { BleedBar, StatePill, Sparkline } from "@/components/terminal/primitives";
import {
  buildGapRows,
  computeShareOfVoice,
  type GapRow,
} from "@/components/terminal/derive";
import type { Audit, PollResult } from "@/lib/db/types";

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

function subline(g: GapRow): { __html: string } {
  if (g.state === "absent") {
    if (g.who.length === 0)
      return { __html: `competitors cited — you're absent` };
    const names =
      g.who.length > 3
        ? `<b>${g.who.length} competitors</b>`
        : `<b>${g.who.join(" · ")}</b>`;
    return { __html: `${names} cited — you're absent` };
  }
  if (g.state === "weak")
    return {
      __html: `cited <b>${g.position ? ordinal(g.position) : "low"}</b> · buried below the fold`,
    };
  return {
    __html:
      g.position === 1
        ? `cited <b>1st</b> · strong, defend this`
        : `cited <b>${g.position ? ordinal(g.position) : ""}</b> · category fit`,
  };
}

function SummaryView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const { audits } = useWorkspace();
  const brand = audit.brand_name;
  const gaps = buildGapRows(audit, polls);
  const sovFull = computeShareOfVoice(audit, polls);

  const total = polls.length;
  const absent = gaps.filter((g) => g.state === "absent").length;
  const weak = gaps.filter((g) => g.state === "weak").length;
  const held = gaps.filter((g) => g.state === "held").length;

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

  const verdict =
    total === 0 ? (
      <>Run in progress — no queries scored yet.</>
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
        <b>{total}</b> high-intent ChatGPT queries but ranks below the top on{" "}
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
        <b style={{ color: "var(--pos)" }}>all {total}</b> high-intent ChatGPT
        queries
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
      <div className="tm-grid">
        {/* FOCAL: visibility gaps */}
      <div className="tm-panel tm-gap-span tm-reveal">
        <div className="tm-phead">
          <h2>◧ Visibility gaps · ranked by lost demand</h2>
          <span className="meta">{gaps.length} queries</span>
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
                <div className="s" dangerouslySetInnerHTML={subline(g)} />
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
