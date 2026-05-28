import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { QueryTable, type QueryTableRow } from "@/components/QueryTable";
import { PlatformBreakdown } from "@/components/PlatformBreakdown";
import { AuditStatusBadge } from "@/components/AuditStatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getAuditStatus, getAuditResult } from "@/lib/client/api";
import type { PollResult } from "@/lib/db/types";
import {
  Eye,
  CheckCircle2,
  Crosshair,
  AlertTriangle,
  Loader2,
  ArrowLeft,
} from "lucide-react";

export const Route = createFileRoute("/audit/$id")({
  head: () => ({ meta: [{ title: "AEO Audit — Results" }] }),
  component: AuditDetail,
});

function scoreColor(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 40) return "text-primary";
  return "text-destructive";
}

function computeStats(polls: PollResult[]) {
  const total = polls.length;
  const cited = polls.filter((p) => p.brand_cited).length;
  const positions = polls
    .map((p) => p.brand_position)
    .filter((p): p is number => typeof p === "number");
  const avgPosition =
    positions.length > 0
      ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1)
      : "—";
  return { total, cited, avgPosition };
}

function AuditDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const statusQuery = useQuery({
    queryKey: ["audit-status", id],
    queryFn: () => getAuditStatus(id),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
  });

  const status = statusQuery.data?.status;

  const resultQuery = useQuery({
    queryKey: ["audit-result", id],
    queryFn: () => getAuditResult(id),
    enabled: status === "completed",
  });

  const backButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate({ to: "/" })}
      className="mb-4 -ml-2 text-muted-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Button>
  );

  // Initial load
  if (statusQuery.isLoading) {
    return (
      <DashboardShell>
        {backButton}
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </DashboardShell>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <DashboardShell>
        {backButton}
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
          Could not load this audit: {(statusQuery.error as Error)?.message}
        </div>
      </DashboardShell>
    );
  }

  const audit = statusQuery.data;

  // Failed
  if (status === "failed") {
    return (
      <DashboardShell>
        {backButton}
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Audit failed</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            {audit.brand_name}
          </h1>
          <p className="mt-1 text-muted-foreground">{audit.domain}</p>
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {audit.error_message || "Unknown error."}
          </p>
        </div>
      </DashboardShell>
    );
  }

  // Running / pending — live progress
  if (status === "running" || status === "pending") {
    const done = audit.progress_done ?? 0;
    const total = audit.progress_total ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <DashboardShell>
        {backButton}
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Analyzing ChatGPT answers…</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            {audit.brand_name}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {audit.domain} · ChatGPT
          </p>

          <div className="mt-8">
            <div className="mb-2 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">
                Analyzing {done} of {total} queries…
              </span>
              <span className="text-2xl font-bold tracking-tight text-card-foreground">
                {pct}%
              </span>
            </div>
            <Progress value={pct} className="h-3" />
            <p className="mt-3 text-xs text-muted-foreground">
              This page updates live. Each query is polled against ChatGPT with
              web search — results appear as soon as the run completes.
            </p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Completed — results
  if (resultQuery.isLoading || !resultQuery.data) {
    return (
      <DashboardShell>
        {backButton}
        <Skeleton className="h-40 w-full rounded-2xl" />
      </DashboardShell>
    );
  }

  const { audit: full, polls } = resultQuery.data;
  const score = full.visibility_score ?? 0;
  const { total, cited, avgPosition } = computeStats(polls);
  const highSeverity = full.insights?.high_severity_count ?? 0;
  const ownDomain = full.domain;
  const namedCompetitors = full.competitors ?? [];

  // Shared per-query rows for both Overview and Query Results tabs.
  const queryRows: QueryTableRow[] = polls.map((p) => ({
    query_text: p.query_text,
    brand_cited: p.brand_cited,
    brand_position: p.brand_position,
    competitors_cited: p.competitors_cited ?? [],
    discovered_in_query: p.discovered_in_query ?? [],
  }));

  return (
    <DashboardShell>
      {backButton}

      {/* Hero score — shown above the tabs */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-card-foreground">
                {full.brand_name}
              </span>
              <span>·</span>
              <span>{full.domain}</span>
              <span>·</span>
              <span>ChatGPT</span>
              <AuditStatusBadge status={full.status} />
            </div>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              AI Visibility Score
            </p>
            {full.summary?.headline && (
              <p className="mt-3 max-w-2xl text-lg text-card-foreground">
                {full.summary.headline}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-baseline justify-end gap-1">
              <span className={`text-6xl font-bold tracking-tight ${scoreColor(score)}`}>
                {score}
              </span>
              <span className="text-2xl text-muted-foreground"> / 100</span>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="queries">Query Results</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Visibility Score" value={`${score}`} icon={Eye} description="out of 100" />
            <StatCard
              title="Queries Cited"
              value={`${cited} / ${total}`}
              icon={CheckCircle2}
              description="brand appeared in answer"
            />
            <StatCard title="Avg. Position" value={`${avgPosition}`} icon={Crosshair} description="when cited" />
            <StatCard
              title="High-Severity Issues"
              value={`${highSeverity}`}
              icon={AlertTriangle}
              description="need attention"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <QueryTable
                polls={queryRows}
                ownDomain={ownDomain}
                namedCompetitors={namedCompetitors}
              />
            </div>
            <div>
              <PlatformBreakdown cited={cited} total={total} />
            </div>
          </div>
        </TabsContent>

        {/* Query Results — full width, no donut. Deep per-query exploration
            (citation evidence, full answer, suggestions) lives on the
            /queries workspace page. */}
        <TabsContent value="queries">
          <QueryTable
            polls={queryRows}
            ownDomain={ownDomain}
            namedCompetitors={namedCompetitors}
          />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}
