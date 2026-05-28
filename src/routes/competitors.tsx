import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { domainToBrand } from "@/components/CitedBrands";
import type { Confidence, DiscoveredCompetitor } from "@/lib/db/types";
import { Users, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/competitors")({
  head: () => ({
    meta: [
      { title: "Competitors — AEO/GEO Tracker" },
      {
        name: "description",
        content: "Named and discovered competitors for the selected audit.",
      },
    ],
  }),
  component: CompetitorsPage,
});

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: "border-primary/30 bg-primary/10 text-primary",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function CompetitorsPage() {
  return (
    <Workspace title="Competitors">
      <CompetitorsInner />
    </Workspace>
  );
}

function CompetitorsInner() {
  const { audit, polls, loading } = useWorkspace();

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (!audit) {
    return (
      <EmptyState
        icon={Users}
        title="No completed audits yet"
        description="Run an audit to see which competitors ChatGPT cites — named and discovered."
        ctaLabel="Run an audit"
        ctaTo="/"
      />
    );
  }

  const discovered = audit.discovered_competitors ?? [];
  const discoveredCompetitors = discovered
    .filter((d) => d.label === "competitor")
    .sort((a, b) => b.queries_seen_in - a.queries_seen_in);
  const otherSources = discovered.filter((d) => d.label !== "competitor");

  // Named competitors with how many queries each was cited in.
  const named = (audit.competitors ?? []).map((name) => {
    const count = polls.filter((p) =>
      (p.competitors_cited ?? []).some((c) => c.name === name)
    ).length;
    return { name, count };
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          {audit.brand_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {audit.domain} · ChatGPT
        </p>
      </div>

      {/* Discovered competitors — the eye-opener */}
      <section>
        <h3 className="text-lg font-semibold text-card-foreground">
          Discovered competitors
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Brands ChatGPT cited that you didn't name — ranked by how many of
          your queries they showed up in.
        </p>
        {discoveredCompetitors.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            None found — ChatGPT didn't surface unnamed competitors for these
            queries.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {discoveredCompetitors.map((d) => (
              <DiscoveredCard key={d.domain} d={d} />
            ))}
          </div>
        )}
      </section>

      {/* Named competitors */}
      <section>
        <h3 className="text-lg font-semibold text-card-foreground">
          Named competitors
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          The rivals you listed, and how many queries each was cited in.
        </p>
        {named.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            You didn't name any competitors for this audit.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {named.map((c) => (
              <div
                key={c.name}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="font-medium text-card-foreground">
                  {c.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  cited in {c.count} quer{c.count === 1 ? "y" : "ies"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Other cited sources */}
      {otherSources.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-card-foreground">
            Other cited sources
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Directories, reviews, and publishers ChatGPT cited — citation
            sources, not competitors.
          </p>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {otherSources.map((d) => (
              <div
                key={d.domain}
                className="flex items-center justify-between px-5 py-3"
              >
                <div>
                  <span className="font-medium text-card-foreground">
                    {d.domain}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.label}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  cited in {d.queries_seen_in} quer
                  {d.queries_seen_in === 1 ? "y" : "ies"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiscoveredCard({ d }: { d: DiscoveredCompetitor }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-card-foreground">
            {domainToBrand(d.domain)}
          </p>
          <a
            href={d.sample_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {d.domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Badge variant="outline" className={CONFIDENCE_STYLES[d.confidence]}>
          {d.confidence}
        </Badge>
      </div>
      <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span>
          <span className="font-medium text-card-foreground">
            {d.queries_seen_in}
          </span>{" "}
          quer{d.queries_seen_in === 1 ? "y" : "ies"}
        </span>
        <span>
          <span className="font-medium text-card-foreground">
            {d.citation_count}
          </span>{" "}
          citation{d.citation_count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
