import type {
  InfluenceFactors,
  InfluenceSource,
  DecisiveFactor,
  PageRef,
} from '../db/types';

// Citations weighted highest, own-site least (for best-software queries).
const WEIGHT: Record<DecisiveFactor, number> = {
  citations: 3,
  third_party: 2,
  own_site: 1,
};

/** Single most-decisive factor by weighted score (citations win ties). */
export function decisiveFactor(f: InfluenceFactors): DecisiveFactor {
  const ranked: [DecisiveFactor, number][] = [
    ['citations', f.cited * WEIGHT.citations],
    ['third_party', f.third_party * WEIGHT.third_party],
    ['own_site', f.own_site * WEIGHT.own_site],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'third_party';
}

function sourceList(sources: InfluenceSource[]): string {
  const ds = sources.slice(0, 2).map((s) => s.domain);
  if (ds.length === 0) return '';
  return ds.join(' and ') + (sources.length > 2 ? ` +${sources.length - 2} more` : '');
}

export interface InfluenceSide {
  factors: InfluenceFactors;
  named_in_sources: InfluenceSource[];
  cited_total: number;
  third_party_count: number;
  own_page: PageRef | null;
}

/**
 * Deterministic fallback verdict (used only if the cheap LLM call fails). Leads
 * with the citation evidence, names the decisive factor, then "why not you".
 * "Likely/primarily" framing - correlated with citation, not proof of ranking.
 */
export function buildInfluenceFallback(args: {
  brand: string;
  you: string;
  x: InfluenceSide;
  me: InfluenceSide;
}): string {
  const { brand, you, x, me } = args;
  const dec = decisiveFactor(x.factors);

  let lead: string;
  if (dec === 'citations') {
    lead = `${brand} was likely named primarily because ${x.named_in_sources.length} of the ${x.cited_total} cited source${x.cited_total === 1 ? '' : 's'} name it`;
    const sl = sourceList(x.named_in_sources);
    lead += sl ? ` (incl. ${sl}).` : '.';
  } else if (dec === 'third_party') {
    lead = `${brand} was likely named on the strength of its presence across ${x.third_party_count} third-party source${x.third_party_count === 1 ? '' : 's'} cited elsewhere in this audit.`;
  } else {
    lead = `${brand} was likely named partly on its own-site signals${x.own_page?.schema_types.length ? ' (a dedicated page with schema)' : ''}.`;
  }

  let not: string;
  if (me.named_in_sources.length === 0) {
    not = ` ${you} wasn't named - it appears in 0 of the ${x.cited_total} cited sources for this query`;
    not += x.named_in_sources.length
      ? `, and is absent from the ${sourceList(x.named_in_sources)} pages ChatGPT pulled from.`
      : '.';
    not += ' Closest gap: get listed in the review/listicle sources driving this answer.';
  } else {
    not = ` ${you} appears in ${me.named_in_sources.length} of the cited sources but still wasn't named as a top pick - strengthen presence in the highest-authority ones.`;
  }

  return lead + not;
}
