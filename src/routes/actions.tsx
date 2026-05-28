import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { deriveBrandName } from "@/components/CitedBrands";
import { updateNotes } from "@/lib/client/api";
import type {
  PollResult,
  Suggestion,
  SuggestionSituation,
} from "@/lib/db/types";
import { Zap, AlertTriangle, Loader2, Check } from "lucide-react";

export const Route = createFileRoute("/actions")({
  head: () => ({
    meta: [
      { title: "Actions — AEO/GEO Tracker" },
      {
        name: "description",
        content: "Prioritized recommendations from the selected audit.",
      },
    ],
  }),
  component: ActionsPage,
});

type PollWithSuggestion = PollResult & { suggestion: Suggestion };

const SITUATION_ORDER: SuggestionSituation[] = [
  "losing_to_competitor",
  "weak_position",
  "open_opportunity",
  "authority_gap",
  "winning",
];

const SITUATION_LABELS: Record<SuggestionSituation, string> = {
  losing_to_competitor: "Losing to competitors",
  weak_position: "Weak position",
  open_opportunity: "Open opportunities",
  authority_gap: "Authority gaps",
  winning: "Winning",
};

const SEVERITY_RANK: Record<Suggestion["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const SEVERITY_STYLES: Record<Suggestion["severity"], string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function cleanList(domains: string[], n = 3): string {
  return domains.slice(0, n).map((d) => deriveBrandName("", d)).join(", ");
}

/**
 * Per-query evidence line, derived ONLY from already-fetched poll_results.
 * Differentiates otherwise-identical suggestions by their real citation
 * signal. Returns null when a cited query has nothing extra to add.
 */
function querySignal(poll: PollResult): string | null {
  const discovered = (poll.discovered_in_query ?? []).filter(
    (d) => d.label === "competitor"
  );
  if (discovered.length > 0) {
    return `Players winning this: ${cleanList(discovered.map((d) => d.domain))}`;
  }
  if (poll.brand_cited) return null;

  const cites = poll.citations ?? [];
  const reviewAnalyst = cites.filter(
    (c) => c.source_type === "review_directory" || c.source_type === "analyst"
  );
  if (reviewAnalyst.length > 0) {
    return `Sourced from ${cleanList(reviewAnalyst.map((c) => c.domain))} — review/analyst pages you're absent from.`;
  }
  const external = cites.filter((c) => c.source_type !== "own").map((c) => c.domain);
  if (external.length > 0) {
    return `Cited sources: ${cleanList(external)} — no category page owns this yet.`;
  }
  return "Answered from model training — no live sources; authority-content play, slower.";
}

interface Cluster {
  action: string;
  members: PollWithSuggestion[];
  topSeverity: number;
}

function ActionsPage() {
  return (
    <Workspace title="Actions">
      <ActionsInner />
    </Workspace>
  );
}

function ActionsInner() {
  const { audit, polls, loading } = useWorkspace();

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (!audit) {
    return (
      <EmptyState
        icon={Zap}
        title="No completed audits yet"
        description="Run an audit to get a prioritized list of recommended actions."
        ctaLabel="Run an audit"
        ctaTo="/"
      />
    );
  }

  const highSeverity = audit.insights?.high_severity_count ?? 0;
  const withSuggestion = polls.filter(
    (p): p is PollWithSuggestion => p.suggestion !== null
  );
  const actionable = withSuggestion.filter(
    (p) => p.suggestion.situation !== "winning"
  ).length;

  // Group by situation, then cluster by identical action text within a group.
  const groups = SITUATION_ORDER.map((situation) => {
    const items = withSuggestion.filter(
      (p) => p.suggestion.situation === situation
    );
    if (items.length === 0) return null;

    const clusterMap = new Map<string, PollWithSuggestion[]>();
    for (const p of items) {
      const key = p.suggestion.action;
      const arr = clusterMap.get(key);
      if (arr) arr.push(p);
      else clusterMap.set(key, [p]);
    }

    const clusters: Cluster[] = Array.from(clusterMap.entries()).map(
      ([action, members]) => ({
        action,
        members: members
          .slice()
          .sort(
            (a, b) =>
              SEVERITY_RANK[a.suggestion.severity] -
              SEVERITY_RANK[b.suggestion.severity]
          ),
        topSeverity: Math.min(
          ...members.map((m) => SEVERITY_RANK[m.suggestion.severity])
        ),
      })
    );
    clusters.sort((a, b) => a.topSeverity - b.topSeverity);

    return { situation, clusters, count: items.length };
  }).filter((g): g is NonNullable<typeof g> => g !== null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          {audit.brand_name}
        </h2>
        <p className="text-sm text-muted-foreground">{audit.domain} · ChatGPT</p>
      </div>

      {/* Top strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-card-foreground">
              {highSeverity}
            </p>
            <p className="text-xs text-muted-foreground">high-severity issues</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-card-foreground">
              {actionable}
            </p>
            <p className="text-xs text-muted-foreground">actionable queries</p>
          </div>
        </div>
      </div>

      <NotesEditor auditId={audit.id} initialNotes={audit.notes ?? ""} />

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No recommendations generated for this audit.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.situation}>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-lg font-semibold text-card-foreground">
                {SITUATION_LABELS[g.situation]}
              </h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {g.count}
              </span>
            </div>
            <div className="space-y-3">
              {g.clusters.map((cluster, ci) => (
                <ClusterCard key={ci} cluster={cluster} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: Cluster }) {
  const merged = cluster.members.length > 1;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-card-foreground">{cluster.action}</p>
        {merged ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {cluster.members.length} queries
          </span>
        ) : (
          <Badge
            variant="outline"
            className={SEVERITY_STYLES[cluster.members[0].suggestion.severity]}
          >
            {cluster.members[0].suggestion.severity}
          </Badge>
        )}
      </div>

      <div className="mt-3 divide-y divide-border border-t border-border">
        {cluster.members.map((p) => {
          const signal = merged ? querySignal(p) : null;
          return (
            <div key={p.id} className="py-2.5 first:pt-3">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-card-foreground">
                  {p.query_text}
                </span>
                <Badge
                  variant="outline"
                  className={SEVERITY_STYLES[p.suggestion.severity]}
                >
                  {p.suggestion.severity}
                </Badge>
              </div>
              {signal && (
                <p className="mt-1 text-xs text-muted-foreground">{signal}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotesEditor({
  auditId,
  initialNotes,
}: {
  auditId: string;
  initialNotes: string;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNotes(initialNotes);
    setSaved(false);
  }, [auditId, initialNotes]);

  const mutation = useMutation({
    mutationFn: () => updateNotes(auditId, notes),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["audit-result", auditId] });
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-lg font-semibold text-card-foreground">
        Strategic notes
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Your close after reviewing the findings. Saved to this audit.
      </p>
      <Textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="e.g. Priority: get listed on G2 and target the three comparison queries we're losing…"
        className="min-h-[120px]"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save notes"
          )}
        </Button>
        {saved && !mutation.isPending && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" />
            Saved
          </span>
        )}
        {mutation.isError && (
          <span className="text-sm text-destructive">
            {(mutation.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}
