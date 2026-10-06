import { z } from "zod";
import { IsoDate, Range } from "./provenance";
import { Settings } from "./levers";

/**
 * Seed promise cards (data/seed/promises.json). M3 migrates these to
 * content/promises/*.yaml with Actor, PromiseVersion and PromiseEvent split out
 * as in DATA_MODEL.md; this schema is the M0 reading of the seed.
 */

export const Status = z.enum([
  "promised",
  "in_plan",
  "legislated",
  "funded",
  "delivering",
  "delivered",
  "failed",
  "quietly_dropped",
  "unscoreable",
]);
export type Status = z.infer<typeof Status>;

/** The ordered ladder; `failed`, `quietly_dropped` and `unscoreable` sit off it. */
export const LADDER = ["promised", "in_plan", "legislated", "funded", "delivering", "delivered"] as const satisfies readonly Status[];

export const EventType = z.enum([
  "promised",
  "reworded",
  "in_plan",
  "legislated",
  "funded",
  "delivering",
  "delivered",
  "failed",
  "deadline",
  "deadline_missed",
  "reply",
]);
export type EventType = z.infer<typeof EventType>;

export const Venue = z.enum(["manifesto", "speech", "debate", "tv", "interview", "press_release", "parliament", "social"]);

export const SeedActor = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  party: z.string().nullable(),
});

export const Parameters = z
  .object({
    who: z.string().optional(),
    how_much_bn_per_year: Range.nullable().optional(),
    when: z.string().optional(),
    funded_by: z.string().nullable().optional(),
    note: z.string().optional(),
  })
  .nullable();

export const SeedEvent = z.object({
  date: IsoDate,
  event: z.string().min(1),
  type: EventType,
});
export type SeedEvent = z.infer<typeof SeedEvent>;

export const PromiseCard = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    actor: SeedActor,
    made_on: IsoDate,
    venue: Venue.optional(),
    venue_label: z.string().optional(),
    text: z.string().min(1),
    parameters: Parameters,
    status: Status,
    deadline: IsoDate.nullable().optional(),
    lever_id: z.string().optional(),
    lever_settings: Settings.optional(),
    /** Chip label when this card is offered as a sandbox preset. */
    preset_label: z.string().optional(),
    sources: z.array(z.object({ title: z.string().min(1), url: z.url(), archived_url: z.url().optional() })),
    timeline: z.array(SeedEvent).min(1),
    right_of_reply: z.null().optional(),
    status_note: z.string().optional(),
    editor_check_required: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.parameters === null && p.status !== "unscoreable")
      ctx.addIssue({ code: "custom", path: ["parameters"], message: "parameters are required unless the card is unscoreable" });
    if (p.parameters !== null && p.status === "unscoreable")
      ctx.addIssue({ code: "custom", path: ["status"], message: "an unscoreable card has no parameters" });
  });
export type PromiseCard = z.infer<typeof PromiseCard>;

export const PromisesSeed = z.object({
  meta: z.object({ note: z.string(), status_ladder: z.array(Status) }),
  promises: z.array(PromiseCard).min(1),
});
export type PromisesSeed = z.infer<typeof PromisesSeed>;
