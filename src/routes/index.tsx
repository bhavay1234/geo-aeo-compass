import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { StatCard } from "@/components/StatCard";
import { VisibilityChart } from "@/components/VisibilityChart";
import { PlatformBreakdown } from "@/components/PlatformBreakdown";
import { QueryTable } from "@/components/QueryTable";
import { CompetitorSection } from "@/components/CompetitorCard";
import {
  Eye,
  MessageSquare,
  Search,
  Target,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AEO/GEO Tracker — Dashboard" },
      { name: "description", content: "Track your brand's visibility across AI search engines and generative platforms." },
      { property: "og:title", content: "AEO/GEO Tracker — Dashboard" },
      { property: "og:description", content: "Track your brand's visibility across AI search engines and generative platforms." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Hero banner */}
        <div className="relative overflow-hidden rounded-2xl bg-card border border-border p-8">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-sm text-primary font-medium mb-2">
              <ArrowUpRight className="h-4 w-4" />
              <span>AI Visibility Score up 12% this month</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-card-foreground">
              Track Your Brand Across AI Platforms
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Monitor how your brand appears in ChatGPT, Perplexity, Gemini, and Claude responses. Optimize for AI Engine Optimization (AEO) and Generative Engine Optimization (GEO).
            </p>
            <div className="mt-5 flex gap-3">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                Add New Query
              </Button>
              <Button variant="outline">View Report</Button>
            </div>
          </div>
          <div className="absolute right-0 top-0 h-full w-1/3 opacity-10">
            <svg viewBox="0 0 200 200" className="h-full w-full">
              <defs>
                <linearGradient id="gridGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#2dd4a8" />
                </linearGradient>
              </defs>
              <g stroke="url(#gridGrad)" strokeWidth="0.5">
                {Array.from({ length: 20 }).map((_, i) => (
                  <line key={`h${i}`} x1="0" y1={i * 10} x2="200" y2={i * 10} />
                ))}
                {Array.from({ length: 20 }).map((_, i) => (
                  <line key={`v${i}`} x1={i * 10} y1="0" x2={i * 10} y2="200" />
                ))}
              </g>
            </svg>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="AI Visibility Score"
            value="87"
            change="+12%"
            changeType="positive"
            icon={Eye}
            description="Out of 100 across all platforms"
          />
          <StatCard
            title="Brand Mentions"
            value="1,070"
            change="+23%"
            changeType="positive"
            icon={MessageSquare}
            description="Total mentions this month"
          />
          <StatCard
            title="Queries Tracked"
            value="47"
            change="+5"
            changeType="positive"
            icon={Search}
            description="Active monitored queries"
          />
          <StatCard
            title="Competitors"
            value="8"
            change="+2"
            changeType="neutral"
            icon={Target}
            description="Brands being monitored"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <VisibilityChart />
          </div>
          <div>
            <PlatformBreakdown />
          </div>
        </div>

        {/* Query table + Competitors */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <QueryTable />
          </div>
          <div>
            <CompetitorSection />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
