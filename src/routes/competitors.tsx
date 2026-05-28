import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import { SourceTag } from "@/components/terminal/primitives";
import {
  buildCompetitorProfiles,
  type CompetitorProfile,
} from "@/components/terminal/derive";
import type { Audit, PollResult } from "@/lib/db/types";

export const Route = createFileRoute("/competitors")({
  head: () => ({ meta: [{ title: "Competitors — Compass" }] }),
  component: CompetitorsPage,
});

function CompetitorsPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <CompetitorsView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

const TIER_CLASS: Record<1 | 2 | 3, string> = {
  1: "tm-t1",
  2: "tm-t2",
  3: "tm-t3",
};

function CompetitorsView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const profiles = buildCompetitorProfiles(audit, polls);
  const sovMax = Math.max(1, ...profiles.map((p) => p.sovPct));

  return (
    <div>
      <div className="tm-toolbar">
        <span className="tm-sort mono" style={{ paddingLeft: 16 }}>
          {profiles.length} brands · sorted by share of voice
        </span>
      </div>
      <div className="tm-rows">
        {profiles.map((p, i) => (
          <ProfileCard key={p.name} p={p} rank={i} sovMax={sovMax} />
        ))}
      </div>
    </div>
  );
}

function ProfileCard({
  p,
  rank,
  sovMax,
}: {
  p: CompetitorProfile;
  rank: number;
  sovMax: number;
}) {
  return (
    <div
      className={`tm-card tm-reveal ${p.isYou ? "tm-you-edge tm-you-wash" : ""}`}
      style={{ animationDelay: `${Math.min(rank, 8) * 0.03}s` }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="tm-mark">
          {p.isYou ? "★" : String(rank + 1).padStart(2, "0")}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: "-.01em",
              color: p.isYou ? "var(--you)" : "var(--ink)",
            }}
          >
            {p.name}
            {p.isYou && (
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--you)", marginLeft: 8 }}
              >
                YOU
              </span>
            )}
          </div>
          {p.domain && (
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {p.domain}
            </div>
          )}
        </div>
        {p.discovered && (
          <span
            className="tm-tier tm-t2"
            title="Surfaced by ChatGPT, not on your tracked list — re-run with it named to track it"
          >
            Discovered
          </span>
        )}
        <span className={`tm-tier ${TIER_CLASS[p.tier]}`}>T{p.tier}</span>
        <span
          className="mono"
          style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", width: 48, textAlign: "right" }}
        >
          {p.sovPct}%
        </span>
      </div>

      {/* SoV bar */}
      <div
        style={{
          marginTop: 10,
          height: 6,
          background: "var(--grid)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(p.sovPct / sovMax) * 100}%`,
            background: p.isYou ? "var(--you)" : "var(--ink-3)",
          }}
        />
      </div>

      {/* Verdict — the headline unit */}
      <div style={{ marginTop: 14 }}>
        <div className="tm-label">How ChatGPT describes them</div>
        {p.verdict ? (
          <p className="tm-verdict">“{p.verdict}”</p>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
            No verdict yet — scoring.
          </p>
        )}
      </div>

      {/* Strengths */}
      {p.strengths.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="tm-label">Cited on</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {p.strengths.map((s, i) => (
              <span className="tm-chip" key={i}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {p.sources.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="tm-label">Cited sources</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {p.sources.map((s) => (
              <span
                key={s.domain}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {s.domain}
                </span>
                <SourceTag kind={s.kind} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Beats you on */}
      {!p.isYou && p.beatsYou.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="tm-label" style={{ color: "var(--hot)" }}>
            Beats you on
          </div>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {p.beatsYou.map((q, i) => (
              <li key={i} style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                <Link
                  to="/queries"
                  search={(prev) => ({ ...prev })}
                  style={{ color: "var(--ink-2)", textDecoration: "none" }}
                >
                  · {q}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
