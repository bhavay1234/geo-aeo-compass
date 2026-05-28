import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { PlatformBreakdown } from "@/components/PlatformBreakdown";
import { EmptyState } from "@/components/EmptyState";
import type { SuggestionSituation } from "@/lib/db/types";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — AEO/GEO Tracker" },
      {
        name: "description",
        content: "Visibility snapshot for the selected audit.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const SITUATION_LABELS: Record<SuggestionSituation, string> = {
  losing_to_competitor: "Losing to competitors",
  weak_position: "Weak position",
  open_opportunity: "Open opportunities",
  authority_gap: "Authority gaps",
  winning: "Winning",
};

const SITUATION_COLORS: Record<SuggestionSituation, string> = {
  winning: "bg-success",
  weak_position: "bg-warning",
  open_opportunity: "bg-primary",
  losing_to_competitor: "bg-destructive",
  authority_gap: "bg-muted-foreground",
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-primary";
  return "text-destructive";
}

function finding(score: number, cited: number, total: number): string {
  if (total === 0) return "No queries in this audit.";
  if (cited === 0)
    return "Your brand is invisible in ChatGPT answers for these queries.";
  if (score >= 70) return "Strong presence across buyer queries.";
  if (score >= 40) return "Visible, but losing ground on key queries.";
  return "Low visibility — a clear AEO gap to close.";
}

function AnalyticsPage() {
  return (
    <Workspace title="Analytics">
      <AnalyticsInner />
    </Workspace>
  );
}

function AnalyticsInner() {
  const { audit, polls, loading } = useWorkspace();

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (!audit) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No completed audits yet"
        description="Run an audit to see your ChatGPT visibility snapshot."
        ctaLabel="Run an audit"
        ctaTo="/"
      />
    );
  }

  const score = audit.visibility_score ?? 0;
  const total = polls.length;
  const cited = polls.filter((p) => p.brand_cited).length;
  const dist = audit.insights?.situation_distribution;
  const distEntries = dist
    ? (Object.entries(dist) as [SuggestionSituation, number][]).filter(
        ([, n]) => n > 0
      )
    : [];
  const distTotal = distEntries.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          {audit.brand_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {audit.domain} · ChatGPT
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Score */}
        <div className="flex flex-col justify-center rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            AI Visibility Score
          </p>
          <div className="mt-2 flex items-baseline gap-1">
            <span
              className={`text-5xl font-bold tracking-tight ${scoreColor(score)}`}
            >
              {score}
            </span>
            <span className="text-xl text-muted-foreground"> / 100</span>
          </div>
          <p className="mt-2 text-sm font-medium text-card-foreground">
            {finding(score, cited, total)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cited in {cited} of {total} buyer queries
          </p>
        </div>

        {/* Cited donut */}
        <PlatformBreakdown cited={cited} total={total} />

        {/* Situation distribution */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-card-foreground">
            Query Outcomes
          </h3>
          <p className="text-sm text-muted-foreground">
            How each query landed
          </p>
          {distEntries.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No outcome data.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {distEntries.map(([situation, n]) => {
                const pct =
                  distTotal > 0 ? Math.round((n / distTotal) * 100) : 0;
                return (
                  <div key={situation}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-card-foreground">
                        {SITUATION_LABELS[situation]}
                      </span>
                      <span className="text-muted-foreground">{n}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${SITUATION_COLORS[situation]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
