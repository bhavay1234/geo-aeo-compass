import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { domainToBrand } from "@/components/CitedBrands";
import { normalizeDomain } from "@/lib/audit/source-classifier";
import type {
  Confidence,
  DiscoveredCompetitor,
  PollResult,
} from "@/lib/db/types";
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

function queriesForDomain(polls: PollResult[], domain: string): string[] {
  const dn = normalizeDomain(domain);
  return polls
    .filter((p) =>
      (p.discovered_in_query ?? []).some((d) => normalizeDomain(d.domain) === dn)
    )
    .map((p) => p.query_text);
}

function queriesForName(polls: PollResult[], name: string): string[] {
  return polls
    .filter((p) => (p.competitors_cited ?? []).some((c) => c.name === name))
    .map((p) => p.query_text);
}

function ExpandableQueryList({ queries }: { queries: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (queries.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        No matching queries.
      </p>
    );
  }
  const visible = expanded ? queries : queries.slice(0, 3);
  const overflow = queries.length - visible.length;
  return (
    <ul className="mt-3 space-y-1">
      {visible.map((q, i) => (
        <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
          <span className="text-muted-foreground/50">•</span>
          <span className="min-w-0 flex-1 truncate" title={q}>
            {q}
          </span>
        </li>
      ))}
      {!expanded && overflow > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            and {overflow} more
          </button>
        </li>
      )}
    </ul>
  );
}

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

  const named = (audit.competitors ?? []).map((name) => ({
    name,
    queries: queriesForName(polls, name),
  }));

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          {audit.brand_name}
        </h2>
        <p className="text-sm text-muted-foreground">{audit.domain} · ChatGPT</p>
      </div>

      {/* Discovered competitors */}
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
              <DiscoveredCard
                key={d.domain}
                d={d}
                queries={queriesForDomain(polls, d.domain)}
              />
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
          The rivals you listed, and the queries each was cited in.
        </p>
        {named.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            You didn't name any competitors for this audit.
          </p>
        ) : (
          <div className="space-y-3">
            {named.map((c) => (
              <div
                key={c.name}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-card-foreground">
                    {c.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    cited in {c.queries.length} quer
                    {c.queries.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                {c.queries.length > 0 && (
                  <ExpandableQueryList queries={c.queries} />
                )}
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
          <div className="space-y-3">
            {otherSources.map((d) => (
              <div
                key={d.domain}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-card-foreground">
                      {d.domain}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {d.label}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    cited in {d.queries_seen_in} quer
                    {d.queries_seen_in === 1 ? "y" : "ies"}
                  </span>
                </div>
                <ExpandableQueryList
                  queries={queriesForDomain(polls, d.domain)}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiscoveredCard({
  d,
  queries,
}: {
  d: DiscoveredCompetitor;
  queries: string[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5">
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
      <div className="mt-1 border-t border-border pt-1">
        <ExpandableQueryList queries={queries} />
      </div>
    </div>
  );
}
