import { createContext, useContext, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getRecentAudits, getAuditResult } from "@/lib/client/api";
import type { Audit, PollResult } from "@/lib/db/types";
import { DashboardShell } from "./DashboardShell";
import { AuditSelector } from "./AuditSelector";

interface WorkspaceValue {
  audits: Audit[];
  selectedId: string | null;
  audit: Audit | null;
  polls: PollResult[];
  loading: boolean;
  hasAnyCompleted: boolean;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used within <Workspace>");
  return v;
}

/**
 * Shared shell for the audit "workspace" pages (queries, competitors,
 * actions, analytics, settings). Owns the global audit selector and fetches
 * the selected audit's full result ONCE — child pages read it via
 * useWorkspace(). Selected audit_id lives in the URL as ?audit=<id> so the
 * view is shareable/refreshable. Default = most recent completed audit.
 */
export function Workspace({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { audit?: string };

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
  });

  const onSelect = (id: string) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, audit: id }),
    });

  const value: WorkspaceValue = {
    audits,
    selectedId,
    audit: resultQ.data?.audit ?? null,
    polls: resultQ.data?.polls ?? [],
    loading: recentQ.isLoading || (!!selectedId && resultQ.isLoading),
    hasAnyCompleted: completed.length > 0,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      <DashboardShell
        title={title}
        headerRight={
          <AuditSelector
            audits={audits}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        }
      >
        {children}
      </DashboardShell>
    </WorkspaceContext.Provider>
  );
}
