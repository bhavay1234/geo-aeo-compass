import { useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getRecentAudits, getAuditResult } from "@/lib/client/api";
import {
  WorkspaceContext,
  type WorkspaceValue,
} from "./terminal/workspace-context";
import { Sidebar, ReportHeader, GlobalHeader } from "./terminal/Shell";

export { useWorkspace } from "./terminal/workspace-context";

const PENDING = new Set(["pending", "running", "finalizing"]);

/**
 * Terminal shell + shared audit data for all workspace tabs. Owns the global
 * audit selector (status bar) and fetches the selected audit ONCE; tabs read
 * it via useWorkspace(). Selected audit_id lives in the URL as ?audit=<id>.
 * The result query polls while the audit is still running/finalizing and while
 * enrichment (positioning) lands, so loading + live tier upgrades work.
 */
export function Workspace({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { audit?: string };
  const [navOpen, setNavOpen] = useState(false);

  const recentQ = useQuery({
    queryKey: ["recent-audits"],
    queryFn: getRecentAudits,
  });
  const audits = recentQ.data ?? [];
  const completed = audits.filter((a) => a.status === "completed");
  const selectedId = search.audit ?? completed[0]?.id ?? null;

  const resultQ = useQuery({
    queryKey: ["audit-result", selectedId],
    queryFn: () => getAuditResult(selectedId as string),
    enabled: !!selectedId,
    refetchInterval: (query) => {
      const a = query.state.data?.audit;
      if (!a) return false;
      if (PENDING.has(a.status)) return 3000; // run/scoring → keep polling
      if (
        a.status === "completed" &&
        a.positioning == null &&
        a.completed_at != null &&
        Date.now() - new Date(a.completed_at).getTime() < 60_000
      ) {
        return 4000; // enrichment landing → tiers/suggestions upgrade live
      }
      if (
        a.status === "completed" &&
        a.citation_status !== "done" &&
        a.citation_status !== "failed" &&
        a.completed_at != null &&
        Date.now() - new Date(a.completed_at).getTime() < 300_000
      ) {
        return 5000; // citation/why analysis landing → tabs upgrade live
      }
      return false;
    },
  });

  const select = (id: string) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, audit: id }),
    });

  const value: WorkspaceValue = {
    audits,
    selectedId,
    select,
    audit: resultQ.data?.audit ?? null,
    polls: resultQ.data?.polls ?? [],
    loading: recentQ.isLoading || (!!selectedId && resultQ.isLoading),
    hasAnyCompleted: completed.length > 0,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="tm">
        <GlobalHeader onMenu={() => setNavOpen(true)} />
        <div className="tm-body">
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
          <div
            className={`tm-scrim ${navOpen ? "open" : ""}`}
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
          <div className="tm-main">
            <ReportHeader />
            {children}
          </div>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
