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
import { allCompetitorBrands, groupPollsByQuery, llmsPolled } from "./derive";
import { Icon, type IconName } from "./primitives";
import type { Audit } from "@/lib/db/types";

const TABS: { key: string; label: string; icon: IconName; to: "/summary" | "/queries" | "/citations" | "/competitors" | "/actions" | "/analytics" }[] = [
  { key: "summary", label: "Overview", icon: "overview", to: "/summary" },
  { key: "queries", label: "Queries", icon: "queries", to: "/queries" },
  { key: "citations", label: "Citations", icon: "citations", to: "/citations" },
  { key: "competitors", label: "Competitors", icon: "competitors", to: "/competitors" },
  { key: "actions", label: "Actionables", icon: "actions", to: "/actions" },
  { key: "analytics", label: "Analytics", icon: "analytics", to: "/analytics" },
];

const PAGE_TITLE: Record<string, string> = {
  "/summary": "Overview",
  "/queries": "Queries",
  "/citations": "Citations",
  "/competitors": "Competitors",
  "/actions": "Actionables",
  "/analytics": "Analytics",
};

function liveText(audit: Audit | null): string {
  const engines =
    audit && llmsPolled(audit).length > 1
      ? `${llmsPolled(audit).length} LLMs · web search`
      : "ChatGPT · web search";
  if (!audit) return engines;
  if (audit.status === "running" || audit.status === "pending")
    return `${engines} · running`;
  if (audit.status === "finalizing") return `${engines} · scoring`;
  if (audit.completed_at)
    return `updated ${formatDistanceToNow(new Date(audit.completed_at), { addSuffix: true })}`;
  return engines;
}

/** Vertical left-rail navigation: brand · target selector · sections · footer. */
export function Sidebar() {
  const { audits, select, audit, polls } = useWorkspace();
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const path = loc.pathname;

  const score = audit?.visibility_score ?? null;

  const queryCount = groupPollsByQuery(polls).size;
  const actionQueries = new Set(
    polls
      .filter((p) => p.suggestion && p.suggestion.situation !== "winning")
      .map((p) => p.query_text)
  ).size;
  const counts: Record<string, number> = {
    queries: queryCount,
    citations: audit?.citation_analysis?.length ?? 0,
    competitors: audit ? allCompetitorBrands(audit, polls).length : 0,
    actions: actionQueries,
  };

  return (
    <aside className="tm-side">
      <div className="tm-side-brand">
        <span className="mk">✦</span> Compass
      </div>

      <div className="tm-side-target">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="tgt" aria-label="Select audit">
              <span className="l">Target</span>
              <span className="v">
                {audit ? audit.brand_name : "-"}
                {score != null && <span className="sc">{score}</span>}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[300px]">
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
      </div>

      <nav className="tm-side-nav" aria-label="Sections">
        <div className="sec">Report</div>
        {TABS.map((t) => {
          const on = path === t.to;
          const ct = counts[t.key];
          return (
            <Link
              key={t.key}
              to={t.to}
              search={(prev) => ({ ...prev })}
              className={`tm-navitem ${on ? "on" : ""}`}
              aria-current={on ? "page" : undefined}
            >
              <span className="gl">
                <Icon name={t.icon} size={18} />
              </span>
              {t.label}
              {ct ? <span className="ct">{ct}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="tm-side-foot">
        <Link to="/" className="tm-newaudit" aria-label="Start a new audit">
          <Icon name="plus" size={16} strokeWidth={2.4} /> New audit
        </Link>
        <button className="tm-toggle" onClick={toggle} aria-label="Toggle theme">
          <Icon name={theme === "dark" ? "moon" : "sun"} size={15} />
          <span className="tgl-lbl">{theme === "dark" ? "Dark" : "Light"} theme</span>
          <span className="tm-sw" />
        </button>
      </div>
    </aside>
  );
}

/** Slim sticky header inside the main column: page title · metrics · live. */
export function TopBar() {
  const { audits, audit, polls } = useWorkspace();
  const loc = useLocation();
  const title = PAGE_TITLE[loc.pathname] ?? "Overview";

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
    <header className="tm-topbar">
      <span className="pg">{title}</span>
      <div className="tm-spacer" />

      {score != null && (
        <div className="tm-metric" title="Overall visibility score">
          <span className="l">Visibility</span>
          <span className="v">{score}</span>
        </div>
      )}
      {delta != null && (
        <div className="tm-metric" title="Change vs your prior audit">
          <span className="l">Δ prior</span>
          <span className={`v ${delta >= 0 ? "pos" : "neg"}`}>
            {delta >= 0 ? `+${delta}` : `${delta}`}
          </span>
        </div>
      )}
      {total > 0 && (
        <div className="tm-metric" title="AI answers citing your brand (one per query per LLM)">
          <span className="l">Cited</span>
          <span className="v">
            {cited}/{total}
          </span>
        </div>
      )}
      {total > 0 && (
        <div className="tm-metric" title="AI answers where your brand does not appear">
          <span className="l">Blind</span>
          <span className={`v ${blind > 0 ? "hot" : ""}`}>{blind}</span>
        </div>
      )}

      <div className="tm-live">
        <span className="tm-blip" />
        {liveText(audit)}
      </div>
    </header>
  );
}
