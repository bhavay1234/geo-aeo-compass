import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Workspace, useWorkspace } from "@/components/Workspace";
import { AuditGate, PartialBanner } from "@/components/terminal/AuditGate";
import {
  Favicon,
  LlmIcon,
  InfoTip,
  Icon,
  RingGauge,
  scoreBand,
  type IconName,
} from "@/components/terminal/primitives";
import type { ReactNode } from "react";
import {
  buildGapRows,
  buildLlmScorecards,
  computeShareOfVoice,
  buildCompetitorTable,
  buildDomainStats,
  llmsPolled,
  normalizeLlm,
  topGetListedTargets,
  type GapRow,
  type CompetitorRow,
  type LlmScorecard,
} from "@/components/terminal/derive";
import type {
  Audit,
  PollResult,
  LlmSource,
  CitationAnalysisEntry,
} from "@/lib/db/types";

const LLM_LABEL: Record<LlmSource, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};
const LLM_SHORT: Record<LlmSource, string> = {
  chatgpt: "GPT",
  perplexity: "PPX",
  gemini: "GEM",
};

export const Route = createFileRoute("/summary")({
  head: () => ({ meta: [{ title: "Overview · Compass" }] }),
  component: SummaryPage,
});


/** Plain section header: title (18px) + optional right-aligned text CTA. No icon. */
function SectionHead({ title, cta, to }: { title: string; cta?: string; to?: "/queries" | "/citations" | "/competitors" | "/actions" | "/analytics" }) {
  return (
    <div className="ov-sechead">
      <h2>{title}</h2>
      {cta && to && (
        <Link to={to} search={(prev) => ({ ...prev })} className="ov-cta">
          {cta} <Icon name="arrow" size={14} />
        </Link>
      )}
    </div>
  );
}

/** Per-engine coverage state: engine label + Missing/Present, aligned. */
function EngineLine({ llm, cited }: { llm: LlmSource; cited: boolean }) {
  return (
    <div className="ov-engine">
      <LlmIcon llm={llm} size={15} />
      <span className="e-name">{LLM_LABEL[llm]}</span>
      <span className={`e-state ${cited ? "on" : "off"}`}>{cited ? "Cited" : "Missing"}</span>
    </div>
  );
}

interface WorkItem {
  title: string;
  why: string;
  effect: string;
  to: "/queries" | "/citations" | "/competitors" | "/actions";
}

interface LosingRow {
  id: string;
  query: string;
  perLlm: { llm: LlmSource; cited: boolean }[];
  competitor: string | null;
  compAll: boolean;
  move: string;
}

