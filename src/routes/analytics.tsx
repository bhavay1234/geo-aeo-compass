import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { VisibilityChart } from "@/components/VisibilityChart";
import { PlatformBreakdown } from "@/components/PlatformBreakdown";
import { CompetitorSection } from "@/components/CompetitorCard";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — AEO/GEO Tracker" },
      { name: "description", content: "Deep dive into your brand's AI visibility analytics." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Deep dive into your brand's AI visibility analytics
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <VisibilityChart />
          </div>
          <div>
            <PlatformBreakdown />
          </div>
        </div>

        <CompetitorSection />
      </div>
    </DashboardShell>
  );
}
