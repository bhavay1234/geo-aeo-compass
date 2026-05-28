import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { QueryResultsPanel } from "@/components/QueryResultsPanel";
import { EmptyState } from "@/components/EmptyState";
import { Inbox } from "lucide-react";

export const Route = createFileRoute("/queries")({
  head: () => ({
    meta: [
      { title: "Queries — AEO/GEO Tracker" },
      {
        name: "description",
        content: "Per-query ChatGPT results for the selected audit.",
      },
    ],
  }),
  component: QueriesPage,
});

function QueriesPage() {
  return (
    <Workspace title="Queries">
      <QueriesInner />
    </Workspace>
  );
}

function QueriesInner() {
  const { audit, polls, loading } = useWorkspace();

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (!audit) {
    return (
      <EmptyState
        icon={Inbox}
        title="No completed audits yet"
        description="Run your first AEO audit to see per-query ChatGPT results here."
        ctaLabel="Run an audit"
        ctaTo="/"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          {audit.brand_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {audit.domain} · ChatGPT · {polls.length} queries
        </p>
      </div>
      <QueryResultsPanel
        polls={polls}
        ownDomain={audit.domain}
        namedCompetitors={audit.competitors ?? []}
      />
    </div>
  );
}
