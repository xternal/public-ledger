import { z } from "zod";
import { IsoDate, Range } from "./provenance";
import { Settings } from "./levers";
import { EventType, Status, Venue } from "./promises";

/**
 * Promise cards and actors as content files (content/promises/*.yaml,
 * content/actors/*.yaml), per docs/DATA_MODEL.md and docs/PROMISE_STANDARD.md.
 * Versions and events are append-only; CI compares every card with main.
 */

export const ActorKind = z.enum(["person", "party", "government"]);

export const ActorFile = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: ActorKind,
  party_id: z.string().optional(),
  roles: z.array(z.object({ title: z.string().min(1), from: IsoDate.optional(), to: IsoDate.optional() })),
});
export type ActorFile = z.infer<typeof ActorFile>;

export const PolicyArea = z.enum([
  "taxes",
  "social_protection",
  "health",
  "education",
  "economic_affairs",
  "defence",
  "public_order",
  "general_services",
  "housing_env",
  "culture",
]);
export type PolicyArea = z.infer<typeof PolicyArea>;

const Link = z.object({ title: z.string().min(1), url: z.url(), archived_url: z.url().optional() });

export const VersionParameters = z
  .object({
    who: z.string().optional(),
    how_much_bn_per_year: Range.nullable().optional(),
    cost_note: z.string().optional(),
    cost_sources: z.array(Link).optional(),
    when: z.string().optional(),
    /** Exactly as stated at announcement; null = "Funding not stated". */
    funded_by: z.string().nullable().optional(),
  })
  .nullable();
export type VersionParameters = z.infer<typeof VersionParameters>;

export const PromiseVersion = z.object({
  version: z.number().int().positive(),
  /** The actor's exact words, verbatim from source_url. */
  text: z.string().min(1),
  recorded_on: IsoDate,
  source_url: z.url(),
  /** When an editor confirmed the text verbatim at source_url; null until then. */
  quote_checked_on: IsoDate.nullable().optional(),
  parameters: VersionParameters,
});
export type PromiseVersion = z.infer<typeof PromiseVersion>;

/** Events that need an evidence link (PROMISE_STANDARD §3). */
export const EVIDENCE_REQUIRED: EventType[] = ["reworded", "in_plan", "legislated", "funded", "delivering", "delivered", "failed", "reply"];

export const PromiseEvent = z.object({
  date: IsoDate,
  type: EventType,
  text: z.string().min(1),
  evidence_url: z.url().optional(),
  auto: z.boolean().optional(),
});
export type PromiseEvent = z.infer<typeof PromiseEvent>;

export const Reply = z.object({
  from_actor_id: z.string(),
  date: IsoDate,
  text: z.string().min(1),
  editor_response: z.string().optional(),
});

