import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { DashboardShell } from "@/components/DashboardShell";
import { AuditStatusBadge } from "@/components/AuditStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { startAudit, getRecentAudits } from "@/lib/client/api";
import { Sparkles, Loader2, AlertCircle, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AEO/GEO Tracker — Dashboard" },
      {
        name: "description",
        content:
          "Track your brand's visibility across AI search engines and generative platforms.",
      },
    ],
  }),
  component: Index,
});

function splitCommas(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function Index() {
  const navigate = useNavigate();

  const [brandName, setBrandName] = useState("");
  const [domain, setDomain] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [queries, setQueries] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const queryCount = useMemo(() => splitLines(queries).length, [queries]);

  const recentQuery = useQuery({
    queryKey: ["recent-audits"],
    queryFn: getRecentAudits,
  });

  const mutation = useMutation({
    mutationFn: startAudit,
    onSuccess: (data) => {
      navigate({ to: "/audit/$id", params: { id: data.audit_id } });
    },
  });

  function handleRun() {
    setValidationError(null);
    const cleanedQueries = splitLines(queries);
    if (!brandName.trim()) return setValidationError("Brand name is required.");
    if (!domain.trim()) return setValidationError("Domain is required.");
    if (cleanedQueries.length === 0)
      return setValidationError("Add at least one query (one per line).");

    mutation.mutate({
      brand_name: brandName.trim(),
      domain: domain.trim(),
      competitors: splitCommas(competitors),
      queries: cleanedQueries,
    });
  }

  const submitting = mutation.isPending;
  const error = validationError ?? (mutation.error as Error | null)?.message;

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Run form */}
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            <span>Run New AEO Audit</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
            How visible is your brand inside ChatGPT?
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Enter your brand, the competitors you track, and the buyer queries
            you care about. We poll ChatGPT for each and measure where you show
            up.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand_name">Brand name</Label>
              <Input
                id="brand_name"
                placeholder="GoComet"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                placeholder="gocomet.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="competitors">Competitors</Label>
            <Input
              id="competitors"
              placeholder="FourKites, project44, Shippeo"
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Optional, but improves competitor detection.
            </p>
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="queries">Buyer queries</Label>
            <Textarea
              id="queries"
              placeholder={
                "best supply chain visibility software\ntop freight tracking platforms 2026\nGoComet vs FourKites"
              }
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              disabled={submitting}
              className="min-h-[160px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              One query per line.{" "}
              <span className="font-medium text-card-foreground">
                {queryCount} {queryCount === 1 ? "query" : "queries"}
              </span>
            </p>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-6">
            <Button
              onClick={handleRun}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                "Run Audit"
              )}
            </Button>
          </div>
        </div>

        {/* Recent audits */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-card-foreground">
              Recent Audits
            </h3>
            <p className="text-sm text-muted-foreground">
              Your latest AEO runs
            </p>
          </div>

          {recentQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : recentQuery.data && recentQuery.data.length > 0 ? (
            <div className="divide-y divide-border">
              {recentQuery.data.map((audit) => (
                <button
                  key={audit.id}
                  onClick={() =>
                    navigate({ to: "/audit/$id", params: { id: audit.id } })
                  }
                  className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium text-card-foreground">
                        {audit.brand_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {audit.domain} ·{" "}
                        {audit.created_at
                          ? formatDistanceToNow(new Date(audit.created_at), {
                              addSuffix: true,
                            })
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {audit.status === "completed" &&
                      audit.visibility_score !== null && (
                        <span className="text-sm font-semibold text-card-foreground">
                          {audit.visibility_score}
                          <span className="text-muted-foreground"> / 100</span>
                        </span>
                      )}
                    <AuditStatusBadge status={audit.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audits yet. Run your first one above.
            </p>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
