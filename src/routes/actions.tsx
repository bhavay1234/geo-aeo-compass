import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { Meter } from "@/components/terminal/primitives";
import { queryState, whoCited, type QueryState } from "@/components/terminal/derive";
import { updateNotes } from "@/lib/client/api";
import type { Audit, PollResult, Suggestion } from "@/lib/db/types";

export const Route = createFileRoute("/actions")({
  head: () => ({ meta: [{ title: "Actionables — Compass" }] }),
  component: ActionsPage,
});

function ActionsPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <ActionsView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

type Status = "todo" | "doing" | "done";
const STATE_STRIPE: Record<QueryState, string> = {
  absent: "var(--hot)",
  weak: "var(--warn)",
  held: "var(--pos)",
};
const STATE_LABEL: Record<QueryState, string> = {
  absent: "Invisible",
  weak: "Weak",
  held: "Held",
};

interface Action {
  id: string;
  query: string;
  state: QueryState;
  title: string;
  who: string[];
  sources: number;
  impact: number;
  effort: number;
  severity: Suggestion["severity"];
}

function pageLabel(t: "dedicated" | "blog" | "other"): string {
  return t === "blog" ? "blog post" : t === "dedicated" ? "dedicated page" : "general page";
}

/**
 * Precise action + effort derived from OUR own page vs what the cited
 * competitors have (Part 4). Returns null until citation analysis has run, so
 * the caller falls back to the deterministic LLM suggestion.
 */
function refineAction(p: PollResult, query: string): { title: string; effort: number } | null {
  const own = p.own_page;
  if (!own) return null;
  const comps = p.why_cited ?? [];
  const compHasSchema = comps.some((c) => c.factors.schema_richness.length > 0);
  const compDeep = comps.some((c) => c.factors.content_depth >= 800);
  const compDedicated = comps.some((c) => c.factors.page_type === "dedicated");

  if (!own.exists) {
    const wants: string[] = [];
    if (compDedicated) wants.push("dedicated pages");
    if (compDeep) wants.push("in-depth content");
    if (compHasSchema) wants.push("FAQPage/Organization schema");
    const tail = wants.length ? ` Competitors win here with ${wants.join(", ")}.` : "";
    return { title: `Build a dedicated page targeting “${query}”.${tail}`, effort: 4 };
  }

  const gaps: string[] = [];
  let effort = 1;
  if (own.page_type !== "dedicated" && compDedicated) {
    gaps.push(`it's a ${pageLabel(own.page_type)}`);
    effort++;
  }
  if (compHasSchema && own.schema_types.length === 0) {
    gaps.push("has no schema");
    effort++;
  }
  if (compDeep && own.word_count < 800) {
    gaps.push("is thin on content");
    effort++;
  }
  if (!own.on_page_targeting) {
    gaps.push("doesn't target the query in its title");
    effort++;
  }
  const url = own.url ? own.url.replace(/^https?:\/\//, "") : "a page";
  const gapText = gaps.length ? ` but ${gaps.join(", ")}` : "";
  return {
    title: `You have ${url}${gapText} — upgrade it to win “${query}”.`,
    effort: Math.min(5, Math.max(1, effort)),
  };
}

function ActionsView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const actions: Action[] = polls
    .filter((p) => p.suggestion && p.suggestion.situation !== "winning")
    .map((p) => {
      const state = queryState(p);
      const who = whoCited(p, audit.brand_name);
      const impact = state === "absent" ? 3 + Math.min(2, who.length) : 2;
      const refined = refineAction(p, p.query_text);
      const effort = refined
        ? refined.effort
        : state === "absent"
          ? 4
          : 2; // pre-analysis heuristic
      return {
        id: p.id,
        query: p.query_text,
        state,
        title: refined ? refined.title : p.suggestion!.action,
        who,
        sources: (p.citations ?? []).length,
        impact: Math.min(5, impact),
        effort,
        severity: p.suggestion!.severity,
      };
    })
    .sort((a, b) => b.impact * (6 - b.effort) - a.impact * (6 - a.effort));

  const high = actions.filter((a) => a.severity === "high").length;

  return (
    <div>
      <div className="tm-toolbar">
        <span className="tm-sort mono" style={{ paddingLeft: 16 }}>
          {actions.length} actions · {high} high-priority · sorted by impact ×
          ease
        </span>
      </div>

      <NotesEditor auditId={audit.id} initialNotes={audit.notes ?? ""} />

      <div className="tm-rows">
        {actions.length === 0 ? (
          <div className="tm-empty">
            No actionable gaps — you're cited across these queries.
          </div>
        ) : (
          actions.map((a, i) => (
            <ActionRow key={a.id} a={a} rank={i + 1} />
          ))
        )}
      </div>
    </div>
  );
}

function ActionRow({ a, rank }: { a: Action; rank: number }) {
  const [status, setStatus] = useState<Status>("todo");
  const STATUS_LABEL: Record<Status, string> = {
    todo: "To do",
    doing: "In progress",
    done: "Done",
  };
  return (
    <div
      className="tm-card tm-reveal"
      style={{
        animationDelay: `${Math.min(rank, 8) * 0.03}s`,
        position: "relative",
        opacity: status === "done" ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: STATE_STRIPE[a.state],
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", paddingTop: 2 }}>
          {String(rank).padStart(2, "0")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
            {a.title}
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
            {STATE_LABEL[a.state]} · {a.who.length} competitor
            {a.who.length === 1 ? "" : "s"} cited · {a.sources} sources in answer
          </div>
          {(a.who.length > 0 || true) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              <span className="tm-chip" title="query this fixes">
                {a.query}
              </span>
              {a.who.slice(0, 3).map((w, i) => (
                <span
                  key={i}
                  className="tm-chip"
                  style={{ background: "var(--neg-bg)", color: "var(--neg)" }}
                >
                  {w}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 18, marginTop: 12, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                Impact
              </span>
              <Meter value={a.impact} />
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                Effort
              </span>
              <Meter value={a.effort} />
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(["todo", "doing", "done"] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="tm-chip"
              style={
                status === s
                  ? { background: "var(--ink)", color: "var(--bg)", cursor: "pointer" }
                  : { cursor: "pointer" }
              }
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotesEditor({
  auditId,
  initialNotes,
}: {
  auditId: string;
  initialNotes: string;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNotes(initialNotes);
    setSaved(false);
  }, [auditId, initialNotes]);

  const mutation = useMutation({
    mutationFn: () => updateNotes(auditId, notes),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["audit-result", auditId] });
    },
  });

  return (
    <div className="tm-card">
      <div className="tm-label">Strategic notes</div>
      <textarea
        className="tm-input nar"
        style={{ minHeight: 80 }}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        placeholder="Your close after reviewing the gaps — saved to this audit."
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <button
          className="tm-btn"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save notes"}
        </button>
        {saved && !mutation.isPending && (
          <span style={{ fontSize: 12, color: "var(--pos)" }}>Saved</span>
        )}
      </div>
    </div>
  );
}
