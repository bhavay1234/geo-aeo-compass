import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  changeType: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  description?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  description,
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-card/80">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-card-foreground">
            {value}
          </p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            changeType === "positive" && "bg-success/10 text-success",
            changeType === "negative" && "bg-destructive/10 text-destructive",
            changeType === "neutral" && "bg-muted text-muted-foreground"
          )}
        >
          {change}
        </span>
        <span className="text-xs text-muted-foreground">vs last month</span>
      </div>
    </div>
  );
}
