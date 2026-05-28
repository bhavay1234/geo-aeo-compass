import { createContext, useContext } from "react";
import type { Audit, PollResult } from "@/lib/db/types";

export interface WorkspaceValue {
  audits: Audit[];
  selectedId: string | null;
  select: (id: string) => void;
  audit: Audit | null;
  polls: PollResult[];
  loading: boolean;
  hasAnyCompleted: boolean;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used within <Workspace>");
  return v;
}
