import type { Audit, PollResult, Citation } from "@/lib/db/types";
import { deriveBrandName, domainToBrand } from "@/components/CitedBrands";
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

/** Clean display names of the competitor/discovered brands cited in one query (excl. own). */
export function whoCited(p: PollResult, ownNorm: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of p.competitors_cited ?? []) {
    const nm = (c.name || "").trim();
    const key = nm.toLowerCase();
    if (nm && !seen.has(key)) {
      seen.add(key);
      out.push(nm);
    }
  }
  for (const d of p.discovered_in_query ?? []) {
    if (d.label !== "competitor") continue;
    const dn = normalizeDomain(d.domain);
    if (ownNorm && (dn === ownNorm || dn.endsWith("." + ownNorm))) continue;
    const nm = deriveBrandName(d.title, d.domain);
    const key = nm.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
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
  const ownNorm = normalizeDomain(audit.domain);
  return polls
    .map((p) => {
      const state = queryState(p);
      const who = whoCited(p, ownNorm);
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
 * Share of voice = CITATION SHARE across answers (not search impressions —
 * we don't have volume). Each brand is counted once per query it appears in.
 */
export function computeShareOfVoice(audit: Audit, polls: PollResult[]): SovEntry[] {
  const ownNorm = normalizeDomain(audit.domain);
  const counts = new Map<string, { name: string; domain: string | null; count: number; isYou: boolean }>();
  const bump = (key: string, name: string, domain: string | null, isYou: boolean) => {
    const ex = counts.get(key);
    if (ex) ex.count++;
    else counts.set(key, { name, domain, count: 1, isYou });
  };

  for (const p of polls) {
    const perQuery = new Set<string>();
    if (p.brand_cited) perQuery.add("you");
    for (const c of p.competitors_cited ?? []) {
      const nm = (c.name || "").trim();
      if (nm) perQuery.add("name:" + nm.toLowerCase());
    }
    for (const d of p.discovered_in_query ?? []) {
      if (d.label !== "competitor") continue;
      const dn = normalizeDomain(d.domain);
      if (ownNorm && (dn === ownNorm || dn.endsWith("." + ownNorm))) continue;
      perQuery.add("dom:" + dn);
    }
    // Resolve keys → entries.
    for (const key of perQuery) {
      if (key === "you") bump("you", audit.brand_name, audit.domain, true);
      else if (key.startsWith("name:")) {
        const nm = key.slice(5);
        const orig =
          (audit.competitors ?? []).find((c) => c.toLowerCase() === nm) || nm;
        bump(key, orig, competitorToDomain(orig), false);
      } else {
        const dn = key.slice(4);
        const dc = (audit.discovered_competitors ?? []).find(
          (x) => normalizeDomain(x.domain) === dn
        );
        bump(key, domainToBrand(dn), dc?.domain ?? dn, false);
      }
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

/** Does this poll cite the given entity (by name for named, by domain otherwise)? */
function pollCitesEntity(
  p: PollResult,
  isYou: boolean,
  name: string,
  domainNorm: string
): boolean {
  if (isYou) return p.brand_cited;
  if ((p.competitors_cited ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase()))
    return true;
  return (p.discovered_in_query ?? []).some(
    (d) => normalizeDomain(d.domain) === domainNorm
  );
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
  const competitorJudged = new Set(
    (audit.discovered_competitors ?? [])
      .filter((d) => d.label === "competitor")
      .map((d) => normalizeDomain(d.domain))
  );

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

  type Entity = { name: string; domain: string | null; isYou: boolean };
  const entities: Entity[] = [
    { name: audit.brand_name, domain: audit.domain, isYou: true },
    ...(audit.competitors ?? []).map((n) => ({
      name: n,
      domain: competitorToDomain(n),
      isYou: false,
    })),
    ...(audit.discovered_competitors ?? [])
      .filter((d) => d.label === "competitor")
      .map((d) => ({ name: domainToBrand(d.domain), domain: d.domain, isYou: false })),
  ];
  // Dedupe by lowercased name.
  const seen = new Set<string>();
  const uniq = entities.filter((e) => {
    const k = e.name.toLowerCase();
    if (!e.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const profiles: CompetitorProfile[] = uniq.map((e) => {
    const dn = e.domain ? normalizeDomain(e.domain) : "";
    const appears = polls.filter((p) => pollCitesEntity(p, e.isYou, e.name, dn));
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
