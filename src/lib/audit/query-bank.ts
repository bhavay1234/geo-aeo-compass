import type { QueryCategory } from '../db/types';

export interface BuyerQuery {
  text: string;
  category: QueryCategory;
}

/**
 * Generates 20 buyer-intent queries balanced across 6 categories:
 * - problem-aware (before category knowledge)
 * - solution-aware (comparing solutions in category)
 * - comparison (head-to-head between named competitors)
 * - alternative (searching for substitutes)
 * - use-case (specific scenarios)
 * - brand-aware (researching the specific brand)
 */
export function generateQueries(
  category: string,
  brand: string,
  competitors: string[]
): BuyerQuery[] {
  const c = (category || 'software').trim();
  const comp1 = competitors[0]?.trim() || '';
  const comp2 = competitors[1]?.trim() || '';
  const comp3 = competitors[2]?.trim() || '';

  const queries: BuyerQuery[] = [
    // Problem-aware (4)
    { text: `how to choose the right ${c}`, category: 'problem' },
    { text: `${c} buying guide 2026`, category: 'problem' },
    { text: `must-have features in ${c}`, category: 'problem' },
    { text: `${c} pricing comparison`, category: 'problem' },

    // Solution-aware (5)
    { text: `best ${c} software`, category: 'solution' },
    { text: `top ${c} platforms 2026`, category: 'solution' },
    { text: `${c} for SMB`, category: 'solution' },
    { text: `${c} for enterprise`, category: 'solution' },
    { text: `affordable ${c} tools`, category: 'solution' },
  ];

  // Comparison (3) - only added if we have competitors
  if (comp1) {
    queries.push({ text: `${brand} vs ${comp1}`, category: 'comparison' });
  }
  if (comp1 && comp2) {
    queries.push({ text: `${comp1} vs ${comp2}`, category: 'comparison' });
  }
  if (comp1 && comp3) {
    queries.push({ text: `${comp1} vs ${comp3}`, category: 'comparison' });
  }

  // Alternative-seeking (3)
  if (comp1) {
    queries.push({
      text: `${comp1} alternatives`,
      category: 'alternative',
    });
    queries.push({
      text: `alternatives to ${comp1} for SMB`,
      category: 'alternative',
    });
  }
  if (comp2) {
    queries.push({
      text: `${comp2} alternatives`,
      category: 'alternative',
    });
  }

  // Use-case (2)
  queries.push({
    text: `${c} with API integrations`,
    category: 'use_case',
  });
  queries.push({
    text: `${c} for B2B companies`,
    category: 'use_case',
  });

  // Brand-aware (3)
  queries.push({
    text: `is ${brand} good for ${c}`,
    category: 'brand',
  });
  queries.push({
    text: `${brand} review and pros and cons`,
    category: 'brand',
  });
  queries.push({
    text: `${brand} pricing and features`,
    category: 'brand',
  });

  // Cap at 20 queries (in case competitors fill 3+ slots)
  return queries.slice(0, 20);
}
