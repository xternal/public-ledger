import { parse } from "yaml";
import { truncate } from "./labels";

/**
 * Promise and actor files as the alerts job reads them: parsed loosely, so a
 * card that only half-validates (it should never reach main, but CI is the
 * judge of that, not this job) still produces sensible alerts.
 */

export interface LooseEvent {
  date?: string;
  type?: string;
  text?: string;
  evidence_url?: string;
  auto?: boolean;
}
export interface LooseVersion {
  version?: number;
  text?: string;
  recorded_on?: string;
  source_url?: string;
  parameters?: { how_much_bn_per_year?: number[] | null } | null;
}
export interface LooseReply {
  from_actor_id?: string;
  date?: string;
  text?: string;
}
export interface LooseCard {
  id: string;
  actor_id: string;
  policy_area: string;
  status: string;
  made_on?: string;
  deadline?: string;
  submission_ref?: string;
  versions: LooseVersion[];
  events: LooseEvent[];
  replies: LooseReply[];
}
export interface LooseActor {
  id: string;
  name: string;
  kind?: string;
  party_id?: string;
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const str = (x: unknown): string => (typeof x === "string" ? x : x == null ? "" : String(x));

/** Parse a promise file's YAML; null if it is not a card at all. */
export function parseCard(yamlText: string): LooseCard | null {
  let data: Record<string, unknown>;
  try {
    data = parse(yamlText) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || typeof data.id !== "string") return null;
  return {
    id: data.id,
    actor_id: str(data.actor_id),
    policy_area: str(data.policy_area),
    status: str(data.status),
    made_on: data.made_on ? str(data.made_on) : undefined,
    deadline: data.deadline ? str(data.deadline) : undefined,
    submission_ref: typeof data.submission_ref === "string" ? data.submission_ref : undefined,
    versions: arr<LooseVersion>(data.versions),
    events: arr<LooseEvent>(data.events),
    replies: arr<LooseReply>(data.replies),
  };
}

export function parseActor(yamlText: string): LooseActor | null {
  try {
    const data = parse(yamlText) as Record<string, unknown>;
    if (!data || typeof data.id !== "string") return null;
    return { id: data.id, name: str(data.name) || data.id, kind: data.kind ? str(data.kind) : undefined, party_id: data.party_id ? str(data.party_id) : undefined };
  } catch {
    return null;
  }
}

export function actorsFrom(files: Map<string, string>): Map<string, LooseActor> {
  const out = new Map<string, LooseActor>();
  for (const text of files.values()) {
    const a = parseActor(text);
    if (a) out.set(a.id, a);
  }
  return out;
}

/** The party an actor belongs to (a party is its own party), for "follow this party" matching. */
export function partyOf(actors: Map<string, LooseActor>, actorId: string): string | null {
  const a = actors.get(actorId);
  if (!a) return null;
  if (a.kind === "party") return a.id;
  return a.party_id ?? null;
}

export const currentVersion = (c: LooseCard): LooseVersion | undefined => c.versions[c.versions.length - 1];

/** Heading for a card in messages: Andy Burnham: “I’ve done it before…” */
export function cardTitle(c: LooseCard, actors?: Map<string, LooseActor>): string {
  const who = actors?.get(c.actor_id)?.name ?? c.actor_id;
  const words = currentVersion(c)?.text;
  return words ? `${who}: “${truncate(words, 100)}”` : `${who}: ${c.id}`;
}
