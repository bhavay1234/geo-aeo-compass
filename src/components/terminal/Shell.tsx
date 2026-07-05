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
import { Icon, LlmIcon, Favicon, type IconName } from "./primitives";
import type { Audit, LlmSource } from "@/lib/db/types";

type TabPath = "/summary" | "/queries" | "/citations" | "/competitors" | "/actions" | "/analytics";
interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  to: TabPath;
}
/** Existing routes mapped into intelligence-platform groups. */
const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ key: "summary", label: "Overview", icon: "overview", to: "/summary" }],
  },
  {
    section: "Discover",
    items: [
      { key: "queries", label: "Queries", icon: "queries", to: "/queries" },
      { key: "citations", label: "Citations", icon: "citations", to: "/citations" },
    ],
  },
  {
    section: "Competitive intelligence",
    items: [{ key: "competitors", label: "Competitors", icon: "competitors", to: "/competitors" }],
  },
  {
    section: "Optimize",
    items: [{ key: "actions", label: "Action center", icon: "actions", to: "/actions" }],
  },
  {
    section: "Reporting",
    items: [{ key: "analytics", label: "Analytics", icon: "analytics", to: "/analytics" }],
  },
];

const PAGE_TITLE: Record<string, string> = {
  "/summary": "AI Visibility Overview",
  "/queries": "Queries",
  "/citations": "Citations",
  "/competitors": "Competitors",
  "/actions": "Action center",
  "/analytics": "Analytics",
};
const CRUMB: Record<string, string> = {
  "/summary": "Overview",
  "/queries": "Queries",
  "/citations": "Citations",
  "/competitors": "Competitors",
  "/actions": "Action center",
  "/analytics": "Analytics",
};

const LLM_NAME: Record<LlmSource, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

/** Global top bar: plain wordmark, target selector, minimal right controls. */
export function GlobalHeader({ onMenu }: { onMenu?: () => void }) {
  const { audits, select, audit } = useWorkspace();
  const { theme, toggle } = useTheme();
  const score = audit?.visibility_score ?? null;

  return (
    <header className="tm-ghead">
      {onMenu && (
        <button className="tm-burger" onClick={onMenu} aria-label="Open navigation">
          <Icon name="menu" size={17} />
        </button>
      )}
      <span className="tm-wm">Compass</span>
      <span className="tm-ghead-sep" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="tm-tgt2" aria-label="Select audit target">
            {audit && <Favicon domain={audit.domain} size={14} />}
            <span className="nm">{audit ? audit.brand_name : "Select audit"}</span>
            {score != null && <span className="sc num">{score}</span>}
            <svg className="cv" width="9" height="9" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px]">
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
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/">New audit</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="tm-spacer" />
      <button
        className="tm-ghead-ico"
        onClick={toggle}
        aria-label="Toggle color theme"
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      >
        <Icon name={theme === "dark" ? "moon" : "sun"} size={15} />
      </button>
    </header>
  );
}

/** Plain left navigation: group labels + text rows, no chrome. */
export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const { audit, polls } = useWorkspace();
  const loc = useLocation();
  const path = loc.pathname;

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
    <aside className={`tm-side ${open ? "open" : ""}`}>
      <nav className="tm-side-nav" aria-label="Sections">
        {NAV_GROUPS.map((g) => (
          <div key={g.section} className="tm-navgroup">
            <div className="sec">{g.section}</div>
            {g.items.map((t) => {
              const on = path === t.to;
              const ct = counts[t.key];
              return (
                <Link
                  key={t.key}
                  to={t.to}
                  search={(prev) => ({ ...prev })}
                  className={`tm-navitem ${on ? "on" : ""}`}
                  aria-current={on ? "page" : undefined}
                  onClick={onClose}
                >
                  {t.label}
                  {ct ? <span className="ct num">{ct}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function liveText(audit: Audit | null): string | null {
  if (!audit) return null;
  if (audit.status === "running" || audit.status === "pending") return "Audit running";
  if (audit.status === "finalizing") return "Scoring";
  if (audit.completed_at)
    return `Updated ${formatDistanceToNow(new Date(audit.completed_at), { addSuffix: true })}`;
  return null;
}

/** Enterprise report header: breadcrumb · title · target meta · engines · actions. */
export function ReportHeader() {
  const { audit, polls } = useWorkspace();
  const loc = useLocation();
  const crumb = CRUMB[loc.pathname] ?? "Overview";
  const title = PAGE_TITLE[loc.pathname] ?? "Overview";
  const llms = audit ? llmsPolled(audit) : [];
  const promptCount = groupPollsByQuery(polls).size;
  const live = liveText(audit);
  const running = audit && audit.status !== "completed" && audit.status !== "failed";

  return (
    <header className="tm-rphead">
      <div className="trow">
        <div style={{ minWidth: 0 }}>
          <nav className="tm-crumbs" aria-label="Breadcrumb">
            AI visibility <span aria-hidden>/</span> <b>{crumb}</b>
          </nav>
          <h1>{title}</h1>
          {audit && (
            <div className="meta">
              <span className="dmn">{audit.domain}</span>
              {live && (
                <>
                  <span className="sep" aria-hidden />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {running && <span className="tm-blip" />}
                    {live}
                  </span>
                </>
              )}
              {promptCount > 0 && (
                <>
                  <span className="sep" aria-hidden />
                  <span>{promptCount} prompt{promptCount === 1 ? "" : "s"}</span>
                </>
              )}
              {llms.length > 0 && (
                <>
                  <span className="sep" aria-hidden />
                  <span>{llms.length} AI engine{llms.length === 1 ? "" : "s"}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="acts">
          {llms.length > 0 && (
            <div className="tm-chiprow" aria-label="Tracked AI engines">
              {llms.map((l) => (
                <span className="tm-echip" key={l}>
                  <LlmIcon llm={l} size={13} />
                  {LLM_NAME[l]}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="tm-btn tm-btn-ghost tm-btn-sm"
            onClick={() => window.print()}
            title="Export this report as a PDF via print"
          >
            <Icon name="download" size={14} /> Export
          </button>
        </div>
      </div>
    </header>
  );
}
