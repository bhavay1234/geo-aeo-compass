import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { QueryTable } from "@/components/QueryTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";

export const Route = createFileRoute("/queries")({
  head: () => ({
    meta: [
      { title: "Queries — AEO/GEO Tracker" },
      { name: "description", content: "Manage and track your monitored search queries across AI platforms." },
    ],
  }),
  component: QueriesPage,
});

function QueriesPage() {
  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
              Queries
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage and track your monitored search queries
            </p>
          </div>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Add Query
          </Button>
        </div>

        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search queries..." className="pl-10" />
        </div>

        <QueryTable />
      </div>
    </DashboardShell>
  );
}
