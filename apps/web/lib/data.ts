import "server-only";
import { loadSeed } from "@ledger/schema/seed";
import { loadPeople } from "@ledger/schema/people";
import type { PeopleBundle, Seed } from "@ledger/schema";

/**
 * Seed data, parsed and cross-checked through the Zod schemas at build time.
 * A bad seed file fails the build rather than rendering wrong numbers.
 */
let cached: Seed | null = null;

export function getSeed(): Seed {
  cached ??= loadSeed();
  return cached;
}

let people: PeopleBundle | null = null;

/** /people: ONS population projections and OBR long-term spending (data/build/people.json), validated on first use. */
export function getPeople(): PeopleBundle {
  people ??= loadPeople();
  return people;
}
