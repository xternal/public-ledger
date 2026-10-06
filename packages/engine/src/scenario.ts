import type { Settings } from "@ledger/schema";
import { fundingKey } from "@ledger/schema";
import { baseSettings, changedSettings, type Model } from "./model";

/**
 * Scenario links (PRD F2, BUILD_PLAN M2): `?s=<code>` and `/s/<code>`.
 *
 * The code is base64url of a small JSON payload holding only the settings
 * that differ from base, with sorted keys, so the same scenario always gets
 * the same code: the code is its own content address and needs no database.
 * The base year travels with it, so a link made on one year's data can say so
 * when the data has moved on.
 */
export const SCENARIO_VERSION = 1;

interface Payload {
  v: number;
  /** Base year the scenario was built on, e.g. "2025-26". */
  y: string;
  s: Settings;
}

export interface DecodedScenario {
  /** Full settings: base values plus the decoded changes, validated against the model. */
  settings: Settings;
  baseYear: string;
  /** Keys in the link that no longer match a lever or option, so were ignored. */
  dropped: string[];
  /** Values moved back inside a lever's range or onto its step. */
  adjusted: string[];
}

const toBase64Url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64Url(code: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(code)) return null;
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
}

const sorted = (s: Settings): Settings => Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));

/** Code for the settings that differ from base, or "" when nothing differs. */
export function encodeScenario(model: Model, settings: Settings, baseYear: string): string {
  const changed = changedSettings(model, settings);
  if (Object.keys(changed).length === 0) return "";
  const payload: Payload = { v: SCENARIO_VERSION, y: baseYear, s: sorted(changed) };
  return toBase64Url(JSON.stringify(payload));
}

/** Read a code back into full settings. Returns null for anything that is not a valid code. */
export function decodeScenario(model: Model, code: string): DecodedScenario | null {
  const json = fromBase64Url(code);
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.v !== SCENARIO_VERSION) return null;

  const settings = baseSettings(model);
  const dropped: string[] = [];
  const adjusted: string[] = [];
  for (const [key, value] of Object.entries(payload.s)) {
    const [leverId, suffix] = key.split(".");
    const lever = model.leverById.get(leverId ?? "");
    if (!lever) {
      dropped.push(key);
      continue;
    }
    if (suffix === "funding") {
      if (typeof value === "string" && lever.funding_options?.some((f) => f.id === value)) settings[fundingKey(lever.id)] = value;
      else dropped.push(key);
      continue;
    }
    if (suffix !== undefined || typeof value !== "number" || !Number.isFinite(value)) {
      dropped.push(key);
      continue;
    }
    const snapped = snap(value, lever.min, lever.max, lever.step);
    if (Math.abs(snapped - value) > 1e-9) adjusted.push(key);
    settings[lever.id] = snapped;
  }
  return { settings, baseYear: payload.y, dropped, adjusted };
}

/** Clamp into [min, max] and round onto the lever's step grid (counted from min). */
export function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  // Round away floating-point dust (e.g. 0.1 steps) to the step's own precision.
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  return Number((min + steps * step).toFixed(decimals + 2));
}

function isPayload(p: unknown): p is Payload {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return typeof o.v === "number" && typeof o.y === "string" && typeof o.s === "object" && o.s !== null && !Array.isArray(o.s);
}
