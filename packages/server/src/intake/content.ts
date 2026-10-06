import { PolicyArea, Venue, type ActorFile, type CardView } from "@ledger/schema";

/**
 * The published content intake needs: card ids (to validate "evidence for a
 * card" and to hint at duplicates), actors and policy areas (for the pre-fill).
 * Built from the same seed the pages render, so there is one source of truth.
 */
export interface IntakeContent {
  cards: { id: string; actor_id: string; text: string }[];
  actors: { id: string; name: string }[];
  policyAreas: readonly string[];
  venues: readonly string[];
}

export function intakeContent(seed: { cards: CardView[]; actors: ActorFile[] }): IntakeContent {
  return {
    cards: seed.cards.map((c) => ({ id: c.id, actor_id: c.file.actor_id, text: c.current.text })),
    actors: seed.actors.map((a) => ({ id: a.id, name: a.name })),
    policyAreas: PolicyArea.options,
    venues: Venue.options,
  };
}

/** Load content from the repository (Node only); used when a caller does not pass it in. */
export async function loadIntakeContent(): Promise<IntakeContent> {
  const { loadSeed } = await import("@ledger/schema/seed");
  return intakeContent(loadSeed());
}
