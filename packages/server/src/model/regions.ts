import { REGIONS, type RegionId, type T1Result } from "@ledger/schema";
import lookup from "../../../../data/seed/lad_region.json";

/**
 * Local authority → region (data/seed/lad_region.json, built from ONS's
 * LAD-to-region lookups; sources and editions are recorded in the file).
 * England by lookup; Scotland, Wales and Northern Ireland by the first letter
 * of the code.
 */
const LAD = lookup.lad as Record<string, { name: string; region: string; edition: string }>;
const NATIONS = lookup.meta.nations as Record<string, RegionId>;
const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id));

export function regionOf(code: string): RegionId | null {
  const nation = NATIONS[code.charAt(0)];
  if (nation) return nation;
  const region = LAD[code]?.region;
  return region && REGION_IDS.has(region) ? (region as RegionId) : null;
}

export interface AreaRow {
  code: string;
  /** Weight: PolicyEngine's weighted population of the area. */
  population: number;
  avg_change_gbp: number;
  /** Fraction, as PolicyEngine gives it (−0.0075 = −0.75%). */
  rel_change: number;
}

/**
 * Population-weighted averages of the local authority results, one row per
 * region or nation in REGIONS order. Regions without any area (PolicyEngine
 * reports no Northern Irish local authorities) are left out rather than shown
 * as zero. Codes missing from the lookup come back in `unmatched`.
 */
export function aggregateRegions(rows: AreaRow[]): { regions: T1Result["regions"]; unmatched: string[] } {
  const sums = new Map<RegionId, { w: number; avg: number; rel: number }>();
  const unmatched: string[] = [];
  for (const r of rows) {
    const region = regionOf(r.code);
    if (!region) {
      unmatched.push(r.code);
      continue;
    }
    if (!(r.population > 0)) continue;
    const s = sums.get(region) ?? { w: 0, avg: 0, rel: 0 };
    s.w += r.population;
    s.avg += r.population * r.avg_change_gbp;
    s.rel += r.population * r.rel_change;
    sums.set(region, s);
  }
  const regions = REGIONS.flatMap(({ id, name }) => {
    const s = sums.get(id);
    return s ? [{ id, name, avg_change_gbp: s.avg / s.w, rel_change_pct: (s.rel / s.w) * 100 }] : [];
  });
  return { regions, unmatched };
}
