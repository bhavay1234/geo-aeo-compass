import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Search,
  BarChart3,
  Users,
  Settings,
  Sparkles,
  Zap,
  Plus,
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
              // Preserve the selected audit (?audit=) across sidebar navigation.
              search={(prev) => prev}
              activeProps={{
                className: "bg-sidebar-accent text-sidebar-accent-foreground",
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
        <Link
          to="/"
          className="flex items-center justify-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2.5 text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/80"
        >
          <Plus className="h-4 w-4" />
          New Audit
        </Link>
      </div>
    </aside>
  );
}
