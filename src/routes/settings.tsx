import { createFileRoute } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { EmptyState } from "@/components/EmptyState";
import { Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AEO/GEO Tracker" },
      { name: "description", content: "Audit configuration and tracking scope." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <Workspace title="Settings">
      <SettingsInner />
    </Workspace>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-card-foreground">{value}</span>
    </div>
  );
}

function SettingsInner() {
  const { audit, loading } = useWorkspace();

  if (loading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (!audit) {
    return (
      <EmptyState
        icon={SettingsIcon}
        title="No completed audits yet"
        description="Run an audit to see its configuration here."
        ctaLabel="Run an audit"
        ctaTo="/"
      />
    );
  }

  const competitors = audit.competitors ?? [];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-card-foreground">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configuration for the selected audit
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h3 className="font-semibold text-card-foreground">Brand</h3>
        </div>
        <div className="divide-y divide-border">
          <Row label="Brand name" value={audit.brand_name} />
          <Row label="Domain" value={audit.domain} />
          <Row
            label="Named competitors"
            value={competitors.length ? competitors.join(", ") : "None"}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h3 className="font-semibold text-card-foreground">Tracking scope</h3>
        </div>
        <div className="divide-y divide-border">
          <Row label="Answer engine" value="ChatGPT (gpt-4o-search-preview)" />
          <Row label="Queries in this audit" value={`${audit.progress_total}`} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        v1 tracks ChatGPT only. Additional answer engines arrive in later
        releases.
      </p>
    </div>
  );
}