export const PromiseFile = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    actor_id: z.string(),
    made_on: IsoDate,
    venue: Venue.optional(),
    venue_label: z.string().optional(),
    policy_area: PolicyArea,
    status: Status,
    status_note: z.string().optional(),
    deadline: IsoDate.optional(),
    lever_settings: Settings.optional(),
    preset_label: z.string().optional(),
    origin: z.enum(["manual", "reader_submission", "llm_intake"]).default("manual"),
    /** Reference of the reader submission the card started from (PRD F8). */
    submission_ref: z.string().regex(/^S-\d{4}-\d{2}-\d{4}$/).optional(),
    /** Public handle of the submitter, only when they asked for credit. Never a real name unless they chose it. */
    credit: z.string().min(1).max(40).optional(),
    editor_check_required: z.boolean().optional(),
    sources: z.array(Link).min(1, "a card needs at least one source"),
    versions: z.array(PromiseVersion).min(1),
    events: z.array(PromiseEvent).min(1),
    replies: z.array(Reply).default([]),
    /**
     * Who made the outcome happen when it was not the card's own actor, e.g. an
     * opposition pledge the government carried out. Shown next to the status
     * and in the track record, so credit is not given for someone else's action.
     */
    outcome_by: z.object({ actor_id: z.string(), note: z.string().optional() }).optional(),
  })
  .superRefine((p, ctx) => {
    if (p.outcome_by && !["legislated", "funded", "delivering", "delivered"].includes(p.status))
      ctx.addIssue({ code: "custom", path: ["outcome_by"], message: "outcome_by only applies once something has happened (legislated, funded, delivering or delivered)" });
    p.versions.forEach((v, i) => {
      if (v.version !== i + 1) ctx.addIssue({ code: "custom", path: ["versions", i, "version"], message: "versions must be numbered 1, 2, 3… in order" });
    });
    const current = p.versions[p.versions.length - 1]!;
    if (current.parameters === null && p.status !== "unscoreable")
      ctx.addIssue({ code: "custom", path: ["versions"], message: "parameters are required unless the card is unscoreable" });
    if (current.parameters !== null && p.status === "unscoreable")
      ctx.addIssue({ code: "custom", path: ["status"], message: "an unscoreable card has no parameters" });
    p.versions.forEach((v, i) => {
      const r = v.parameters?.how_much_bn_per_year;
      if (r && r[0] === r[2])
        ctx.addIssue({
          code: "custom",
          path: ["versions", i, "parameters", "how_much_bn_per_year"],
          message: "a cost needs a low–high range (invariant 2); if the source gives a central figure only, use the editorial ±10% and say so in cost_note",
        });
    });
    p.events.forEach((e, i) => {
      if (EVIDENCE_REQUIRED.includes(e.type) && !e.evidence_url)
        ctx.addIssue({ code: "custom", path: ["events", i, "evidence_url"], message: `a "${e.type}" event needs an evidence_url` });
    });
    if ((p.submission_ref || p.credit) && p.origin !== "reader_submission")
      ctx.addIssue({ code: "custom", path: ["origin"], message: "submission_ref and credit belong to cards with origin: reader_submission" });
    if (p.lever_settings && !p.preset_label)
      ctx.addIssue({ code: "custom", path: ["preset_label"], message: "a card with lever_settings needs a preset_label" });
  });
export type PromiseFile = z.infer<typeof PromiseFile>;

/** A card joined with its actor, current version and party, ready to render. */
export interface CardView {
  id: string;
  file: PromiseFile;
  actor: ActorFile;
  party: ActorFile | null;
  /** Set when someone other than the actor brought about the current status. */
  outcomeBy: ActorFile | null;
  current: PromiseVersion;
  /** Role of the actor on the day the promise was made, if known. */
  role: string | null;
}

export function cardViews(promises: PromiseFile[], actors: ActorFile[]): CardView[] {
  const byId = new Map(actors.map((a) => [a.id, a]));
  return promises
    .map((file) => {
      const actor = byId.get(file.actor_id)!;
      const party = actor.kind === "party" ? actor : actor.party_id ? (byId.get(actor.party_id) ?? null) : null;
      const role =
        actor.roles.find((r) => (!r.from || r.from <= file.made_on) && (!r.to || r.to >= file.made_on))?.title ?? actor.roles[0]?.title ?? null;
      const outcomeBy = file.outcome_by ? (byId.get(file.outcome_by.actor_id) ?? null) : null;
      return { id: file.id, file, actor, party, outcomeBy, current: file.versions[file.versions.length - 1]!, role };
    })
    .sort((a, b) => b.file.made_on.localeCompare(a.file.made_on) || a.id.localeCompare(b.id));
}

/**
 * Invariant 5: a card's history only grows. Every entry that existed in the
 * published card must still be there, unchanged and in the same place.
 */
export function appendOnlyIssues(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of ["versions", "events", "replies"] as const) {
    const was = Array.isArray(b[key]) ? (b[key] as unknown[]) : [];
    const now = Array.isArray(a[key]) ? (a[key] as unknown[]) : [];
    was.forEach((item, i) => {
      if (JSON.stringify(item) !== JSON.stringify(now[i])) {
        issues.push(`${key}[${i}] was changed or removed; history is append-only (add a new entry instead)`);
      }
    });
  }
  return issues;
}
