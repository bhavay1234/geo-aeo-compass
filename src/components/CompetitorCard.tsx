import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const competitors = [
  {
    name: "Your Brand",
    score: 87,
    change: 12,
    trend: "up" as const,
    topQueries: 42,
    totalMentions: 1070,
  },
  {
    name: "Competitor A",
    score: 72,
    change: -3,
    trend: "down" as const,
    topQueries: 31,
    totalMentions: 840,
  },
  {
    name: "Competitor B",
    score: 64,
    change: 8,
    trend: "up" as const,
    topQueries: 25,
    totalMentions: 620,
  },
  {
    name: "Competitor C",
    score: 58,
    change: 0,
    trend: "flat" as const,
    topQueries: 18,
    totalMentions: 495,
  },
];

export function CompetitorSection() {
  const maxScore = Math.max(...competitors.map((c) => c.score));

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-card-foreground">
          Competitor Comparison
        </h3>
        <p className="text-sm text-muted-foreground">
          AI visibility scores compared to key competitors
        </p>
      </div>

      <div className="space-y-5">
        {competitors.map((comp) => (
          <div key={comp.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-card-foreground">
                  {comp.name}
                </span>
                {comp.trend === "up" && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-success">
                    <TrendingUp className="h-3 w-3" />+{comp.change}%
                  </span>
                )}
                {comp.trend === "down" && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-destructive">
                    <TrendingDown className="h-3 w-3" />
                    {comp.change}%
                  </span>
                )}
                {comp.trend === "flat" && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Minus className="h-3 w-3" />
                    {comp.change}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{comp.topQueries} top queries</span>
                <span>{comp.totalMentions.toLocaleString()} mentions</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(comp.score / maxScore) * 100}%`,
                    backgroundColor:
                      comp.name === "Your Brand"
                        ? "#6366f1"
                        : "#4a5568",
                  }}
                />
              </div>
              <span className="w-10 text-right text-sm font-semibold text-card-foreground">
                {comp.score}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
