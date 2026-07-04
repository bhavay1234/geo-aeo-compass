import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { SourceTag } from "@/components/terminal/primitives";
import {
  llmsPolled,
  categorizeCitations,
  type SourceTagKind,
} from "@/components/terminal/derive";
import type { CitationCategory } from "@/lib/audit/source-classifier";
import type {
  Audit,
  CitationAnalysisEntry,
  PollResult,
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
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <CitationsView audit={audit} polls={polls} />
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

function Row({
  e,
  rank,
  llmCount,
  title,
}: {
  e: CitationAnalysisEntry;
  rank: number;
  llmCount: number;
  title: string;
}) {
  const k = KIND[e.source_type] ?? KIND.other;
  const citingCount = (e.llms_citing ?? []).length || 1;
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--ink-3)", width: 22, paddingTop: 2 }}
        >
          {String(rank).padStart(2, "0")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Page title — the real link text, not just the bare domain. */}
            <a
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}
            >
              {title || e.domain}
            </a>
            <SourceTag kind={k.kind} />
            {llmCount > 1 && citingCount >= 2 && (
              <span
                className="mono"
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".05em",
                  padding: "2px 6px",
                  borderRadius: 2,
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  textTransform: "uppercase",
                }}
                title="Cited by multiple LLMs — a universal citation source"
              >
                Universal · {citingCount}/{llmCount}
              </span>
            )}
          </div>
          {/* Complete URL of the cited page. */}
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--accent, #4a6cf7)",
              textDecoration: "none",
              marginTop: 3,
              overflowWrap: "anywhere",
              wordBreak: "break-all",
            }}
            title={e.url}
          >
            {e.url}
          </a>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3 }}>
            cited by <b style={{ color: "var(--ink-2)" }}>{citingCount}/{llmCount}</b>{" "}
            LLM{llmCount === 1 ? "" : "s"} · across {e.query_count} quer
            {e.query_count === 1 ? "y" : "ies"}
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

function CitationsView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const entries = audit.citation_analysis ?? [];
  const llmCount = llmsPolled(audit).length;
  const [openKey, setOpenKey] = useState<CitationCategory | null>(null);

  // URL → page title, mined from the raw poll citations (citation_analysis
  // stores the URL but not the title). First non-empty title for a URL wins.
  const titleByUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of polls) {
      for (const c of p.citations ?? []) {
        if (c.url && c.title && !m.get(c.url)) m.set(c.url, c.title);
      }
      for (const c of p.raw_citations ?? []) {
        if (c.url && c.title && !m.get(c.url)) m.set(c.url, c.title);
      }
    }
    return m;
  }, [polls]);

  const universalMissing = entries.filter(
    (e) => !e.brand_present && (e.llms_citing ?? []).length >= 2
  );
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
  const groups = categorizeCitations(entries);

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
          {llmCount > 1 ? (
            <>
              <b style={{ color: "var(--ink)" }}>{llmCount} LLMs</b> collectively
              cited <b style={{ color: "var(--ink)" }}>{entries.length}</b> source
              {entries.length === 1 ? "" : "s"} — you appear on{" "}
              <b style={{ color: present.length > 0 ? "var(--pos)" : "var(--hot)" }}>
                {present.length}
              </b>{" "}
              of them
              {universalMissing.length > 0 ? (
                <>
                  {" "}·{" "}
                  <b style={{ color: "var(--hot)" }}>{universalMissing.length}</b>{" "}
                  are cited by multiple LLMs but missing you
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              ChatGPT cited <b style={{ color: "var(--ink)" }}>{entries.length}</b>{" "}
              source{entries.length === 1 ? "" : "s"} across these queries — you appear
              on{" "}
              <b style={{ color: present.length > 0 ? "var(--pos)" : "var(--hot)" }}>
                {present.length}
              </b>{" "}
              of them.
            </>
          )}
          {analyzing && (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 10 }}>
              ◴ analyzing…
            </span>
          )}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>
          Where the LLMs source their answers, and whether you're on the page.
          {llmCount > 1
            ? " Sources cited by multiple LLMs are the highest-leverage places to get listed."
            : " Missing aggregators & review directories are your get-listed worklist."}
        </p>
      </div>

      {/* Category overview — where the LLMs pull from, clubbed into buckets. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "14px 20px",
          borderBottom: "1px solid var(--grid-2)",
        }}
      >
        {groups.map((g) => {
          const active = openKey === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setOpenKey(active ? null : g.key)}
              className="tm-badge"
              style={{
                cursor: "pointer",
                border: active ? "1px solid var(--ink-3)" : "1px solid transparent",
                background: active ? "var(--panel)" : "var(--panel-2)",
                color: "var(--ink-2)",
                fontSize: 11.5,
              }}
              title={`${g.total} source${g.total === 1 ? "" : "s"}${
                g.missing > 0 ? ` · ${g.missing} missing you` : ""
              } — click to ${active ? "collapse" : "expand"}`}
            >
              {g.label} <b style={{ color: "var(--ink)" }}>{g.total}</b>
              {g.missing > 0 && (
                <span style={{ color: "var(--hot)" }}> · {g.missing} missing</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapsed by default — click a category header (or its chip above) to
          open it. Single-open accordion keeps the long list navigable. */}
      {groups.map((g) => {
        const open = openKey === g.key;
        return (
          <div key={g.key}>
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : g.key)}
              className="tm-phead"
              style={{
                cursor: "pointer",
                width: "100%",
                border: "none",
                background: "transparent",
                textAlign: "left",
              }}
              aria-expanded={open}
            >
              <h2>
                <span
                  className="mono"
                  style={{ color: "var(--ink-3)", marginRight: 8, fontSize: 13 }}
                >
                  {open ? "▾" : "▸"}
                </span>
                {g.label}
              </h2>
              <span className="meta">
                {g.total} source{g.total === 1 ? "" : "s"}
                {g.missing > 0 && (
                  <span style={{ color: "var(--hot)" }}> · {g.missing} missing you</span>
                )}
              </span>
            </button>
            {open && (
              <div className="tm-rows">
                {g.entries.map((e, i) => (
                  <Row
                    key={e.url}
                    e={e}
                    rank={i + 1}
                    llmCount={llmCount}
                    title={titleByUrl.get(e.url) ?? ""}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
