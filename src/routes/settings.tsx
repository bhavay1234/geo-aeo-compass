import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { llmsPolled } from "@/components/terminal/derive";
import type { LlmSource } from "@/lib/db/types";

const LLM_LABEL: Record<LlmSource, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings - Compass" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <Workspace>
      <SettingsInner />
    </Workspace>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "11px 18px",
        borderBottom: "1px solid var(--grid)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function SettingsInner() {
  const { audit, loading, hasAnyCompleted } = useWorkspace();

  if (loading && !audit) return <div className="tm-empty mono">Loading…</div>;
  if (!audit) {
    if (!hasAnyCompleted)
      return (
        <div className="tm-empty">
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
            No audit selected
          </p>
          <p style={{ marginTop: 6 }}>Run an audit to see its configuration.</p>
          <Link to="/" className="tm-btn" style={{ marginTop: 16 }}>
            Run an audit
          </Link>
        </div>
      );
    return <div className="tm-empty mono">Loading…</div>;
  }

  const competitors = audit.competitors ?? [];
  const discovered = (audit.discovered_competitors ?? []).filter(
    (d) => d.label === "competitor"
  ).length;

  return (
    <div className="tm-rows" style={{ maxWidth: 640 }}>
      <div className="tm-panel tm-reveal" style={{ borderRight: "none" }}>
        <div className="tm-phead">
          <h2>◧ Brand</h2>
          <span className="meta">audited target</span>
        </div>
        <Row label="Brand name" value={audit.brand_name} />
        <Row label="Domain" value={audit.domain} />
        <Row
          label="Named competitors"
          value={competitors.length ? competitors.join(", ") : "None"}
        />
        <Row label="Discovered competitors" value={`${discovered}`} />
      </div>

      <div className="tm-panel tm-reveal" style={{ borderRight: "none", animationDelay: ".05s" }}>
        <div className="tm-phead">
          <h2>◫ Tracking scope</h2>
          <span className="meta">this run</span>
        </div>
        <Row
          label="Answer engines"
          value={llmsPolled(audit)
            .map((l) => LLM_LABEL[l])
            .join(" · ")}
        />
        <Row label="AI answers in audit" value={`${audit.progress_total}`} />
        <Row label="Status" value={audit.status} />
      </div>

      <p style={{ padding: "14px 18px", fontSize: 11, color: "var(--ink-3)" }}>
        Configuration is fixed per run - start a new audit from the launcher to
        change brand, competitors, or queries.
      </p>
    </div>
  );
}