function SummaryPage() {
  return (
    <Workspace>
      <AuditGate>
        {({ audit, polls, partial }) => (
          <>
            {partial && <PartialBanner />}
            <SummaryView audit={audit} polls={polls} />
          </>
        )}
      </AuditGate>
    </Workspace>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface ChangeItem {
  text: ReactNode;
  tone: "pos" | "warn" | "hot" | "neutral";
}

export function SummaryView({ audit, polls }: { audit: Audit; polls: PollResult[] }) {
  const { audits } = useWorkspace();
  const brand = audit.brand_name;
  const gaps = buildGapRows(audit, polls);
  const sovFull = computeShareOfVoice(audit, polls);
  const llms = llmsPolled(audit);
  const scorecards = buildLlmScorecards(audit, polls);

  // Off-page "where to get cited" rollup - the core AEO action, surfaced up top.
  const citeEntries = (audit.citation_analysis ?? []) as CitationAnalysisEntry[];
  const titleByUrl = new Map<string, string>();
  for (const p of polls)
    for (const c of p.citations ?? [])
      if (c.url && c.title && !titleByUrl.has(c.url)) titleByUrl.set(c.url, c.title);
  const getListed = topGetListedTargets(audit, citeEntries, titleByUrl, 6);
  const citationsAnalyzing =
    audit.citation_status === "analyzing" || audit.citation_status == null;
  // Per-model filter - recompute the competitor comparison for one LLM or all.
  const [model, setModel] = useState<"all" | LlmSource>("all");
  const modelPolls =
    model === "all" ? polls : polls.filter((p) => normalizeLlm(p.llm_source) === model);
  const compTableFull = buildCompetitorTable(audit, modelPolls);
  // Cap at the top 10 by visibility, but always keep the brand's own row.
  const compTable = (() => {
    const head = compTableFull.slice(0, 10);
    if (compTableFull.some((r) => r.isYou) && !head.some((r) => r.isYou)) {
      return [...head.slice(0, 9), compTableFull.find((r) => r.isYou)!];
    }
    return head;
  })();
  const { domains: domainRows, byType } = buildDomainStats(audit, citeEntries);
  const TYPE_COLORS = [
    "var(--you)",
    "var(--hot)",
    "var(--warn)",
    "var(--pos)",
    "var(--ink-3)",
    "#8b5cf6",
    "#0891b2",
    "#db2777",
  ];

  // total = distinct queries (one per gap row after per-query aggregation).
  // Per-LLM answers = queries × LLMs - the buyer-facing denominator on multi-LLM
  // audits ("invisible in N of {queries × 3} high-intent AI answers").
  const total = gaps.length;
  const absent = gaps.filter((g) => g.state === "absent").length;
  const weak = gaps.filter((g) => g.state === "weak").length;
  const held = gaps.filter((g) => g.state === "held").length;
  // Answer counts come from ACTUAL captured polls - identical to the
  // StatusBar's math, and failed polls (no row) are never counted as
  // "invisible" answers that ChatGPT/Gemini/Perplexity didn't actually give.
  const totalAnswers = polls.length;
  const absentAnswers = polls.filter((p) => !p.brand_cited).length;

  // Plain-language headline: inferred category + who leads citation share.
  const category = (audit.category ?? "").trim();
  const leader = sovFull[0] ?? null;
  const youEntry = sovFull.find((s) => s.isYou) ?? null;
  const youRank = sovFull.findIndex((s) => s.isYou) + 1; // 0 → not cited at all
  const topComps = sovFull
    .filter((s) => !s.isYou)
    .slice(0, 2)
    .map((s) => s.name);

  // Always show the brand in the SoV chart - at 0% ("not cited") if absent - so
  // the panel never collapses to a broken-looking blank for a first-time viewer.
  const hasSov = sovFull.length > 0;
  const sov = youEntry
    ? sovFull.slice(0, 5)
    : [
        ...sovFull.slice(0, 4),
        { name: brand, domain: audit.domain, count: 0, pct: 0, isYou: true },
      ];
  const sovMax = Math.max(1, ...sov.map((s) => s.pct));

  // Trajectory from prior completed runs of the same brand+domain.
  const runs = audits
    .filter(
      (a) =>
        a.status === "completed" &&
        a.brand_name === audit.brand_name &&
        a.domain === audit.domain &&
        a.visibility_score != null
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  const scores = runs.map((r) => r.visibility_score as number);
  const trendDates = runs.map((r) => r.created_at as string);
  const score = audit.visibility_score ?? 0;
  const cited = totalAnswers - absentAnswers;
  const band = scoreBand(score);
  const prevScore = scores.length >= 2 ? scores[scores.length - 2] : null;
  const priorDelta = prevScore != null ? score - prevScore : null;
  const deltaFirst = scores.length >= 2 ? score - scores[0] : null;

  // Prompt-level gap accounting (a prompt is "unwon" when not held in every engine).
  const unwonGaps = gaps.filter((g) => g.state !== "held");
  const unwon = unwonGaps.length;
  const invisibleGaps = gaps.filter((g) => g.state === "absent");
  const affectedEngines = llms.filter((l) => gaps.some((g) => g.absentLlms.includes(l)));
  const leaderName = leader && !leader.isYou ? leader.name : null;
  const leaderGapCount = leaderName ? unwonGaps.filter((g) => g.who.includes(leaderName)).length : 0;
  const highestRisk = unwonGaps[0]?.query ?? null;

  // ── "What changed": up to three concrete, evidence-led outcomes ──
  const changes: ChangeItem[] = [];
  if (priorDelta != null && priorDelta !== 0) {
    changes.push({
      tone: priorDelta > 0 ? "pos" : "hot",
      text: (
        <>
          Visibility {priorDelta > 0 ? "rose" : "fell"} <b style={{ color: "var(--ink)" }}>{priorDelta > 0 ? "+" : ""}{priorDelta} points</b> from the previous audit.
        </>
      ),
    });
  }
  const engineAbsent = llms
    .map((l) => ({ l, n: gaps.filter((g) => g.absentLlms.includes(l)).length }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n)[0];
  if (engineAbsent && changes.length < 3) {
    changes.push({
      tone: "warn",
      text: (
        <>
          <b style={{ color: "var(--ink)" }}>{LLM_LABEL[engineAbsent.l]}</b> still omits {brand} from{" "}
          <b style={{ color: "var(--ink)" }}>{engineAbsent.n}</b> category prompt{engineAbsent.n === 1 ? "" : "s"}.
        </>
      ),
    });
  }
  if (leaderName && changes.length < 3) {
    changes.push({
      tone: "neutral",
      text: (
        <>
          <b style={{ color: "var(--ink)" }}>{leaderName}</b> is recommended in{" "}
          <b style={{ color: "var(--ink)" }}>{leaderGapCount || (compTableFull.find((c) => c.name === leaderName)?.citedIn ?? 0)}</b> of {total} tracked prompts.
        </>
      ),
    });
  }

  // ── "Where you are losing": up to three highest-value unwon prompts ──
  const losing: LosingRow[] = unwonGaps.slice(0, 3).map((g) => ({
    id: g.id,
    query: g.query,
    perLlm: g.perLlm.map((c) => ({ llm: c.llm, cited: c.cited })),
    competitor: g.who[0] ?? null,
    compAll: g.state === "absent" && g.who.length > 0,
    move:
      g.state === "absent"
        ? "Build a category positioning page, then support it with a comparison page."
        : `Strengthen the ranking page so it climbs above ${g.who[0] ?? "rivals"}.`,
  }));

  // ── Recommended work: concrete assets synthesized from gap evidence ──
  const work: WorkItem[] = [];
  for (const g of unwonGaps) {
    if (work.length >= 3) break;
    const lname = g.who[0];
    const absentAll = g.absentLlms.length === llms.length;
    const target =
      getListed.find((t) =>
        polls.some((p) => p.query_text === g.query && (p.citations ?? []).some((c) => (c.url || "").includes(t.domain)))
      ) ?? getListed[work.length];
    const title = target
      ? `Earn a listing on ${target.domain} for "${g.query}"`
      : lname
        ? `Create a ${brand} vs ${lname} comparison page`
        : `Publish a category positioning page for "${g.query}"`;
    const nAbsent = g.absentLlms.length;
    const engineList = g.absentLlms.map((l) => LLM_LABEL[l]).join(" and ");
    const why = lname
      ? nAbsent === 0
        ? `${lname} is cited above ${brand} for "${g.query}" across every engine.`
        : absentAll
          ? `${lname} is recommended across all engines for "${g.query}", where ${brand} does not appear.`
          : `${lname} is recommended by ${engineList} for "${g.query}", where ${brand} is missing.`
      : nAbsent === 0
        ? `${brand} ranks below the leading answer for "${g.query}" across every engine.`
        : `${brand} is absent on ${engineList} for "${g.query}".`;
    const effect =
      nAbsent === 0
        ? `Lifts ${brand}'s ranking on one high-intent prompt.`
        : absentAll
          ? `Addresses one category gap across ${llms.length} AI engines.`
          : `Addresses ${nAbsent} engine gap${nAbsent === 1 ? "" : "s"} on one prompt.`;
    work.push({ title, why, effect, to: target ? "/citations" : "/queries" });
  }

  // ── Competitor movement: top 5, disciplined color ──
  const compTop = compTableFull.slice(0, 5);
  const compMax = Math.max(1, ...compTop.map((c) => c.visibilityPct));
  const topRivalName = compTableFull.find((c) => !c.isYou)?.name;
  const compBar = (c: CompetitorRow) =>
    c.isYou ? "var(--you)" : c.name === topRivalName ? "var(--slate)" : "var(--neutral-2)";

  // ── Citation opportunities: prefer missing high-value targets ──
  const oppRows = getListed.slice(0, 3).map((t) => ({
    domain: t.domain,
    type: t.label,
    freq: `${t.llms.length} engine${t.llms.length === 1 ? "" : "s"}`,
    missing: true,
  }));
  const sourceRows =
    oppRows.length > 0
      ? oppRows
      : domainRows.slice(0, 3).map((d) => ({ domain: d.domain, type: d.type, freq: `${d.used}% of citations`, missing: false }));
  const reviewShare = byType
    .filter((t) => /review|compar|listicle|director/i.test(t.label))
    .reduce((n, t) => n + t.pct, 0);

  const catPhrase = category || "this category";

  return (
    <div className="tm-page ov">
      {/* 2 · SCOREBOARD */}
      <div className="ov-scoreboard">
        <section className="ov-score">
          <div className="ov-score-main">
            <span className="lbl">AI Visibility</span>
            <div className="ov-score-num">
              {score}
              <span className="den">/ 100</span>
              <span className={`band ${band.label.toLowerCase()}`}>{band.label}</span>
            </div>
            <p className="ctx">Across {total} tracked prompt{total === 1 ? "" : "s"} and {llms.length} AI engine{llms.length === 1 ? "" : "s"}</p>
            {deltaFirst != null && (
              <p className="since">
                <span className={`tm-delta ${deltaFirst >= 0 ? "up" : "down"}`}>{deltaFirst >= 0 ? `+${deltaFirst}` : deltaFirst}</span> since first audit
              </p>
            )}
            <p className="expl">
              Measures how often {brand} is mentioned or recommended across tracked AI answers.
            </p>
          </div>
          <div className="ov-score-ring">
            <RingGauge value={score} size={124} thickness={11} color="var(--accent)" />
          </div>
        </section>

        <section className="ov-risk">
          <span className="lbl">Commercial risk</span>
          <p className="stmt">
            <b>{unwon}</b> high-intent prompt{unwon === 1 ? " is" : "s are"} currently unwon.
          </p>
          <ul className="ov-risk-rows">
            <li>
              <span className="dot" /> {affectedEngines.length} engine{affectedEngines.length === 1 ? "" : "s"} affected
            </li>
            {leaderName && leaderGapCount > 0 && (
              <li>
                <span className="dot" /> {leaderName} leads {leaderGapCount} of {unwon} gap{unwon === 1 ? "" : "s"}
              </li>
            )}
            {highestRisk && (
              <li>
                <span className="dot" />
                <span style={{ flexShrink: 0 }}>Highest risk:</span>
                <span style={{ flex: 1, minWidth: 0, color: "var(--ink)", fontWeight: 500 }} title={highestRisk}>
                  {highestRisk}
                </span>
              </li>
            )}
          </ul>
          <Link to="/queries" search={(prev) => ({ ...prev })} className="tm-btn tm-btn-sm" style={{ textDecoration: "none", marginTop: "auto", alignSelf: "flex-start" }}>
            View gaps
          </Link>
        </section>
      </div>

      {/* 3 · PRIMARY DIAGNOSIS */}
      {unwon > 0 && (
        <section className="ov-diag">
          <span className="tag">You are losing category visibility</span>
          <h2>
            {brand} ranks {youRank > 0 ? `#${youRank}` : "outside the top brands"} overall, but is absent from the {catPhrase} prompts where buyers compare platforms.
          </h2>
          <p>
            {topComps.length > 0 ? `${topComps.join(" and ")} are` : "Competitors are"} being recommended in those answers instead.
          </p>
          <div className="ev">
            <span><b>{unwon}</b> missed category prompt{unwon === 1 ? "" : "s"}</span>
            <span className="sep" />
            <span><b>{affectedEngines.length}</b> engine{affectedEngines.length === 1 ? "" : "s"} affected</span>
            {topComps.length > 0 && (
              <>
                <span className="sep" />
                <span><b>{topComps.length}</b> competitor{topComps.length === 1 ? "" : "s"} consistently ahead</span>
              </>
            )}
            <Link to="/queries" search={(prev) => ({ ...prev })} className="ov-cta" style={{ marginLeft: "auto" }}>
              Inspect prompt evidence <Icon name="arrow" size={14} />
            </Link>
          </div>
        </section>
      )}

      {/* 4 · WHERE YOU ARE LOSING */}
      {losing.length > 0 && (
        <section>
          <SectionHead title="Where you are losing AI recommendations" cta={`View all ${unwon} gaps`} to="/queries" />
          <div className="ov-losing">
            {losing.map((r) => (
              <div className="ov-loserow" key={r.id}>
                <div className="ov-lose-prompt">
                  <Link to="/queries" search={(prev) => ({ ...prev })} className="q">{r.query}</Link>
                  <span className="cmp">
                    {r.competitor
                      ? `${r.competitor} ${r.compAll ? `appears in all ${r.perLlm.length} answers` : "is recommended above you"}`
                      : "No brand consistently wins this prompt"}
                  </span>
                </div>
                <div className="ov-lose-engines">
                  {r.perLlm.map((c) => (
                    <EngineLine key={c.llm} llm={c.llm} cited={c.cited} />
                  ))}
                </div>
                <div className="ov-lose-move">
                  <span className="k">Next move</span>
                  <p>{r.move}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5 · MOMENTUM */}
      <div className="ov-momentum">
        <section className="ov-surface ov-before-after">
          <SectionHead title="Visibility momentum" />
          {prevScore != null ? (
            <>
              <div className="ba">
                <div className="ba-col">
                  <span className="k">Previous audit</span>
                  <span className="v prev">{prevScore}</span>
                </div>
                <Icon name="arrow" size={22} />
                <div className="ba-col">
                  <span className="k">Current audit</span>
                  <span className="v cur">{score}</span>
                </div>
                <div className="ba-delta">
                  <span className={`tm-delta ${priorDelta! >= 0 ? "up" : "down"}`} style={{ fontSize: 20 }}>
                    {priorDelta! >= 0 ? `+${priorDelta}` : priorDelta}
                  </span>
                  <span className="k">change</span>
                </div>
              </div>
              <p className="note">
                {runs.length} audit{runs.length === 1 ? "" : "s"} recorded
                {deltaFirst != null && <>, {deltaFirst >= 0 ? "+" : ""}{deltaFirst} since the first</>}.
              </p>
            </>
          ) : (
            <p className="note" style={{ marginTop: 12 }}>
              Re-run this audit to compare visibility against a previous run.
            </p>
          )}
        </section>

        <section className="ov-surface">
          <SectionHead title="What changed" />
          <div className="ov-changes">
            {changes.length === 0 ? (
              <p className="note">No prior audit to compare against yet.</p>
            ) : (
              changes.map((it, i) => {
                const color = it.tone === "pos" ? "var(--pos)" : it.tone === "hot" ? "var(--hot)" : it.tone === "warn" ? "var(--warn)" : "var(--neutral)";
                return (
                  <div className="ov-change" key={i}>
                    <span className="dot" style={{ background: color }} />
                    <p>{it.text}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* 6 · RECOMMENDED WORK */}
      {work.length > 0 && (
        <section>
          <SectionHead title="Recommended work" cta="Action center" to="/actions" />
          <div className="ov-work">
            {work.map((w, i) => (
              <div className="ov-workrow" key={i}>
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <div className="body">
                  <div className="title">{w.title}</div>
                  <p className="why">{w.why}</p>
                  <p className="eff">{w.effect}</p>
                </div>
                <div className="meta">
                  <span className="status">Not started</span>
                  <Link to={w.to} search={(prev) => ({ ...prev })} className="ov-cta">
                    View evidence <Icon name="arrow" size={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7 · BOTTOM PREVIEWS */}
      <div className="tm-row c2">
        <section className="ov-surface">
          <SectionHead title="Competitor movement" cta="Full analysis" to="/competitors" />
          {compTop.length === 0 ? (
            <p className="note">No competitors detected yet.</p>
          ) : (
            <>
              <div className="tm-hbars" style={{ marginTop: 4 }}>
                {compTop.map((c) => (
                  <div className="tm-hbar" key={c.name}>
                    <span className={`nm ${c.isYou ? "you" : ""}`}>
                      <Favicon domain={c.domain} size={16} />
                      {c.name}
                    </span>
                    <span className="track">
                      <span className="fill" style={{ width: `${Math.max(3, (c.visibilityPct / compMax) * 100)}%`, background: compBar(c) }} />
                    </span>
                    <span className="val">{c.visibilityPct}%</span>
                  </div>
                ))}
              </div>
              <p className="ov-insight">
                {youRank === 1
                  ? `${brand} leads the category on share of recommendations.`
                  : leaderName
                    ? `${brand} is ${youRank > 0 ? ordinal(youRank) : "unranked"} overall, but ${leaderName} controls the highest-value category prompt.`
                    : `${brand} is not yet cited in this run.`}
              </p>
            </>
          )}
        </section>

        <section className="ov-surface">
          <SectionHead title="Citation opportunities" cta="Explore" to="/citations" />
          {sourceRows.length === 0 ? (
            <p className="note">{citationsAnalyzing ? "Analyzing cited sources…" : "No cited sources found yet."}</p>
          ) : (
            <>
              <div className="ov-sources">
                {sourceRows.map((s) => (
                  <div className="ov-source" key={s.domain}>
                    <Favicon domain={s.domain} size={18} />
                    <div className="d">
                      <div className="dn">{s.domain}</div>
                      <div className="dt">{s.type}</div>
                    </div>
                    <span className="fr">{s.freq}</span>
                    <span className={`tgt ${s.missing ? "miss" : "have"}`}>{s.missing ? "Missing" : "Present"}</span>
                  </div>
                ))}
              </div>
              <p className="ov-insight">
                {reviewShare > 0
                  ? `Review and comparison pages influence ${reviewShare}% of tracked AI recommendations.`
                  : `${citeEntries.length} third-party sources shape the answers in this run.`}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );

}
