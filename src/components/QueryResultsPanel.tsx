import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CitedBrands, CitedBrandsLegend } from "@/components/CitedBrands";
import { cn } from "@/lib/utils";
import type { PollResult, Suggestion } from "@/lib/db/types";
import {
  CheckCircle2,
  XCircle,
  ChevronRight,
  Search,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";

const SEVERITY_STYLES: Record<Suggestion["severity"], string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function SituationLabel({ situation }: { situation: Suggestion["situation"] }) {
  const text = situation.replace(/_/g, " ");
  return <span className="capitalize">{text}</span>;
}

export function QueryResultsPanel({
  polls,
  ownDomain,
  namedCompetitors,
}: {
  polls: PollResult[];
  ownDomain: string;
  namedCompetitors: string[];
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = polls.filter((p) =>
    p.query_text.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search queries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          {filtered.length} of {polls.length} queries
        </span>
      </div>

      <div className="mb-4">
        <CitedBrandsLegend />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44%]">Query</TableHead>
              <TableHead>Cited</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Brands cited</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground"
                >
                  No queries match “{search}”.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => {
                const isOpen = expanded.has(p.id);
                return (
                  <>
                    <TableRow
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium text-card-foreground">
                        {p.query_text}
                      </TableCell>
                      <TableCell>
                        {p.brand_cited ? (
                          <div className="flex items-center gap-1.5 text-success">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-sm font-medium">Yes</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-destructive">
                            <XCircle className="h-4 w-4" />
                            <span className="text-sm font-medium">No</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.brand_position ?? "—"}
                      </TableCell>
                      <TableCell>
                        <CitedBrands
                          competitorsCited={p.competitors_cited ?? []}
                          discoveredInQuery={p.discovered_in_query ?? []}
                          ownDomain={ownDomain}
                          namedCompetitors={namedCompetitors}
                        />
                      </TableCell>
                      <TableCell>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            isOpen && "rotate-90"
                          )}
                        />
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${p.id}-detail`} className="hover:bg-transparent">
                        <TableCell colSpan={5} className="bg-muted/30">
                          <QueryDetail poll={p} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function QueryDetail({ poll }: { poll: PollResult }) {
  const citations = (poll.raw_citations ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-5 py-3">
      {poll.brand_mentioned_uncited && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Your brand was named in the answer but not formally cited.
        </div>
      )}

      {poll.suggestion && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold text-card-foreground">
              Recommendation
            </span>
            <Badge
              variant="outline"
              className={SEVERITY_STYLES[poll.suggestion.severity]}
            >
              {poll.suggestion.severity}
            </Badge>
            <Badge
              variant="outline"
              className="border-muted-foreground/30 bg-muted text-muted-foreground"
            >
              <SituationLabel situation={poll.suggestion.situation} />
            </Badge>
          </div>
          <p className="text-sm text-card-foreground">{poll.suggestion.action}</p>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-card-foreground">
          Sources cited ({citations.length})
        </p>
        {citations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No live sources — ChatGPT answered from its training.
          </p>
        ) : (
          <ol className="space-y-2">
            {citations.map((c, i) => (
              <li
                key={`${c.url}-${i}`}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-card-foreground">
                    {c.title || c.domain}
                  </span>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {c.domain}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {c.anchor_text && (
                  <p className="mt-1.5 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                    “{c.anchor_text}”
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {poll.full_response && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-semibold text-card-foreground">
            Full ChatGPT answer
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {poll.full_response}
          </p>
        </details>
      )}
    </div>
  );
}
