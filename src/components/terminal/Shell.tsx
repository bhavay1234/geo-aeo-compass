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

function statusDot(audit: Audit | null): { color: string; label: string } {
  if (!audit) return { color: "var(--ink-3)", label: "No audit" };
  if (audit.status === "completed") return { color: "var(--pos)", label: "Completed" };
  if (audit.status === "failed") return { color: "var(--neg)", label: "Failed" };
  return { color: "var(--warn)", label: "Running" };
}

/** Grouped left-rail navigation: brand · target · sections · footer. */
export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const { audits, select, audit, polls } = useWorkspace();
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const path = loc.pathname;

  const score = audit?.visibility_score ?? null;
  const dot = statusDot(audit);

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
      <div className="tm-side-brand">
        <span className="mk">
          <Icon name="spark" size={15} strokeWidth={2} />
        </span>
        Compass
      </div>

      <div className="tm-side-target">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="tgt" aria-label="Select audit target">
              <span className="l">Target</span>
              <span className="v">
                {audit && <Favicon domain={audit.domain} size={15} />}
                <span className="nm">{audit ? audit.brand_name : "Select an audit"}</span>
                {score != null && <span className="sc num">{score}</span>}
              </span>
              {audit && (
                <span className="dm">
                  <span className="tm-dot" style={{ background: dot.color }} title={dot.label} />
                  {audit.domain}
                </span>
              )}
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
        {NAV_GROUPS.map((g) => (
          <div key={g.section}>
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
                  <span className="gl">
                    <Icon name={t.icon} size={17} />
                  </span>
                  {t.label}
                  {ct ? <span className="ct">{ct}</span> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="tm-side-foot">
        <Link to="/" className="tm-newaudit" aria-label="Start a new audit">
          <Icon name="plus" size={15} strokeWidth={2.2} /> New audit
        </Link>
        <button className="tm-toggle" onClick={toggle} aria-label="Toggle color theme">
          <Icon name={theme === "dark" ? "moon" : "sun"} size={15} />
          <span className="tgl-lbl">{theme === "dark" ? "Dark" : "Light"} theme</span>
          <span className="tm-sw" />
        </button>
      </div>
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
export function ReportHeader({ onMenu }: { onMenu?: () => void }) {
  const { audit } = useWorkspace();
  const loc = useLocation();
  const title = PAGE_TITLE[loc.pathname] ?? "Overview";
  const crumb = CRUMB[loc.pathname] ?? "Overview";
  const llms = audit ? llmsPolled(audit) : [];
  const live = liveText(audit);
  const running = audit && audit.status !== "completed" && audit.status !== "failed";

  return (
    <header className="tm-rphead">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onMenu && (
          <button className="tm-burger" onClick={onMenu} aria-label="Open navigation">
            <Icon name="menu" size={17} />
          </button>
        )}
        <nav className="tm-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 0 }}>
          Compass <span aria-hidden>/</span> AI visibility <span aria-hidden>/</span> <b>{crumb}</b>
        </nav>
        <div className="tm-spacer" />
        <button
          type="button"
          className="tm-btn tm-btn-ghost tm-btn-sm"
          onClick={() => window.print()}
          title="Export this report as a PDF via print"
        >
          <Icon name="download" size={14} /> Export
        </button>
      </div>

      <div className="trow" style={{ marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {audit && (
            <div className="meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 550, color: "var(--ink)" }}>
                <Favicon domain={audit.domain} size={15} />
                {audit.brand_name}
              </span>
              <span className="dmn">{audit.domain}</span>
              {live && (
                <span className="tm-live">
                  {running && <span className="tm-blip" />}
                  {live}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="acts" style={{ alignSelf: "flex-end" }}>
          <div className="tm-chiprow" aria-label="Tracked AI engines">
            {llms.map((l) => (
              <span className="tm-echip" key={l}>
                <LlmIcon llm={l} size={13} />
                {LLM_NAME[l]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
