import { Link, useLocation } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "./workspace-context";
import { useTheme } from "./useTheme";
import { allCompetitorBrands } from "./derive";
import type { Audit } from "@/lib/db/types";

const TABS = [
  { key: "summary", label: "Summary", glyph: "◧", to: "/summary" as const },
  { key: "queries", label: "Queries", glyph: "⌕", to: "/queries" as const },
  { key: "competitors", label: "Competitors", glyph: "⚇", to: "/competitors" as const },
  { key: "actions", label: "Actionables", glyph: "⚡", to: "/actions" as const },
  { key: "analytics", label: "Analytics", glyph: "▤", to: "/analytics" as const },
];

function liveText(audit: Audit | null): string {
  if (!audit) return "ChatGPT · web search";
  if (audit.status === "running" || audit.status === "pending")
    return "ChatGPT · web search · running";
  if (audit.status === "finalizing") return "ChatGPT · web search · scoring";
  if (audit.completed_at)
    return `ChatGPT · web search · ${formatDistanceToNow(new Date(audit.completed_at), { addSuffix: true })}`;
  return "ChatGPT · web search";
}

export function StatusBar() {
  const { audits, select, audit, polls } = useWorkspace();
  const { theme, toggle } = useTheme();

  const score = audit?.visibility_score ?? null;
  const total = polls.length;
  const cited = polls.filter((p) => p.brand_cited).length;
  const blind = polls.filter((p) => !p.brand_cited).length;

  let delta: number | null = null;
  if (audit && score != null) {
    const prior = audits
      .filter(
        (a) =>
          a.status === "completed" &&
          a.id !== audit.id &&
          a.brand_name === audit.brand_name &&
          a.domain === audit.domain &&
          a.visibility_score != null
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
    if (prior?.visibility_score != null) delta = score - prior.visibility_score;
  }

  return (
    <div className="tm-statusbar">
      <div className="tm-brand">
        <span className="mk">✦</span> COMPASS
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="tm-cell sel" aria-label="Select audit">
            <span className="l">Target ▾</span>
            <span className="v">{audit ? audit.brand_name.toUpperCase() : "—"}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[320px]">
          <DropdownMenuLabel>Audits</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {audits.length === 0 ? (
            <DropdownMenuItem disabled>No audits yet</DropdownMenuItem>
          ) : (
            audits.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => select(a.id)}
                className="flex-col items-start gap-0.5"
              >
                <span className="font-medium">{a.brand_name}</span>
                <span className="text-xs opacity-60">
                  {a.domain} · {a.status}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="tm-cell">
        <span className="l">Visibility</span>
        <span className="v">{score ?? "—"}</span>
      </div>
      <div className="tm-cell">
        <span className="l">Δ vs prior</span>
        <span className={`v ${delta != null ? (delta >= 0 ? "pos" : "neg") : ""}`}>
          {delta == null ? "—" : delta >= 0 ? `+${delta}` : `${delta}`}
        </span>
      </div>
      <div className="tm-cell">
        <span className="l">Cited</span>
        <span className="v">{total ? `${cited}/${total}` : "—"}</span>
      </div>
      <div className="tm-cell">
        <span className="l">Blind spots</span>
        <span className={`v ${blind > 0 ? "hot" : ""}`}>{total ? blind : "—"}</span>
      </div>

      <div className="tm-spacer" />
      <div className="tm-live">
        <span className="tm-blip" />
        {liveText(audit)}
      </div>
      <Link
        to="/"
        className="tm-toggle"
        style={{ borderRight: "1px solid var(--grid)", textDecoration: "none" }}
        aria-label="Start a new audit"
      >
        <span>+ NEW AUDIT</span>
      </Link>
      <button className="tm-toggle" onClick={toggle} aria-label="Toggle theme">
        <span>{theme === "dark" ? "LIGHT" : "DARK"}</span>
        <span className="tm-sw" />
      </button>
    </div>
  );
}

export function TabNav() {
  const { polls, audit } = useWorkspace();
  const loc = useLocation();
  const path = loc.pathname;

  const counts: Record<string, number> = {
    queries: polls.length,
    competitors: audit ? allCompetitorBrands(audit, polls).length : 0,
    actions: polls.filter(
      (p) => p.suggestion && p.suggestion.situation !== "winning"
    ).length,
  };

  return (
    <nav className="tm-tabs" aria-label="Sections">
      {TABS.map((t) => {
        const on = path === t.to;
        const ct = counts[t.key];
        return (
          <Link
            key={t.key}
            to={t.to}
            search={(prev) => ({ ...prev })}
            className={`tm-tab ${on ? "on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <span aria-hidden>{t.glyph}</span> {t.label}
            {ct ? <span className="ct">{ct}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
