import type { Lever, LeversSeed, Settings, StatementSeed } from "@ledger/schema";
import { fundingKey } from "@ledger/schema";

/** The statement line that debt interest lands on. Spending here is not counted as stimulus. */
export const DEBT_INTEREST_LINE = "debt_interest";

export type Side = "receipt" | "spending";

/** Everything the T0 engine needs, indexed once so compute() stays well under 50 ms. */
export interface Model {
  statement: StatementSeed;
  levers: Lever[];
  leverById: Map<string, Lever>;
  sideOf: Map<string, Side>;
  macroRules: LeversSeed["macro_rules"];
  /** The lever that moves debt interest (Bank Rate). Its scenario value also prices extra debt. */
  rateLever: Lever | undefined;
}

export function createModel(statement: StatementSeed, levers: LeversSeed): Model {
  const sideOf = new Map<string, Side>([
    ...statement.receipts.map((l) => [l.id, "receipt"] as const),
    ...statement.spending.map((l) => [l.id, "spending"] as const),
  ]);
  return {
    statement,
    levers: levers.levers,
    leverById: new Map(levers.levers.map((l) => [l.id, l])),
    sideOf,
    macroRules: levers.macro_rules,
    rateLever: levers.levers.find((l) => l.effect.target === DEBT_INTEREST_LINE),
  };
}

/** Every lever at its base value, measures off and funded by their first option. */
export function baseSettings(model: Model): Settings {
  const s: Settings = {};
  for (const l of model.levers) {
    s[l.id] = l.base;
    if (l.funding_options?.[0]) s[fundingKey(l.id)] = l.funding_options[0].id;
  }
  return s;
}

/** Settings that differ from base: what a preset or share link needs to store. */
export function changedSettings(model: Model, settings: Settings): Settings {
  const base = baseSettings(model);
  const out: Settings = {};
  for (const [k, v] of Object.entries(settings)) {
    if (base[k] === v) continue;
    // A funding choice only matters while its measure is on.
    const [leverId, suffix] = k.split(".");
    if (suffix === "funding" && !isOn(numberSetting(settings, leverId!, 0))) continue;
    out[k] = v;
  }
  return out;
}

export function numberSetting(settings: Settings, id: string, fallback: number): number {
  const v = settings[id];
  return typeof v === "number" ? v : fallback;
}

export const isOn = (v: number) => v >= 1;
