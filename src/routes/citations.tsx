import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { SourceTag } from "@/components/terminal/primitives";
import type { SourceTagKind } from "@/components/terminal/derive";
import type {
  Audit,
  CitationAnalysisEntry,
  SourceType,
} from "@/lib/db/types";

export const Route = createFileRoute("/citations")({
  head: () => ({ meta: [{ title: "Citations — Compass" }] }),
  component: CitationsPage,
});

function CitationsPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, partial }) => (
          <>
            {partial && <PartialBanner />}
            <CitationsView audit={audit} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

const KIND: Record<SourceType, { kind: SourceTagKind; label: string }> = {
  own: { kind: "you", label: "owned" },
  competitor: { kind: "comp", label: "vendor" },
  review_directory: { kind: "agg", label: "review dir" },
  analyst: { kind: "agg", label: "analyst" },
  editorial: { kind: "ed", label: "editorial" },
  other: { kind: "agg", label: "source" },
};

function hint(t: SourceType): string {
  if (t === "competitor") return "competitor territory";
  if (t === "editorial") return "earn a mention";
  return "get listed here";
}

function Row({ e, rank }: { e: CitationAnalysisEntry; rank: number }) {
  const k = KIND[e.source_type] ?? KIND.other;
  return (
    <div className="tm-card" style={{ position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: e.brand_present ? "var(--pos)" : "var(--hot)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", width: 22 }}>
          {String(rank).padStart(2, "0")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}
            >
              {e.domain}
            </a>
            <SourceTag kind={k.kind} />
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
            cited in {e.query_count} quer{e.query_count === 1 ? "y" : "ies"}
            {!e.brand_present && ` · ${hint(e.source_type)}`}
          </div>
        </div>
        <span
          className="tm-badge"
          style={
            e.brand_present
              ? { background: "var(--pos-bg)", color: "var(--pos)" }
              : { background: "var(--hot-bg)", color: "var(--hot)" }
          }
        >
          {e.brand_present ? "You appear" : "Missing"}
        </span>
      </div>
    </div>
  );
}

function CitationsView({ audit }: { audit: Audit }) {
  const entries = audit.citation_analysis ?? [];
  const recentlyCompleted =
    !!audit.completed_at &&
    Date.now() - new Date(audit.completed_at).getTime() < 5 * 60_000;
  const analyzing =
    audit.citation_status === "analyzing" ||
    (audit.citation_status == null && recentlyCompleted);
  const failed = audit.citation_status === "failed";

  if (entries.length === 0) {
    return (
      <div className="tm-empty">
        {analyzing ? (
          <p className="mono">◴ Analyzing cited sources…</p>
        ) : failed ? (
          <p>Citation analysis was unavailable for this run — try re-running.</p>
        ) : (
          <p>No cited sources recorded in this run.</p>
        )}
      </div>
    );
  }

  const present = entries.filter((e) => e.brand_present);
  const missing = entries.filter((e) => !e.brand_present);

  return (
    <div>
      <div
        style={{
          padding: "20px 20px 18px",
          borderBottom: "1px solid var(--grid-2)",
          background: "var(--panel)",
        }}
      >
        <p
          className="nar"
          style={{ fontSize: 22, lineHeight: 1.42, fontWeight: 500, color: "var(--ink-2)", maxWidth: 1040 }}
        >
          ChatGPT cited <b style={{ color: "var(--ink)" }}>{entries.length}</b>{" "}
          source{entries.length === 1 ? "" : "s"} across these queries — you appear on{" "}
          <b style={{ color: present.length > 0 ? "var(--pos)" : "var(--hot)" }}>
            {present.length}
          </b>{" "}
          of them.
          {analyzing && (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 10 }}>
              ◴ analyzing…
            </span>
          )}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>
          Where ChatGPT sources its answers, and whether you're on the page. Missing
          aggregators &amp; review directories are your get-listed worklist.
        </p>
      </div>

      {missing.length > 0 && (
        <>
          <div className="tm-phead">
            <h2 style={{ color: "var(--hot)" }}>⚑ You're missing here</h2>
            <span className="meta">{missing.length} sources · most-cited first</span>
          </div>
          <div className="tm-rows">
            {missing.map((e, i) => (
              <Row key={e.url} e={e} rank={i + 1} />
            ))}
          </div>
        </>
      )}

      {present.length > 0 && (
        <>
          <div className="tm-phead">
            <h2 style={{ color: "var(--pos)" }}>✓ You appear here</h2>
            <span className="meta">{present.length} sources</span>
          </div>
          <div className="tm-rows">
            {present.map((e, i) => (
              <Row key={e.url} e={e} rank={i + 1} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
