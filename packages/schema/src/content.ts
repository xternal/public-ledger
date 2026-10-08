import { z } from "zod";
import { IsoDate, Range } from "./provenance";
import { ContractRef, contractKey, type ContractFile, type ContractLink } from "./contracts";
import { Settings } from "./levers";
import { EventType, Status, Venue } from "./promises";

/**
 * Promise cards and actors as content files (content/promises/*.yaml,
 * content/actors/*.yaml), per docs/DATA_MODEL.md and docs/PROMISE_STANDARD.md.
 * Versions and events are append-only; CI compares every card with main.
 */

export const ActorKind = z.enum(["person", "party", "government"]);

export const ActorFile = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    /** A short form for tight spaces (filter chips, list lines): "Labour" for "Labour Party". */
    short_name: z.string().min(1).optional(),
    kind: ActorKind,
    party_id: z.string().optional(),
    roles: z.array(z.object({ title: z.string().min(1), from: IsoDate.optional(), to: IsoDate.optional() })),
    /**
     * A person who is or was an MP: their UK Parliament Members API id
     * (members.parliament.uk/member/<id>). Their constituency's /mp page lists
     * their own promises.
     */
    parliament_member_id: z.number().int().positive().optional(),
    /**
     * A party: its Members API party id (Labour and Labour (Co-op) MPs share
     * one). Its MPs' /mp pages summarise its promises.
     */
    parliament_party_id: z.number().int().positive().optional(),
    /**
     * Official pages about this actor, for search engines' structured data
     * (schema.org sameAs): a party's own website, a GOV.UK profile or
     * organisation page. Only pages an editor has checked are about this actor;
     * the UK Parliament page is derived from parliament_member_id, so it is not
     * listed here.
     */
    same_as: z.array(z.url()).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.parliament_member_id !== undefined && a.kind !== "person")
      ctx.addIssue({ code: "custom", path: ["parliament_member_id"], message: "only a person has a parliament_member_id" });
    if (a.parliament_party_id !== undefined && a.kind !== "party")
      ctx.addIssue({ code: "custom", path: ["parliament_party_id"], message: "only a party has a parliament_party_id" });
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

/**
 * A visible correction of a fact in a card's history (PROMISE_STANDARD §9).
 * History is append-only (invariant 5), so a wrong date, figure or note in a
 * version, event or reply is fixed by changing it *and* appending a correction
 * that records the old value, the new value and why. The card shows every
 * correction; nothing is overwritten silently.
 */
export const CORRECTION_PATH = /^(versions|events|replies)\[(\d+)\]((?:\.[a-z_]+)+)$/;
export const Correction = z.object({
  date: IsoDate,
  /** The corrected field, e.g. "versions[0].parameters.how_much_bn_per_year" or "events[3].date". */
  path: z.string().regex(CORRECTION_PATH, 'a correction path looks like "events[3].date" or "versions[0].parameters.cost_note"'),
  /** The old value; null when the field was absent. */
  was: z.unknown(),
  /** The new value, as it now stands in the card; null when the field was removed. */
  now: z.unknown(),
  reason: z.string().min(1),
  source_url: z.url().optional(),
});
export type Correction = z.infer<typeof Correction>;

/** Read a field by a correction path's tail (".parameters.cost_note") inside one entry. */
export function fieldAt(entry: unknown, tail: string): unknown {
  let v: unknown = entry;
  for (const k of tail.split(".").filter(Boolean)) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v === undefined ? null : v;
}

function withField(entry: unknown, tail: string, value: unknown): unknown {
  const keys = tail.split(".").filter(Boolean);
  const copy = structuredClone(entry) as Record<string, unknown>;
  let o = copy;
  keys.slice(0, -1).forEach((k) => {
    if (!o[k] || typeof o[k] !== "object") o[k] = {};
    o = o[k] as Record<string, unknown>;
  });
  const last = keys.at(-1)!;
  if (value === null) delete o[last];
  else o[last] = value;
  return copy;
}

/** JSON with sorted keys, so two objects compare equal whatever order their keys were written in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/**
 * A review of the whole card, shown on it. "automated" is AI Journalist (called Junior Editor until 8 Oct 2026), the
 * automated second check (every quote word for word at its source, dates,
 * evidence, status, cost, neutral wording, legal risk); "editor" and "legal" are
 * people. Reviews are append-only: a later review is added, never edited in.
 */
export const Review = z.object({
  by: z.string().min(1),
  kind: z.enum(["automated", "editor", "legal"]),
  on: IsoDate,
  note: z.string().optional(),
});
export type Review = z.infer<typeof Review>;

/**
 * A card's headline: a neutral 3–8 word summary of what is promised, written
 * by editors from the quote alone ("Create Great British Energy", "Cap bus
 * fares at £2"). It names the card in page titles, lists and search results;
 * the quote stays the record. Not history: it can be improved at any time.
 */
