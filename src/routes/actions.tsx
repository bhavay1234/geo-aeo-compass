import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ArrowRight,
  FileText,
  Globe,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

const actions = [
  {
    title: "Optimize content for ChatGPT",
    description:
      "Your product pages are missing structured data. Add FAQ schema to improve AI visibility.",
    priority: "high" as const,
    icon: Sparkles,
    impact: "+15% visibility",
  },
  {
    title: "Expand Perplexity presence",
    description:
      "You appear in only 12% of Perplexity queries. Add more authoritative content.",
    priority: "high" as const,
    icon: Globe,
    impact: "+22% mentions",
  },
  {
    title: "Update Gemini knowledge panel",
    description:
      "Your Gemini knowledge panel is outdated. Update with current product info.",
    priority: "medium" as const,
    icon: FileText,
    impact: "+8% accuracy",
  },
  {
    title: "Add comparison content",
    description:
      "Create comparison pages (vs competitors) to appear in more AI responses.",
    priority: "medium" as const,
    icon: ArrowRight,
    impact: "+18% queries",
  },
  {
    title: "Fix negative sentiment",
    description:
      "3 mentions have negative sentiment. Review and address the underlying issues.",
    priority: "low" as const,
    icon: AlertTriangle,
    impact: "Better sentiment",
  },
];

export const Route = createFileRoute("/actions")({
  head: () => ({
    meta: [
      { title: "Actions — AEO/GEO Tracker" },
      { name: "description", content: "Recommended actions to improve your AI visibility." },
    ],
  }),
  component: ActionsPage,
});

function ActionsPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            Recommended Actions
          </h1>
          <p className="text-sm text-muted-foreground">
            Priority tasks to improve your AI visibility score
          </p>
        </div>

        <div className="space-y-4">
          {actions.map((action) => (
            <div
              key={action.title}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-card/80"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <action.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-card-foreground">
                    {action.title}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      action.priority === "high"
                        ? "bg-destructive/10 text-destructive"
                        : action.priority === "medium"
                          ? "bg-warning/10 text-warning"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {action.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {action.description}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs font-medium text-success">
                    {action.impact}
                  </span>
                  <Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs">
                    Take action
                  </Button>
                </div>
              </div>
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/40 hover:text-success cursor-pointer transition-colors" />
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
