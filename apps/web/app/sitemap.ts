import type { MetadataRoute } from "next";
import { getPeople, getSeed } from "@/lib/data";
import { absolute, lastChanged } from "@/lib/site";

/** Every public page: home, the promise ledger, people and long-term spending, each card and each actor. Dates come from the content itself. */
export default function sitemap(): MetadataRoute.Sitemap {
  const seed = getSeed();
  const built = seed.builtAt.slice(0, 10);
  const lastEvent = (id: string) => lastChanged(seed.cards.find((c) => c.id === id)!.file) ?? built;
  const latest = seed.cards.map((c) => lastEvent(c.id)).sort().at(-1) ?? built;
  // /people changes when one of its sources publishes a new edition.
  const peopleChanged = getPeople().sources.map((s) => s.published_on ?? built).sort().at(-1) ?? built;
  const actorIds = [...new Set(seed.cards.flatMap((c) => [c.actor.id, c.party?.id].filter((x): x is string => !!x)))];
  return [
    { url: absolute("/"), lastModified: built, changeFrequency: "daily", priority: 1 },
    { url: absolute("/promises"), lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    { url: absolute("/people"), lastModified: peopleChanged, changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/follow"), lastModified: built, changeFrequency: "monthly", priority: 0.4 },
    { url: absolute("/feeds"), lastModified: latest, changeFrequency: "daily", priority: 0.4 },
    ...seed.cards.map((c) => ({ url: absolute(`/promise/${c.id}`), lastModified: lastEvent(c.id), changeFrequency: "weekly" as const, priority: 0.7 })),
    ...actorIds.map((id) => ({
      url: absolute(`/actor/${id}`),
      lastModified: seed.cards.filter((c) => c.actor.id === id || c.party?.id === id).map((c) => lastEvent(c.id)).sort().at(-1) ?? built,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
