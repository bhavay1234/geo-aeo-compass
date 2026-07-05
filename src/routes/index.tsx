import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { startAudit, getRecentAudits, analyzeDna, type DnaResponse } from "@/lib/client/api";
import { useTheme } from "@/components/terminal/useTheme";
import { Icon } from "@/components/terminal/primitives";
import type { AuditStatus } from "@/lib/db/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Compass - AEO terminal" },
      {
        name: "description",
        content: "Track how often ChatGPT, Perplexity and Gemini cite your brand for buyer queries.",
      },
    ],
  }),
  component: Index,
});

function splitCommas(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
function splitLines(value: string): string[] {
  return value.split("\n").map((s) => s.trim()).filter(Boolean);
}

const STATUS_CLASS: Record<AuditStatus, string> = {
  pending: "tm-t3",
  running: "tm-t2",
  finalizing: "tm-t2",
  completed: "tm-t1",
  failed: "tm-tg-comp",
};

function Index() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const [brandName, setBrandName] = useState("");
  const [domain, setDomain] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [queries, setQueries] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [intent, setIntent] = useState<"transactional" | "general">("transactional");
  const [dna, setDna] = useState<DnaResponse["dna"] | null>(null);
  const [querySource, setQuerySource] = useState<"labs" | "llm" | null>(null);
  const [pickedQueries, setPickedQueries] = useState<DnaResponse["queries"]>([]);

  const queryCount = splitLines(queries).length;

  const recentQuery = useQuery({
    queryKey: ["recent-audits"],
    queryFn: getRecentAudits,
  });

  const dnaMutation = useMutation({
    mutationFn: analyzeDna,
    onSuccess: (r) => {
      setDna(r.dna);
      setQuerySource(r.query_source);
      setPickedQueries(r.queries);
      setBrandName(r.dna.brand_name);
      // Auto-detected rivals prefill the Competitors field (own brand excluded).
      const own = r.dna.brand_name.toLowerCase();
      setCompetitors(
        r.dna.competitors.filter((c) => c.toLowerCase() !== own).join(", ")
      );
      setQueries(r.queries.map((q) => q.keyword).join("\n"));
    },
  });

  const mutation = useMutation({
    mutationFn: startAudit,
    onSuccess: (data) => {
      navigate({ to: "/summary", search: { audit: data.audit_id } });
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
      brand_dna: dna ?? undefined,
    });
  }

  const submitting = mutation.isPending;
  const error = validationError ?? (mutation.error as Error | null)?.message;

  return (
    <div className="tm tm-solo">
      <header className="tm-solohead">
        <div className="tm-side-brand" style={{ padding: 0 }}>
          <span className="mk">
            <Icon name="spark" size={15} strokeWidth={2} />
          </span>
          Compass
        </div>
        <div className="tm-spacer" />
        <div className="tm-live">
          <span className="tm-blip" />
          New audit · 3 engines
        </div>
        <button className="tm-toggle" onClick={toggle} aria-label="Toggle theme" style={{ flex: "0 0 auto" }}>
          <Icon name={theme === "dark" ? "moon" : "sun"} size={15} />
          <span className="tm-sw" />
        </button>
      </header>

      <div className="tm-grid" style={{ gridTemplateColumns: "1.4fr 1fr", gridTemplateRows: "auto" }}>
        {/* Run form */}
        <div className="tm-panel tm-reveal">
          <div className="tm-phead">
            <h2>Run AEO audit</h2>
            <span className="meta">ChatGPT · Perplexity · Gemini</span>
          </div>
          <div style={{ padding: "20px 18px" }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-.02em",
                color: "var(--ink)",
                lineHeight: 1.1,
              }}
            >
              How visible is your brand inside ChatGPT, Perplexity &amp; Gemini?
            </h1>
            <p className="nar" style={{ marginTop: 8, fontSize: 15, color: "var(--ink-2)", maxWidth: 520 }}>
              Enter your brand, the competitors you track, and the buyer queries
              you care about. We poll ChatGPT, Perplexity and Gemini for each and measure where you show up.
            </p>

            {/* ① Auto-build from the website: scrape -> Brand DNA -> 20 queries
                picked by real search volume. Intent question REQUIRED
                before generation. */}
            <div
              style={{
                marginTop: 18,
                border: "1px solid var(--grid-2)",
                borderRadius: 4,
                padding: "14px 14px 16px",
                background: "var(--panel)",
              }}
            >
              <div className="tm-label">1 · Start from your website</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="tm-input"
                  placeholder="yourdomain.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={dnaMutation.isPending || submitting}
                  style={{ flex: 1 }}
                />
                <button
                  className="tm-btn"
                  onClick={() => {
                    setValidationError(null);
                    if (!domain.trim()) return setValidationError("Enter your domain first.");
                    dnaMutation.mutate({ domain: domain.trim(), intent });
                  }}
                  disabled={dnaMutation.isPending || submitting}
                >
                  {dnaMutation.isPending ? "Analyzing…" : "Analyze website"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Query intent:</span>
                {(
                  [
                    ["transactional", "Transactional (best X, X vs Y, pricing)"],
                    ["general", "General (incl. informational)"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    className="tm-chip"
                    onClick={() => setIntent(k)}
                    disabled={dnaMutation.isPending}
                    style={{
                      cursor: "pointer",
                      background: intent === k ? "var(--ink)" : "var(--panel-2)",
                      color: intent === k ? "var(--bg)" : "var(--ink-2)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {dnaMutation.isPending && (
                <p className="mono" style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)" }}>
                  Reading {domain} - scraping the site, building Brand DNA, and
                  picking the top queries by search volume… (~1 min)
                </p>
              )}
              {dnaMutation.isError && (
                <p style={{ marginTop: 10, fontSize: 12, color: "var(--neg)" }}>
                  {(dnaMutation.error as Error)?.message || "Analysis failed."}
                </p>
              )}

              {dna && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--grid)", paddingTop: 12 }}>
                  <div className="tm-label">Brand DNA</div>
                  <p className="nar" style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>
                    {dna.positioning || "-"}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {dna.category && <span className="tm-chip">{dna.category}</span>}
                    {dna.audience && <span className="tm-chip">{dna.audience}</span>}
                    {dna.products.map((pr) => (
                      <span key={pr} className="tm-chip" style={{ background: "var(--you-bg)", color: "var(--you)" }}>
                        {pr}
                      </span>
                    ))}
                  </div>
                  {pickedQueries.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                      {pickedQueries.slice(0, 20).map((q) => (
                        <span key={q.keyword} className="tm-chip" title={q.intent}>
                          {q.keyword}
                          {querySource === "labs" && q.volume > 0 && (
                            <b className="mono" style={{ marginLeft: 5, color: "var(--ink)" }}>
                              {q.volume >= 1000
                                ? `${Math.round(q.volume / 100) / 10}k`
                                : q.volume}
                              /mo
                            </b>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mono" style={{ marginTop: 8, fontSize: 10.5, color: "var(--ink-3)" }}>
                    {querySource === "labs"
                      ? "Queries ranked by real monthly search volume - review/edit below, then run."
                      : "Queries generated from the Brand DNA - review/edit below, then run."}
                  </p>
                </div>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginTop: 20,
              }}
            >
              <div>
                <label className="tm-label" htmlFor="brand_name">Brand name</label>
                <input
                  id="brand_name"
                  className="tm-input"
                  placeholder="GoComet"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="tm-label" htmlFor="domain">Domain</label>
                <input
                  id="domain"
                  className="tm-input"
                  placeholder="gocomet.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="tm-label" htmlFor="competitors">Competitors</label>
              <input
                id="competitors"
                className="tm-input"
                placeholder="FourKites, project44, Shippeo"
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                disabled={submitting}
              />
              <p style={{ marginTop: 5, fontSize: 11, color: "var(--ink-3)" }}>
                Comma-separated. Optional, but improves competitor detection.
              </p>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="tm-label" htmlFor="queries">Buyer queries</label>
              <textarea
                id="queries"
                className="tm-input mono"
                style={{ minHeight: 150 }}
                placeholder={
                  "best supply chain visibility software\ntop freight tracking platforms 2026\nGoComet vs FourKites"
                }
                value={queries}
                onChange={(e) => setQueries(e.target.value)}
                disabled={submitting}
              />
              <p style={{ marginTop: 5, fontSize: 11, color: "var(--ink-3)" }}>
                One query per line.{" "}
                <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {queryCount} {queryCount === 1 ? "query" : "queries"}
                </span>
              </p>
            </div>

            {error && (
              <div className="tm-warn-banner" style={{ marginTop: 16, borderColor: "var(--neg)", background: "var(--neg-bg)", color: "var(--neg)" }}>
                <span aria-hidden></span>
                {error}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button className="tm-btn" onClick={handleRun} disabled={submitting}>
                {submitting ? "Starting…" : "Run audit"}
              </button>
            </div>
          </div>
        </div>

        {/* Recent audits */}
        <div className="tm-panel tm-reveal" style={{ borderRight: "none", animationDelay: ".05s" }}>
          <div className="tm-phead">
            <h2>Recent audits</h2>
            <span className="meta">last 10</span>
          </div>
          {recentQuery.isLoading ? (
            <div className="tm-empty mono">Loading…</div>
          ) : recentQuery.data && recentQuery.data.length > 0 ? (
            <div className="tm-rows">
              {recentQuery.data.map((a) => (
                <button
                  key={a.id}
                  onClick={() => navigate({ to: "/summary", search: { audit: a.id } })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--grid)",
                    background: "none",
                    border: "none",
                    borderBottomColor: "var(--grid)",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>
                      {a.brand_name}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
                      {a.domain} ·{" "}
                      {a.created_at
                        ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true })
                        : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {a.status === "completed" && a.visibility_score != null && (
                      <span className="mono" style={{ fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
                        {a.visibility_score}
                      </span>
                    )}
                    <span className={`tm-tier ${STATUS_CLASS[a.status]}`}>{a.status}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="tm-empty">No audits yet. Run your first one.</div>
          )}
        </div>
      </div>
    </div>
  );
}
