import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { CompetitorSection } from "@/components/CompetitorCard";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/competitors")({
  head: () => ({
    meta: [
      { title: "Competitors — AEO/GEO Tracker" },
      { name: "description", content: "Track and compare competitor AI visibility." },
    ],
  }),
  component: CompetitorsPage,
});

function CompetitorsPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
              Competitors
            </h1>
            <p className="text-sm text-muted-foreground">
              Track and compare competitor AI visibility
            </p>
          </div>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Add Competitor
          </Button>
        </div>

        <CompetitorSection />
      </div>
    </DashboardShell>
  );
}
