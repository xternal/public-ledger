import type { z } from "zod";
import statementRaw from "../../../data/seed/uk_fy2025-26_pnl.json";
import leversRaw from "../../../data/seed/levers.json";
import promisesRaw from "../../../data/seed/promises.json";
import presetsRaw from "../../../data/seed/presets.json";
import taxRaw from "../../../data/seed/uk_tax_2025-26.json";
import { StatementSeed } from "./statement";
import { LeversSeed, fundingKey, type Lever, type Settings } from "./levers";
import { PromisesSeed } from "./promises";
import { PresetsSeed, type Preset } from "./presets";
import { TaxSeed } from "./tax";
import type { Source } from "./provenance";

export interface Seed {
  statement: StatementSeed;
  levers: LeversSeed;
  promises: PromisesSeed;
  /** Editorial presets followed by one preset per promise card that has lever settings. */
  presets: Preset[];
  tax: TaxSeed;
  sources: Source[];
}

export interface SeedIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}

export interface RawSeed {
  statement: unknown;
  levers: unknown;
  promises: unknown;
  presets: unknown;
  tax: unknown;
}

export const RAW_SEED: RawSeed = {
  statement: statementRaw,
  levers: leversRaw,
  promises: promisesRaw,
  presets: presetsRaw,
  tax: taxRaw,
};

function zodIssues(file: string, error: z.ZodError): SeedIssue[] {
  return error.issues.map((i) => ({ level: "error", where: `${file}:${i.path.join(".")}`, message: i.message }));
}

function promisePresets(promises: PromisesSeed): Preset[] {
  return promises.promises
    .filter((p) => p.lever_settings && p.preset_label)
    .map((p) => ({
      id: `promise:${p.id}`,
      label: p.preset_label!,
      kind: "promise" as const,
      settings: p.lever_settings!,
      promise_id: p.id,
    }));
}

/** Checks that need more than one file: ids that point across files, and settings that point at levers. */
export function crossCheck(seed: Seed): SeedIssue[] {
  const issues: SeedIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  const sourceIds = new Set(seed.sources.map((s) => s.id));
  const dupes = seed.sources.map((s) => s.id).filter((id, i, all) => all.indexOf(id) !== i);
  for (const id of dupes) err("sources", `source id "${id}" is defined twice`);
  const checkSource = (where: string, id: string | undefined) => {
    if (id && !sourceIds.has(id)) err(where, `unknown source_id "${id}"`);
  };

  const { statement, levers, promises } = seed;
  statement.receipts.forEach((l) => checkSource(`receipts.${l.id}`, l.source_id));
  statement.spending.forEach((l) => checkSource(`spending.${l.id}`, l.source_id));
  checkSource("borrowing_provenance", statement.borrowing_provenance.source_id);
  for (const [key, p] of Object.entries(statement.macro.provenance)) checkSource(`macro.${key}`, p.source_id);

  const lineIds = new Set([...statement.receipts, ...statement.spending].map((l) => l.id));
  const leverById = new Map(levers.levers.map((l) => [l.id, l]));
  const promiseIds = new Set(promises.promises.map((p) => p.id));
  for (const l of levers.levers) {
    checkSource(`levers.${l.id}`, l.source_id);
    if (!lineIds.has(l.effect.target)) err(`levers.${l.id}`, `effect target "${l.effect.target}" is not a statement line`);
    if (l.promise_id && !promiseIds.has(l.promise_id)) err(`levers.${l.id}`, `unknown promise_id "${l.promise_id}"`);
    for (const f of l.funding_options ?? []) {
      checkSource(`levers.${l.id}.funding.${f.id}`, f.source_id);
      if (f.target && !lineIds.has(f.target)) err(`levers.${l.id}.funding.${f.id}`, `target "${f.target}" is not a statement line`);
    }
  }

  const checkSettings = (where: string, settings: Settings) => {
    for (const [key, value] of Object.entries(settings)) {
      const [leverId, suffix] = key.split(".");
      const lever = leverById.get(leverId ?? "");
      if (!lever) {
        err(where, `setting "${key}" names no lever`);
        continue;
      }
      if (suffix === "funding") {
        if (!lever.funding_options?.some((f) => f.id === value)) err(where, `"${key}" = "${value}" is not a funding option`);
      } else if (suffix !== undefined) {
        err(where, `unknown setting suffix in "${key}"`);
      } else if (typeof value !== "number" || value < lever.min || value > lever.max) {
        err(where, `"${key}" = ${value} is outside ${lever.min}–${lever.max}`);
      }
    }
  };
  for (const p of seed.presets) checkSettings(`presets.${p.id}`, p.settings);

  for (const p of promises.promises) {
    const where = `promises.${p.id}`;
    if (p.lever_id && !leverById.has(p.lever_id)) err(where, `unknown lever_id "${p.lever_id}"`);
    if (p.lever_settings) checkSettings(where, p.lever_settings);
    if (p.lever_settings && !p.preset_label) err(where, "a card with lever_settings needs a preset_label");
    if (p.sources.length === 0) warn(where, "no sources yet; the card cannot be published (M3 makes this an error)");
    if (p.editor_check_required) warn(where, "needs editor check before publication");
  }

  const { income_tax, employee_ni } = seed.tax;
  if (!leverById.has(income_tax.basic_rate_lever)) err("tax.income_tax", `unknown lever "${income_tax.basic_rate_lever}"`);
  if (!leverById.has(employee_ni.main_rate_lever)) err("tax.employee_ni", `unknown lever "${employee_ni.main_rate_lever}"`);
  return issues;
}

export function parseSeed(raw: RawSeed = RAW_SEED): { seed: Seed | null; issues: SeedIssue[] } {
  const statement = StatementSeed.safeParse(raw.statement);
  const levers = LeversSeed.safeParse(raw.levers);
  const promises = PromisesSeed.safeParse(raw.promises);
  const presets = PresetsSeed.safeParse(raw.presets);
  const tax = TaxSeed.safeParse(raw.tax);
  const issues: SeedIssue[] = [
    ...(statement.error ? zodIssues("uk_fy2025-26_pnl.json", statement.error) : []),
    ...(levers.error ? zodIssues("levers.json", levers.error) : []),
    ...(promises.error ? zodIssues("promises.json", promises.error) : []),
    ...(presets.error ? zodIssues("presets.json", presets.error) : []),
    ...(tax.error ? zodIssues("uk_tax_2025-26.json", tax.error) : []),
  ];
  if (!statement.success || !levers.success || !promises.success || !presets.success || !tax.success) {
    return { seed: null, issues };
  }
  const seed: Seed = {
    statement: statement.data,
    levers: levers.data,
    promises: promises.data,
    presets: [...presets.data.presets, ...promisePresets(promises.data)],
    tax: tax.data,
    sources: [...statement.data.meta.sources, ...levers.data.meta.sources],
  };
  return { seed, issues: [...issues, ...crossCheck(seed)] };
}

/** Parse and cross-check the seed files. Throws on any error; warnings are left to `pnpm validate`. */
export function loadSeed(raw: RawSeed = RAW_SEED): Seed {
  const { seed, issues } = parseSeed(raw);
  const errors = issues.filter((i) => i.level === "error");
  if (!seed || errors.length) {
    throw new Error(`Seed data failed validation:\n${errors.map((e) => `  ${e.where}: ${e.message}`).join("\n")}`);
  }
  return seed;
}

export type { Lever };
export { fundingKey };
