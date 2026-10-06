import { PolicyArea } from "@ledger/schema";

/**
 * What can be followed (brief: shared conventions). `id` is a promise id, an
 * actor id, a policy area, or "*" for everything.
 */
export const TARGET_KINDS = ["promise", "actor", "area", "all"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
export interface Target {
  kind: TargetKind;
  id: string;
}

export const CADENCES = ["instant", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];

/** Human name of a target, e.g. "Andy Burnham" (resolved from content by the app). */
export type DescribeTarget = (t: Target) => string;
/** Whether a target exists in the current content. */
export type KnownTarget = (t: Target) => boolean;

/** Promise and actor ids are content file names: `[a-z0-9-]`. At most 60 characters, so Telegram payloads ("p_" + id, and "u" + that to unfollow) stay within 64. */
const CONTENT_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const AREAS = new Set<string>(PolicyArea.options);

export function isTargetKind(x: unknown): x is TargetKind {
  return typeof x === "string" && (TARGET_KINDS as readonly string[]).includes(x);
}

export function isCadence(x: unknown): x is Cadence {
  return typeof x === "string" && (CADENCES as readonly string[]).includes(x);
}

/** A well-formed target, or null. Says nothing about whether it exists in content. */
export function parseTarget(x: unknown): Target | null {
  if (!x || typeof x !== "object") return null;
  const { kind, id } = x as { kind?: unknown; id?: unknown };
  if (!isTargetKind(kind) || typeof id !== "string") return null;
  if (kind === "all") return id === "*" ? { kind, id } : null;
  if (kind === "area") return AREAS.has(id) ? { kind, id } : null;
  return CONTENT_ID.test(id) ? { kind, id } : null;
}

export function sameTarget(a: Target, b: Target): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Telegram deep-link payload: p_<promise>, a_<actor>, r_<area>, all (Telegram allows [A-Za-z0-9_-], up to 64). */
export function telegramPayload(t: Target): string {
  switch (t.kind) {
    case "promise":
      return `p_${t.id}`;
    case "actor":
      return `a_${t.id}`;
    case "area":
      return `r_${t.id}`;
    case "all":
      return "all";
  }
}

export function parseTelegramPayload(payload: string): Target | null {
  if (payload === "all") return { kind: "all", id: "*" };
  const m = /^([par])_(.+)$/.exec(payload);
  if (!m) return null;
  const kind = ({ p: "promise", a: "actor", r: "area" } as const)[m[1] as "p" | "a" | "r"];
  return parseTarget({ kind, id: m[2] });
}

/** Atom feed path (built by the alerts work). */
export function feedPath(t: Target): string {
  switch (t.kind) {
    case "promise":
      return `/feeds/promise/${t.id}.xml`;
    case "actor":
      return `/feeds/actor/${t.id}.xml`;
    case "area":
      return `/feeds/area/${t.id}.xml`;
    case "all":
      return "/feeds/all.xml";
  }
}

/** Fallback names when the app does not supply content-based ones (tests, scripts). */
export const plainDescribe: DescribeTarget = (t) =>
  t.kind === "all" ? "Every promise on Public Ledger" : t.kind === "area" ? `Policy area: ${t.id}` : `${t.kind === "promise" ? "Promise" : "Actor"} ${t.id}`;
