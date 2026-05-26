import type { CompetitorCitation } from '../db/types';

export interface CitationParseResult {
  brand_cited: boolean;
  brand_position: number | null;
  competitors_cited: CompetitorCitation[];
}

/**
 * Parses an LLM response text to determine:
 * - Whether the target brand was mentioned (by name OR domain)
 * - At what position (1 = mentioned first, 2 = second, etc.)
 * - Which competitors were also mentioned, and at what position
 *
 * Position is determined by order of first appearance in the response.
 */
export function parseCitations(
  text: string,
  brandName: string,
  brandDomain: string,
  competitors: string[]
): CitationParseResult {
  if (!text || typeof text !== 'string') {
    return {
      brand_cited: false,
      brand_position: null,
      competitors_cited: [],
    };
  }

  const normalizedText = text.toLowerCase();
  const brandLower = brandName.toLowerCase().trim();
  const domainCore = brandDomain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  // First mention of brand by name OR domain
  const nameIdx = indexOrInf(normalizedText, brandLower);
  const domainIdx = indexOrInf(normalizedText, domainCore);
  const brandIdx = Math.min(nameIdx, domainIdx);
  const brandCited = brandIdx !== Infinity;

  // Collect all mentions with text positions
  const allMentions: { name: string; index: number }[] = [];

  if (brandCited) {
    allMentions.push({ name: brandName, index: brandIdx });
  }

  competitors.forEach((comp) => {
    const compTrimmed = comp?.trim();
    if (!compTrimmed) return;
    const idx = indexOrInf(normalizedText, compTrimmed.toLowerCase());
    if (idx !== Infinity) {
      allMentions.push({ name: compTrimmed, index: idx });
    }
  });

  // Sort by first appearance in text → determines citation order
  allMentions.sort((a, b) => a.index - b.index);

  const positionMap = new Map<string, number>();
  allMentions.forEach((m, i) => positionMap.set(m.name, i + 1));

  return {
    brand_cited: brandCited,
    brand_position: brandCited
      ? positionMap.get(brandName) ?? null
      : null,
    competitors_cited: competitors
      .map((c) => c?.trim())
      .filter((c): c is string => Boolean(c) && positionMap.has(c))
      .map((c) => ({
        name: c,
        position: positionMap.get(c)!,
      })),
  };
}

/**
 * Returns the index of `needle` in `text`, or Infinity if not found.
 * Used so we can use Math.min() to find the earliest occurrence.
 */
function indexOrInf(text: string, needle: string): number {
  if (!needle) return Infinity;
  const idx = text.indexOf(needle);
  return idx === -1 ? Infinity : idx;
}
