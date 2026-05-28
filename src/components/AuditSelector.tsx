import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuditStatusBadge } from "@/components/AuditStatusBadge";
import { ChevronDown } from "lucide-react";
import type { Audit } from "@/lib/db/types";

function label(a: Audit): string {
  const rel = a.created_at
    ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true })
    : "";
  return `${a.brand_name} · ${a.domain}${rel ? ` · ${rel}` : ""}`;
}

export function AuditSelector({
  audits,
  selectedId,
  onSelect,
}: {
  audits: Audit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = audits.find((a) => a.id === selectedId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex max-w-[420px] items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted">
        <span className="truncate text-card-foreground">
          {selected ? label(selected) : "No audit selected"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px]">
        <DropdownMenuLabel>Recent audits</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {audits.length === 0 ? (
          <DropdownMenuItem disabled>No audits yet</DropdownMenuItem>
        ) : (
          audits.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onClick={() => onSelect(a.id)}
              className="flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-card-foreground">
                  {a.brand_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.domain}
                  {a.created_at
                    ? ` · ${formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}`
                    : ""}
                </p>
              </div>
              <AuditStatusBadge status={a.status} />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
