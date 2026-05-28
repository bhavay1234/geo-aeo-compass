import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle } from "lucide-react";
import { CitedBrands, CitedBrandsLegend } from "@/components/CitedBrands";
import type { CompetitorCitation, DiscoveredInQuery } from "@/lib/db/types";

/** Per-query row shape for a real audit. */
export interface QueryTableRow {
  query_text: string;
  brand_cited: boolean;
  brand_position: number | null;
  competitors_cited: CompetitorCitation[];
  discovered_in_query: DiscoveredInQuery[];
}

/** Compact per-query results table (no expand). Used on the audit detail. */
export function QueryTable({
  polls,
  ownDomain = "",
  namedCompetitors = [],
}: {
  polls: QueryTableRow[];
  ownDomain?: string;
  namedCompetitors?: string[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-card-foreground">
            Query Results
          </h3>
          <p className="text-sm text-muted-foreground">
            How ChatGPT answered each buyer query — and whether your brand was
            cited
          </p>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          {polls.length} queries
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {polls.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-sm text-muted-foreground"
                >
                  No query results.
                </TableCell>
              </TableRow>
            ) : (
              polls.map((p, i) => (
                <TableRow key={i}>
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
                      competitorsCited={p.competitors_cited}
                      discoveredInQuery={p.discovered_in_query}
                      ownDomain={ownDomain}
                      namedCompetitors={namedCompetitors}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
