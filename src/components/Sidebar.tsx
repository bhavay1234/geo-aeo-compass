import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Search,
  BarChart3,
  Users,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/" },
  { icon: Search, label: "Queries", to: "/queries" },
  { icon: BarChart3, label: "Analytics", to: "/analytics" },
  { icon: Users, label: "Competitors", to: "/competitors" },
  { icon: Zap, label: "Actions", to: "/actions" },
  { icon: Settings, label: "Settings", to: "/settings" },
];

export function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
          AEO/GEO
        </span>
      </div>

      <nav className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{
                className:
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              inactiveProps={{
                className:
                  "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-lg bg-sidebar-accent p-3">
          <p className="text-xs font-medium text-sidebar-accent-foreground/80">
            Free Plan
          </p>
          <p className="mt-1 text-xs text-sidebar-accent-foreground/60">
            47 / 100 queries tracked
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border">
            <div className="h-full w-[47%] rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </aside>
  );
}
