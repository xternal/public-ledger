import "server-only";
import { loadSeed } from "@ledger/schema/seed";
import type { Seed } from "@ledger/schema";

/**
 * Seed data, parsed and cross-checked through the Zod schemas at build time.
 * A bad seed file fails the build rather than rendering wrong numbers.
 */
let cached: Seed | null = null;

export function getSeed(): Seed {
  cached ??= loadSeed();
  return cached;
}
