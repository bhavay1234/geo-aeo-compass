import type { Audit, PollResult, Citation, DecisiveFactor } from "@/lib/db/types";
import { normalizeDomain, competitorToDomain } from "@/lib/audit/source-classifier";

export type QueryState = "absent" | "weak" | "held";

/** Per-query state: absent (not cited), weak (cited but rank > 2), held (rank ≤ 2). */
export function queryState(p: Pick<PollResult, "brand_cited" | "brand_position">): QueryState {
  if (!p.brand_cited) return "absent";
  if ((p.brand_position ?? 99) > 2) return "weak";
  return "held";
}

export type SourceTagKind = "you" | "comp" | "agg" | "ed";

/** Tag a citation Comp/Agg/Ed/You, preferring the per-query LLM role judgment. */
export function tagSource(
  c: Citation,
  ownDomain: string,
  namedNorm: Set<string>,
  competitorJudged: Set<string>
): { kind: SourceTagKind; subtype: string } {
  const d = normalizeDomain(c.domain);
  const own = normalizeDomain(ownDomain);
  if (own && (d === own || d.endsWith("." + own))) return { kind: "you", subtype: "your site" };
  if (
    namedNorm.has(d) ||
    competitorJudged.has(d) ||
    c.source_type === "competitor"
  )
    return { kind: "comp", subtype: "vendor" };
  if (c.source_type === "review_directory") return { kind: "agg", subtype: "review dir" };
  if (c.source_type === "analyst") return { kind: "agg", subtype: "analyst" };
  if (c.source_type === "editorial") return { kind: "ed", subtype: "editorial" };
  return { kind: "agg", subtype: "source" };
}

/**
 * Same-industry competitor domains cited in ONE answer, decided by the
 * per-query LLM role judgment (citation_roles) plus the discovered_in_query
 * competitor label — NOT a static vendor-domain guess. Returns normalized
 * domains.
 */
export function competitorDomainsInPoll(p: PollResult): Set<string> {
  const out = new Set<string>();
  for (const r of p.citation_roles ?? []) {
    if (r.role !== "competitor") continue;
    const d = normalizeDomain(r.domain);
    if (d) out.add(d);
  }
  for (const d of p.discovered_in_query ?? []) {
    if (d.label !== "competitor") continue;
    const nd = normalizeDomain(d.domain);
    if (nd) out.add(nd);
  }
  return out;
}

/**
 * Competitor brands ChatGPT NAMED in ONE answer's prose (excl. the audited
 * brand). The real competitor signal: union of tracked-list prose matches
 * (competitors_cited) + the LLM-extracted brands_named. NOT cited domains —
 * those are sources, tagged separately via tagSource.
 */
export function recommendedBrands(p: PollResult, ownName: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const own = (ownName || "").trim().toLowerCase();
  const add = (name: string) => {
    const nm = (name || "").trim();
    const key = nm.toLowerCase();
    if (!nm || key === own || seen.has(key)) return;
    seen.add(key);
    out.push(nm);
  };
  for (const c of p.competitors_cited ?? []) add(c.name);
  for (const b of p.brands_named ?? []) add(b);
  return out;
}

/** Competitor brands recommended in a query (excl. own) — the gap-row signal. */
export function whoCited(p: PollResult, ownName: string): string[] {
  return recommendedBrands(p, ownName);
}

export interface InfluenceRollup {
  queriesNamed: number;
  totalQueries: number;
  dominant: DecisiveFactor;
  topSources: string[]; // domains most consistently driving the mentions
  youInSourcesCount: number; // # of those driving source-domains we also appear in
}

/** Audit-wide influence summary for one competitor brand (Competitors tab). */
export function influenceRollup(
  polls: PollResult[],
  brandName: string
): InfluenceRollup | null {
  const bl = brandName.toLowerCase();
  let queriesNamed = 0;
  const factorTally: Record<string, number> = {};
  const srcCount = new Map<string, number>();
  const compDomains = new Set<string>();
  const youDomains = new Set<string>();
  for (const p of polls) {
    const w = (p.why_cited ?? []).find((x) => x.brand.toLowerCase() === bl);
    for (const s of p.own_page?.named_in_sources ?? []) youDomains.add(s.domain);
    if (!w) continue;
    queriesNamed++;
    factorTally[w.decisive] = (factorTally[w.decisive] ?? 0) + 1;
    for (const s of w.named_in_sources) {
      srcCount.set(s.domain, (srcCount.get(s.domain) ?? 0) + 1);
      compDomains.add(s.domain);
    }
  }
  if (queriesNamed === 0) return null;
  const topSources = Array.from(srcCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([d]) => d);
  const dominant = (Object.entries(factorTally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "citations") as DecisiveFactor;
  let youInSourcesCount = 0;
  for (const d of compDomains) if (youDomains.has(d)) youInSourcesCount++;
  return {
    queriesNamed,
    totalQueries: polls.length,
    dominant,
    topSources,
    youInSourcesCount,
  };
}

/** Unique competitor brands NAMED across the whole run (named + discovered). */
export function allCompetitorBrands(audit: Audit, polls: PollResult[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of polls) {
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const k = nm.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(nm);
    }
  }
  return out;
}

