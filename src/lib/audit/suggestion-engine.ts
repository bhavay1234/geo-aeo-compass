import type { Citation, Suggestion, SourceType } from '../db/types';

/**
 * Operator-tunable thresholds. Position 1..WINNING_POSITION_MAX is
 * considered "winning"; anything higher is a weak/losing position.
 */
export const WINNING_POSITION_MAX = 2;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Deterministic, per-query recommendation. Zero OpenAI calls — derived
 * entirely from the brand citation result + classified citations of a
 * single poll_result. The decision table is evaluated top to bottom;
 * first match wins. Action strings interpolate real domains/positions so
 * the advice is specific, not generic.
 */
export function buildSuggestion(input: {
  brand_cited: boolean;
  brand_position: number | null;
  citations: Array<{
    domain: string;
    source_type: SourceType;
    title: string;
    url: string;
  }>;
}): Suggestion {
  const { brand_cited, brand_position, citations } = input;

  // A. Cited at a winning position.
  if (
    brand_cited &&
    brand_position !== null &&
    brand_position <= WINNING_POSITION_MAX
  ) {
    return {
      situation: 'winning',
      severity: 'low',
      action: `You own this query (position ${brand_position}). Protect it — monitor for competitor displacement and keep the cited page fresh.`,
      evidence: `Cited at position ${brand_position}.`,
    };
  }

  // B. Cited but ranking low.
  if (brand_cited) {
    const pos = brand_position ?? 99;
    return {
      situation: 'weak_position',
      severity: 'medium',
      action: `You appear but rank low (position ${pos}). You're close — strengthen the page ChatGPT is citing with clearer entity signals, comparison framing, and structured data to climb.`,
      evidence: `Cited but at position ${pos}.`,
    };
  }

  // From here, the brand was NOT cited.

  // C. A competitor is cited in this answer.
  const competitorCites = citations.filter((c) => c.source_type === 'competitor');
  if (competitorCites.length > 0) {
    const domains = unique(competitorCites.map((c) => c.domain));
    return {
      situation: 'losing_to_competitor',
      severity: 'high',
      action: `A competitor is cited here and you are not, via ${domains[0]}. Build/optimize a dedicated page targeting this exact query and pursue presence on the cited source.`,
      evidence: `Competitor cited through ${domains.join(', ')}.`,
    };
  }

  // D. Answer sourced from a review directory or analyst, brand absent.
  const authoritative = citations.filter(
    (c) => c.source_type === 'review_directory' || c.source_type === 'analyst'
  );
  if (authoritative.length > 0) {
    const domains = unique(authoritative.map((c) => c.domain));
    return {
      situation: 'losing_to_competitor',
      severity: 'high',
      action: `ChatGPT is sourcing this answer from ${domains[0]} where you're absent. Get listed/optimized on this review or analyst source — it's a direct citation path into the AI answer.`,
      evidence: `Answer sourced from ${domains.join(', ')} without you.`,
    };
  }

  // E. External sources cited, but none competitor/review/analyst.
  if (citations.length > 0) {
    const domains = unique(citations.map((c) => c.domain));
    return {
      situation: 'open_opportunity',
      severity: 'medium',
      action: `This answer cites external sources but no clear category leader. An authoritative, well-structured page targeting this query could capture the citation — open territory.`,
      evidence: `Sources cited but no dominant brand: ${domains.join(', ')}.`,
    };
  }

  // F. No live citations — model answered from training memory.
  return {
    situation: 'authority_gap',
    severity: 'low',
    action: `ChatGPT answered from its training, citing no live sources. Hardest to influence short-term — needs sustained brand-authority content the model ingests over time. Lower immediate priority.`,
    evidence: `No live citations — model answered from memory.`,
  };
}
