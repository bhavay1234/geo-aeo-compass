import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AuditStatus } from "@/lib/db/types";
import { CheckCircle2, Loader2, XCircle, Clock } from "lucide-react";

const CONFIG: Record<
  AuditStatus,
  { label: string; className: string; icon: typeof CheckCircle2; spin?: boolean }
> = {
  pending: {
    label: "Pending",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    icon: Clock,
  },
  running: {
    label: "Running",
    className: "border-primary/30 bg-primary/10 text-primary",
    icon: Loader2,
    spin: true,
  },
  finalizing: {
    label: "Scoring",
    className: "border-primary/30 bg-primary/10 text-primary",
    icon: Loader2,
    spin: true,
  },
  completed: {
    label: "Completed",
    className: "border-success/30 bg-success/10 text-success",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
};

export function AuditStatusBadge({ status }: { status: AuditStatus }) {
  const c = CONFIG[status] ?? CONFIG.pending;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", c.className)}>
      <Icon className={cn("h-3 w-3", c.spin && "animate-spin")} />
      {c.label}
    </Badge>
  );
}