export interface GapRow {
  id: string;
  query: string;
  state: QueryState;
  position: number | null;
  citedCount: number;
  who: string[];
  rankScore: number;
}

const STATE_WEIGHT: Record<QueryState, number> = { absent: 3, weak: 2, held: 1 };

/**
 * Rank gaps by "lost demand". We don't ingest search volume, so this is the
 * spec's fallback: citation-absence + competitor-count (NO /mo figures faked).
 */
export function buildGapRows(audit: Audit, polls: PollResult[]): GapRow[] {
  return polls
    .map((p) => {
      const state = queryState(p);
      const who = whoCited(p, audit.brand_name);
      const citedCount = (p.citations ?? []).length;
      const rankScore = STATE_WEIGHT[state] * 1000 + who.length * 25 + citedCount;
      return {
        id: p.id,
        query: p.query_text,
        state,
        position: p.brand_position,
        citedCount,
        who,
        rankScore,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}

export interface SovEntry {
  name: string;
  domain: string | null;
  count: number;
  pct: number;
  isYou: boolean;
}

/**
 * Share of RECOMMENDATIONS across answers — the share a buyer understands:
 * "of all the products ChatGPT names, how often is it you vs each competitor?"
 * Counts BRANDS NAMED in prose (not cited domains). Each brand once per query.
 */
export function computeShareOfVoice(audit: Audit, polls: PollResult[]): SovEntry[] {
  const counts = new Map<string, { name: string; domain: string | null; count: number; isYou: boolean }>();
  const bump = (key: string, name: string, domain: string | null, isYou: boolean) => {
    const ex = counts.get(key);
    if (ex) ex.count++;
    else counts.set(key, { name, domain, count: 1, isYou });
  };

  for (const p of polls) {
    if (p.brand_cited) bump("__you__", audit.brand_name, audit.domain, true);
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const orig =
        (audit.competitors ?? []).find((c) => c.toLowerCase() === nm.toLowerCase()) ||
        nm;
      bump("name:" + nm.toLowerCase(), orig, competitorToDomain(orig), false);
    }
  }

  const total = Array.from(counts.values()).reduce((s, e) => s + e.count, 0) || 1;
  return Array.from(counts.values())
    .map((e) => ({ ...e, pct: Math.round((e.count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

export interface ProfileSource {
  domain: string;
  kind: SourceTagKind;
  subtype: string;
  count: number;
}

export interface CompetitorProfile {
  name: string;
  domain: string | null;
  isYou: boolean;
  /** Competitor surfaced by role judgment but not on the tracked list. */
  discovered: boolean;
  sovPct: number;
  tier: 1 | 2 | 3;
  verdict: string;
  strengths: string[];
  beatsYou: string[];
  sources: ProfileSource[];
}

function tierForPct(pct: number): 1 | 2 | 3 {
  if (pct >= 20) return 1;
  if (pct >= 8) return 2;
  return 3;
}

/** Does this poll NAME the given brand as an answer (prose-based)? */
function pollRecommends(
  p: PollResult,
  isYou: boolean,
  name: string,
  ownName: string
): boolean {
  if (isYou) return p.brand_cited;
  const nl = name.toLowerCase();
  return recommendedBrands(p, ownName).some((b) => b.toLowerCase() === nl);
}

/**
 * Full competitor profiles for the Competitors tab — the user's brand pinned
 * first, then competitors by share of voice. All derived from poll_results +
 * the batched verdicts; nothing fabricated.
 */
export function buildCompetitorProfiles(
  audit: Audit,
  polls: PollResult[]
): CompetitorProfile[] {
  const ownNorm = normalizeDomain(audit.domain);
  const namedNorm = new Set(
    (audit.competitors ?? []).map((c) => normalizeDomain(c)).filter(Boolean)
  );
  const namedLower = new Set(
    (audit.competitors ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)
  );

  // Source-rail tagging only: which CITED DOMAINS are competitor-owned (from the
  // per-query LLM role judgments). Kept separate from the competitor brand list.
  const competitorJudged = new Set<string>([
    ...(audit.discovered_competitors ?? [])
      .filter((d) => d.label === "competitor")
      .map((d) => normalizeDomain(d.domain)),
  ]);
  for (const p of polls) {
    for (const dom of competitorDomainsInPoll(p)) competitorJudged.add(dom);
  }

  // Competitor BRANDS named anywhere in the run (prose signal). lower -> display.
  const recAll = new Map<string, string>();
  for (const p of polls) {
    for (const nm of recommendedBrands(p, audit.brand_name)) {
      const k = nm.toLowerCase();
      if (!recAll.has(k)) recAll.set(k, nm);
    }
  }

  const verdictByKey = new Map<string, string>();
  for (const v of audit.competitor_verdicts ?? []) {
    verdictByKey.set(v.name.toLowerCase(), v.verdict);
    if (v.domain) verdictByKey.set(normalizeDomain(v.domain), v.verdict);
  }

  const sov = computeShareOfVoice(audit, polls);
  const sovByKey = new Map<string, number>();
  for (const s of sov) {
    if (s.isYou) sovByKey.set("__you__", s.pct);
    else {
      sovByKey.set(s.name.toLowerCase(), s.pct);
      if (s.domain) sovByKey.set(normalizeDomain(s.domain), s.pct);
    }
  }

  type Entity = { name: string; domain: string | null; isYou: boolean; discovered: boolean };
  const discoveredBrands = Array.from(recAll.entries())
    .filter(([k]) => !namedLower.has(k))
    .map(([, name]) => name);
  const entities: Entity[] = [
    { name: audit.brand_name, domain: audit.domain, isYou: true, discovered: false },
    ...(audit.competitors ?? []).map((n) => ({
      name: n,
      domain: competitorToDomain(n),
      isYou: false,
      discovered: false,
    })),
    ...discoveredBrands.map((name) => ({
      name,
      domain: competitorToDomain(name),
      isYou: false,
      discovered: true,
    })),
  ];
  // Dedupe by lowercased name (named entries come first, so they win the tag).
  const seen = new Set<string>();
  const uniq = entities.filter((e) => {
    const k = e.name.toLowerCase();
    if (!e.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const profiles: CompetitorProfile[] = uniq.map((e) => {
    const dn = e.domain ? normalizeDomain(e.domain) : "";
    const appears = polls.filter((p) =>
      pollRecommends(p, e.isYou, e.name, audit.brand_name)
    );
    const strengths = appears.map((p) => p.query_text).slice(0, 4);
    const beatsYou = e.isYou
      ? []
      : appears
          .filter((p) => !p.brand_cited || (p.brand_position ?? 99) > 2)
          .map((p) => p.query_text)
          .slice(0, 5);

    // Co-cited sources across the queries where this entity appears.
    const srcCount = new Map<string, ProfileSource>();
    for (const p of appears) {
      for (const c of p.citations ?? []) {
        const cd = normalizeDomain(c.domain);
        if (!cd || cd === dn) continue;
        if (ownNorm && (cd === ownNorm || cd.endsWith("." + ownNorm))) continue;
        const tag = tagSource(c, audit.domain, namedNorm, competitorJudged);
        const ex = srcCount.get(cd);
        if (ex) ex.count++;
        else
          srcCount.set(cd, {
            domain: c.domain,
            kind: tag.kind,
            subtype: tag.subtype,
            count: 1,
          });
      }
    }
    const sources = Array.from(srcCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const sovPct = e.isYou
      ? sovByKey.get("__you__") ?? 0
      : sovByKey.get(e.name.toLowerCase()) ?? (dn ? sovByKey.get(dn) ?? 0 : 0);
    const verdict = e.isYou
      ? audit.brand_verdict ?? ""
      : verdictByKey.get(e.name.toLowerCase()) ?? (dn ? verdictByKey.get(dn) ?? "" : "");

    return {
      name: e.name,
      domain: e.domain,
      isYou: e.isYou,
      discovered: e.discovered,
      sovPct,
      tier: tierForPct(sovPct),
      verdict,
      strengths,
      beatsYou,
      sources,
    };
  });

  // Pin the user first, then competitors by SoV desc.
  const you = profiles.filter((p) => p.isYou);
  const rest = profiles
    .filter((p) => !p.isYou)
    .sort((a, b) => b.sovPct - a.sovPct);
  return [...you, ...rest];
}