export const Headline = z
  .string()
  .trim()
  .min(3)
  .max(70, "a headline is a short summary: 3–8 words, under 70 characters")
  .refine((h) => !/[.!?]$/.test(h), "a headline has no closing full stop")
  .refine((h) => {
    const words = h.split(/\s+/).length;
    return words >= 3 && words <= 8;
  }, "a headline is 3–8 words");

export const PromiseFile = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** Optional until every card has one; pages fall back to the quote cut at a word boundary. */
    headline: Headline.optional(),
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
    corrections: z.array(Correction).default([]),
    reviews: z.array(Review).default([]),
    /**
     * Public contracts that carry the promise out, linked by an editor (M6b):
     * OCIDs from Find a Tender or Contracts Finder. Shown once the card is
     * funded, delivering or delivered.
     */
    contracts: z.array(ContractRef).default([]),
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
    // Each correction must describe the card as it now stands: the last correction of a field holds its current value.
    const lastByPath = new Map(p.corrections.map((c, i) => [c.path, i]));
    p.corrections.forEach((c, i) => {
      const m = CORRECTION_PATH.exec(c.path);
      if (!m) return;
      const entry = (p[m[1] as "versions" | "events" | "replies"] as unknown[])[Number(m[2])];
      if (entry === undefined) ctx.addIssue({ code: "custom", path: ["corrections", i, "path"], message: `${c.path} does not exist in this card` });
      else if (lastByPath.get(c.path) === i && stable(fieldAt(entry, m[3]!)) !== stable(c.now ?? null))
        ctx.addIssue({ code: "custom", path: ["corrections", i, "now"], message: `the card's ${c.path} does not match this correction's "now" value` });
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
  /** Linked contracts that have been fetched, in the order the card lists them. */
  contracts: ContractLink[];
}

export function cardViews(promises: PromiseFile[], actors: ActorFile[], contracts: ContractFile[] = []): CardView[] {
  const byId = new Map(actors.map((a) => [a.id, a]));
  const contractByKey = new Map(contracts.map((c) => [c.key, c]));
  return promises
    .map((file) => {
      const actor = byId.get(file.actor_id)!;
      const party = actor.kind === "party" ? actor : actor.party_id ? (byId.get(actor.party_id) ?? null) : null;
      const role =
        actor.roles.find((r) => (!r.from || r.from <= file.made_on) && (!r.to || r.to >= file.made_on))?.title ?? actor.roles[0]?.title ?? null;
      const outcomeBy = file.outcome_by ? (byId.get(file.outcome_by.actor_id) ?? null) : null;
      const linked = file.contracts.flatMap((r) => {
        const c = contractByKey.get(contractKey(r));
        return c ? [{ ...c, id: `${file.id}:${c.key}`, promise_id: file.id }] : [];
      });
      return { id: file.id, file, actor, party, outcomeBy, current: file.versions[file.versions.length - 1]!, role, contracts: linked };
    })
    .sort((a, b) => b.file.made_on.localeCompare(a.file.made_on) || a.id.localeCompare(b.id));
}

/**
 * Invariant 5: a card's history only grows. Every entry that existed in the
 * published card must still be there, in the same place, and unchanged unless
 * a correction appended in this change records exactly what changed
 * (PROMISE_STANDARD §9). Existing corrections never change either.
 */
export function appendOnlyIssues(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const list = (o: Record<string, unknown>, k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
  const issues: string[] = [];
  const oldCorrections = list(b, "corrections");
  const allCorrections = list(a, "corrections");
  oldCorrections.forEach((c, i) => {
    if (stable(c) !== stable(allCorrections[i])) issues.push(`corrections[${i}] was changed or removed; corrections are append-only too`);
  });
  list(b, "reviews").forEach((r, i) => {
    if (stable(r) !== stable(list(a, "reviews")[i])) issues.push(`reviews[${i}] was changed or removed; reviews are append-only (add a new review instead)`);
  });
  const fresh = allCorrections.slice(oldCorrections.length) as { path?: string; was?: unknown }[];
  for (const key of ["versions", "events", "replies"] as const) {
    const was = list(b, key);
    const now = list(a, key);
    was.forEach((item, i) => {
      if (stable(item) === stable(now[i])) return;
      const fixes = fresh.filter((c) => typeof c.path === "string" && c.path.startsWith(`${key}[${i}].`));
      // Undo the recorded corrections, newest first; what is left must be the published entry.
      const undone = now[i] === undefined ? undefined : fixes.reduceRight<unknown>((e, c) => withField(e, c.path!.slice(`${key}[${i}]`.length), c.was ?? null), now[i]);
      if (!fixes.length || undone === undefined) issues.push(`${key}[${i}] was changed or removed; history is append-only (add a new entry, or record a correction)`);
      else if (stable(undone) !== stable(item)) issues.push(`${key}[${i}] changed in ways its corrections do not record`);
    });
  }
  return issues;
}
