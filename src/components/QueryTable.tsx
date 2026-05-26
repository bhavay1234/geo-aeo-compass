import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

const queries = [
  {
    query: "Best CRM software for startups",
    platform: "ChatGPT",
    mentioned: true,
    position: "Featured",
    sentiment: "positive",
    date: "2h ago",
  },
  {
    query: "How to optimize for AI search engines",
    platform: "Perplexity",
    mentioned: true,
    position: "Top 3",
    sentiment: "positive",
    date: "4h ago",
  },
  {
    query: "Top project management tools 2025",
    platform: "Gemini",
    mentioned: false,
    position: "—",
    sentiment: "neutral",
    date: "6h ago",
  },
  {
    query: "Best marketing automation platforms",
    platform: "Claude",
    mentioned: true,
    position: "Top 5",
    sentiment: "neutral",
    date: "12h ago",
  },
  {
    query: "SEO vs GEO vs AEO differences",
    platform: "ChatGPT",
    mentioned: true,
    position: "Featured",
    sentiment: "positive",
    date: "1d ago",
  },
  {
    query: "Enterprise email marketing solutions",
    platform: "Perplexity",
    mentioned: false,
    position: "—",
    sentiment: "negative",
    date: "1d ago",
  },
  {
    query: "Customer success software comparison",
    platform: "Gemini",
    mentioned: true,
    position: "Top 3",
    sentiment: "positive",
    date: "2d ago",
  },
];

export function QueryTable() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-card-foreground">
            Recent Queries
          </h3>
          <p className="text-sm text-muted-foreground">
            Latest tracked search queries and brand mention status
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Query</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Mentioned</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead className="text-right">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queries.map((q, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium text-card-foreground">
                  {q.query}
                </TableCell>
                <TableCell className="text-muted-foreground">{q.platform}</TableCell>
                <TableCell>
                  {q.mentioned ? (
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
                  {q.position}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      q.sentiment === "positive"
                        ? "border-success/30 bg-success/10 text-success"
                        : q.sentiment === "negative"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-muted-foreground/30 bg-muted text-muted-foreground"
                    }
                  >
                    {q.sentiment === "positive" && (
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                    )}
                    {q.sentiment === "negative" && (
                      <AlertCircle className="mr-1 h-3 w-3" />
                    )}
                    {q.sentiment === "neutral" && (
                      <AlertCircle className="mr-1 h-3 w-3" />
                    )}
                    {q.sentiment}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {q.date}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
