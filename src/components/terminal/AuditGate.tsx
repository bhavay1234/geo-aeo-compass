import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useWorkspace } from "./workspace-context";
import type { Audit, PollResult } from "@/lib/db/types";

const PENDING = new Set(["pending", "running", "finalizing"]);
const PARTIAL_AFTER_SEC = 90;

function CenterMsg({ children }: { children: ReactNode }) {
  return <div className="tm-empty mono">{children}</div>;
}

function EmptyRun() {
  return (
    <div className="tm-empty">
      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
        No completed audit selected
      </p>
      <p style={{ marginTop: 6 }}>
        Run an AEO audit to populate the terminal.
      </p>
      <Link to="/" className="tm-btn" style={{ marginTop: 16 }}>
        Run an audit
      </Link>
    </div>
  );
}

function ProgressPanel({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const done = audit.progress_done ?? polls.length;
  const total = audit.progress_total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const scoring = audit.status === "finalizing";
  return (
    <div className="tm-panel" style={{ borderRight: "none" }}>
      <div className="tm-phead">
        <h2>{scoring ? "◰ Scoring" : "◰ Analyzing ChatGPT answers"}</h2>
        <span className="meta">{audit.brand_name}</span>
      </div>
      <div style={{ padding: 24 }}>
        <div
          className="mono"
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 8,
            color: "var(--ink-2)",
            fontSize: 12,
          }}
        >
          <span>
            {scoring
              ? "Computing your visibility score…"
              : `Analyzing ${done} of ${total} queries…`}
          </span>
          <span style={{ fontWeight: 700, color: "var(--ink)" }}>{pct}%</span>
        </div>
        <div className="tm-progress">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "var(--ink-3)" }}>
          Updates live. Each query is polled against ChatGPT with web search —
          results render the moment the run completes.
        </p>
      </div>
    </div>
  );
}

export function PartialBanner() {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--grid)" }}>
      <div className="tm-warn-banner">
        <span aria-hidden>⚑</span>
        Scoring is taking longer than expected — showing partial results from
        the queries completed so far.
      </div>
    </div>
  );
}

/**
 * Gates a tab's content on the selected audit's state:
 *  - no audit / none completed → run prompt
 *  - still loading the result → loading message
 *  - running/scoring under 90s → determinate progress panel
 *  - running/scoring over 90s → renders children with partial=true (+ banner)
 *  - completed → renders children with partial=false
 * Never an infinite spinner.
 */
export function AuditGate({
  children,
}: {
  children: (v: { audit: Audit; polls: PollResult[]; partial: boolean }) => ReactNode;
}) {
  const { audit, polls, loading, hasAnyCompleted, selectedId } = useWorkspace();

  if (loading && !audit) return <CenterMsg>Loading…</CenterMsg>;
  if (!audit) {
    if (!selectedId && !hasAnyCompleted) return <EmptyRun />;
    return <CenterMsg>Loading…</CenterMsg>;
  }

  const pending = PENDING.has(audit.status);
  const elapsed = audit.created_at
    ? (Date.now() - new Date(audit.created_at).getTime()) / 1000
    : 0;

  if (pending && elapsed < PARTIAL_AFTER_SEC) {
    return <ProgressPanel audit={audit} polls={polls} />;
  }

  return <>{children({ audit, polls, partial: pending })}</>;
}
