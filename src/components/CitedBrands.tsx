import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { normalizeDomain, competitorToDomain } from "@/lib/audit/source-classifier";
import type { CompetitorCitation, DiscoveredInQuery } from "@/lib/db/types";

export type BrandTier = 1 | 2 | 3;

export interface CitedBrand {
  key: string;
  name: string;
  domain: string;
  tier: BrandTier;
}

const MAX_PILLS = 5;

const TIER_STYLES: Record<BrandTier, string> = {
  1: "border-primary/30 bg-primary/10 text-primary",
  2: "border-warning/30 bg-warning/10 text-warning",
  3: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

// Words that mark a title segment as an article/listicle fragment, not a brand.
const TITLE_REJECT_WORDS = new Set([
  "blog",
  "table",
  "comparison",
  "guide",
  "top",
  "best",
  "list",
  "vs",
  "review",
  "software",
  "platform",
  "tool",
  "agent",
  "solution",
]);
const TITLE_REJECT_GENERIC = new Set([
  "insights",
  "go",
  "home",
  "products",
  "pricing",
]);

export function domainToBrand(domain: string): string {
  const core = normalizeDomain(domain).split(".")[0] || domain;
  if (!core) return domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function isUsableTitleSegment(seg: string): boolean {
  if (!seg) return false;
  const words = seg.split(/\s+/);
  if (words.length > 3) return false;
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (lowerWords.some((w) => TITLE_REJECT_WORDS.has(w))) return false;
  if (words.length === 1 && TITLE_REJECT_GENERIC.has(lowerWords[0])) return false;
  return true;
}

/**
 * Derive a clean display name. DOMAIN-FIRST: citations always carry a domain,
 * so strip www+TLD and capitalize (g2.com → G2, vapi.ai → Vapi). Only fall
 * back to a title segment when there's no usable domain, and reject title
 * fragments that read like article headings.
 */
export function deriveBrandName(title: string, domain: string): string {
  if (normalizeDomain(domain)) return domainToBrand(domain);
  const seg = (title || "").split(/[|\-:–—]/)[0].trim();
  return isUsableTitleSegment(seg) ? seg : domain || "Unknown";
}

/**
 * Merge named-competitor citations and discovered external domains into a
 * single, deduped, tier-sorted list of cited brands (own domain excluded).
 * Tier 1 = named competitor, Tier 2 = discovered competitor, Tier 3 = other.
 */
export function categorizeCitedBrands(
  competitorsCited: CompetitorCitation[],
  discoveredInQuery: DiscoveredInQuery[],
  ownDomain: string,
  namedCompetitors: string[]
): CitedBrand[] {
  const ownNorm = normalizeDomain(ownDomain);
  const namedDomainToName = new Map<string, string>();
  for (const name of namedCompetitors) {
    const d = normalizeDomain(competitorToDomain(name));
    if (d) namedDomainToName.set(d, name);
  }

  const brands: CitedBrand[] = [];
  const seen = new Set<string>();
  const add = (key: string, name: string, domain: string, tier: BrandTier) => {
    if (seen.has(key)) return;
    seen.add(key);
    brands.push({ key, name, domain, tier });
  };

  // Tier 1 — named competitors that were cited.
  for (const c of competitorsCited) {
    const nm = (c.name || "").trim();
    if (!nm) continue;
    add(`name:${nm.toLowerCase()}`, nm, competitorToDomain(nm), 1);
  }

  // Discovered external domains.
  for (const d of discoveredInQuery) {
    const dn = normalizeDomain(d.domain);
    if (!dn) continue;
    if (ownNorm && (dn === ownNorm || dn.endsWith(`.${ownNorm}`))) continue;

    // Does this domain map to a named competitor? → Tier 1.
    let namedName = namedDomainToName.get(dn);
    if (!namedName) {
      for (const [cd, nm] of namedDomainToName) {
        if (dn === cd || dn.endsWith(`.${cd}`)) {
          namedName = nm;
          break;
        }
      }
    }
    if (namedName) {
      add(`name:${namedName.toLowerCase()}`, namedName, d.domain, 1);
      continue;
    }

    const tier: BrandTier = d.label === "competitor" ? 2 : 3;
    add(`domain:${dn}`, deriveBrandName(d.title, d.domain), d.domain, tier);
  }

  brands.sort((a, b) => a.tier - b.tier);
  return brands;
}

export function CitedBrands({
  competitorsCited,
  discoveredInQuery,
  ownDomain,
  namedCompetitors,
}: {
  competitorsCited: CompetitorCitation[];
  discoveredInQuery: DiscoveredInQuery[];
  ownDomain: string;
  namedCompetitors: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const brands = categorizeCitedBrands(
    competitorsCited,
    discoveredInQuery,
    ownDomain,
    namedCompetitors
  );

  if (brands.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const visible = expanded ? brands : brands.slice(0, MAX_PILLS);
  const overflow = brands.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((b) => (
        <Badge
          key={b.key}
          variant="outline"
          title={b.domain}
          className={cn(TIER_STYLES[b.tier])}
        >
          {b.name}
        </Badge>
      ))}
      {!expanded && overflow > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70"
        >
          +{overflow} more
        </button>
      )}
    </div>
  );
}

export function CitedBrandsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-primary" />
        Named competitor
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-warning" />
        Discovered competitor
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        Other source
      </span>
    </div>
  );
}
