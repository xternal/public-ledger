import type { z } from "zod";
import bundleRaw from "../../../data/build/app.json";
import presetsRaw from "../../../data/seed/presets.json";
import type { StatementSeed } from "./statement";
import { STEP_TOLERANCE, fundingKey, stepValues, type Lever, type LeversSeed, type Settings } from "./levers";
import { ActorFile, PromiseFile, cardViews, type CardView } from "./content";
import { CONTRACT_SOURCES, ContractFile, contractKey } from "./contracts";
import { readContent, type RawContent } from "./content-files";
import { PresetsSeed, type Preset } from "./presets";
import type { TaxSeed } from "./tax";
import type { Source } from "./provenance";
import { AppBundle } from "./bundle";

/**
 * What the app reads. Numbers come from data/build/app.json (the ETL build);
 * promise cards and actors from content/*.yaml (M3); editorial presets from
 * data/seed/presets.json.
 */
export interface Seed {
  /** The base year's Statement: the year the sandbox runs on. */
  statement: StatementSeed;
  /** Every year with a Statement, for the year selector. */
  statements: Record<string, StatementSeed>;
  years: { period: string; kind: "outturn" | "estimate" | "forecast" }[];
  baseYear: string;
  builtAt: string;
  levers: LeversSeed;
  /** Promise cards joined with their actors and linked contracts, newest first. */
  cards: CardView[];
  /** Every fetched contract (data/build/contracts), linked or not. */
  contracts: ContractFile[];
  actors: ActorFile[];
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
  bundle: unknown;
  content: RawContent;
  presets: unknown;
}

let rawContent: RawContent | null = null;
/** The raw inputs, read once per process. Content is read from disk (Node only). */
export function rawSeed(): RawSeed {
  rawContent ??= readContent();
  return { bundle: bundleRaw, content: rawContent, presets: presetsRaw };
}

function zodIssues(file: string, error: z.ZodError): SeedIssue[] {
  return error.issues.map((i) => ({ level: "error", where: `${file}:${i.path.join(".")}`, message: i.message }));
}

function promisePresets(promises: PromiseFile[]): Preset[] {
  return promises
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

  const { statement, levers } = seed;
  for (const [year, s] of Object.entries(seed.statements)) {
    s.receipts.forEach((l) => checkSource(`${year}.receipts.${l.id}`, l.source_id));
    s.spending.forEach((l) => checkSource(`${year}.spending.${l.id}`, l.source_id));
    checkSource(`${year}.borrowing_provenance`, s.borrowing_provenance.source_id);
    for (const [key, p] of Object.entries(s.macro.provenance)) checkSource(`${year}.macro.${key}`, p.source_id);
  }

  const lineIds = new Set([...statement.receipts, ...statement.spending].map((l) => l.id));
  const leverById = new Map(levers.levers.map((l) => [l.id, l]));
  const promiseIds = new Set(seed.cards.map((c) => c.id));
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
      } else if (lever.effect.steps && !stepValues(lever).some((v) => Math.abs(v - value) < STEP_TOLERANCE)) {
        err(where, `"${key}" = ${value} is not one of the lever's steps (${stepValues(lever).join(", ")})`);
      }
    }
  };
  for (const p of seed.presets) checkSettings(`presets.${p.id}`, p.settings);

  const actorIds = new Set(seed.actors.map((a) => a.id));
  const parliamentIds = new Map<string, string>();
  for (const a of seed.actors) {
    if (a.party_id && !actorIds.has(a.party_id)) err(`actors.${a.id}`, `unknown party_id "${a.party_id}"`);
    // One Parliament id, one actor: /mp pages find people and parties by it.
    for (const key of [a.parliament_member_id && `member ${a.parliament_member_id}`, a.parliament_party_id && `party ${a.parliament_party_id}`]) {
      if (!key) continue;
      const other = parliamentIds.get(key);
      if (other) err(`actors.${a.id}`, `Parliament ${key} is already ${other}`);
      else parliamentIds.set(key, a.id);
    }
  }
  for (const c of seed.cards) {
    const p = c.file;
    const where = `promises.${p.id}`;
    if (p.lever_settings) checkSettings(where, p.lever_settings);
    if (p.editor_check_required) warn(where, "needs editor check before publication");
    if (!p.headline) warn(where, "no headline yet: titles and lists fall back to the quote cut short (content/README.md, Headline)");
    const current = p.versions[p.versions.length - 1]!;
    if (!current.quote_checked_on) warn(where, "quote not yet checked verbatim against its source");
    const fetched = new Set(seed.contracts.map((x) => x.key));
    const keys = p.contracts.map(contractKey);
    keys.forEach((k, i) => {
      if (keys.indexOf(k) !== i) err(`${where}.contracts`, `contract "${k}" is listed twice`);
      else if (!fetched.has(k)) warn(`${where}.contracts`, `contract "${k}" is not fetched yet; run python -m etl.contracts (the nightly job does)`);
    });
  }
  const linked = new Set(seed.cards.flatMap((c) => c.file.contracts.map(contractKey)));
  for (const c of seed.contracts) {
    if (!linked.has(c.key)) warn(`contracts.${c.key}`, "no card links this contract any more; it stays, unshown, so its history is kept");
  }

  const { income_tax, employee_ni } = seed.tax;
  if (!leverById.has(income_tax.basic_rate_lever)) err("tax.income_tax", `unknown lever "${income_tax.basic_rate_lever}"`);
  for (const id of [income_tax.higher_rate_lever, income_tax.additional_rate_lever, income_tax.personal_allowance_lever]) {
    if (id && !leverById.has(id)) err("tax.income_tax", `unknown lever "${id}"`);
  }
  if (!leverById.has(employee_ni.main_rate_lever)) err("tax.employee_ni", `unknown lever "${employee_ni.main_rate_lever}"`);
  return issues;
}

export function parseSeed(raw: RawSeed = rawSeed()): { seed: Seed | null; issues: SeedIssue[] } {
  const bundle = AppBundle.safeParse(raw.bundle);
  const presets = PresetsSeed.safeParse(raw.presets);
  const issues: SeedIssue[] = [
    ...(bundle.error ? zodIssues("data/build/app.json", bundle.error) : []),
    ...(presets.error ? zodIssues("presets.json", presets.error) : []),
  ];
  const fileName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.ya?ml$/, "");
  const actors: ActorFile[] = [];
  for (const f of raw.content.actors) {
    const r = ActorFile.safeParse(f.data);
    if (r.error) issues.push(...zodIssues(f.path, r.error));
    else if (r.data.id !== fileName(f.path)) issues.push({ level: "error", where: f.path, message: `id "${r.data.id}" does not match the file name` });
    else actors.push(r.data);
  }
  const promises: PromiseFile[] = [];
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const actorIds = new Set(actorById.keys());
  for (const f of raw.content.promises) {
    // Say plainly what is missing: a value, or null when no body in power is committed (PROMISE_STANDARD §11).
    if (f.data && typeof f.data === "object" && !("outcome_by" in f.data)) {
      issues.push({ level: "error", where: f.path, message: "outcome_by is missing: give the body that must act to deliver it (an actor id), or null when no body in power is committed (PROMISE_STANDARD §11)" });
      continue;
    }
    const r = PromiseFile.safeParse(f.data);
    if (r.error) issues.push(...zodIssues(f.path, r.error));
    else if (r.data.id !== fileName(f.path)) issues.push({ level: "error", where: f.path, message: `id "${r.data.id}" does not match the file name` });
    else if (!actorIds.has(r.data.actor_id)) issues.push({ level: "error", where: f.path, message: `unknown actor_id "${r.data.actor_id}"` });
    else if (r.data.outcome_by && !actorIds.has(r.data.outcome_by.actor_id))
      issues.push({ level: "error", where: f.path, message: `unknown outcome_by actor "${r.data.outcome_by.actor_id}"` });
    // The field follows the role, not the party: it names a government or public body, never a party or a person.
    else if (r.data.outcome_by && actorById.get(r.data.outcome_by.actor_id)!.kind !== "government")
      issues.push({ level: "error", where: f.path, message: `outcome_by names a body by its role (an actor of kind government, such as hm-government), not "${r.data.outcome_by.actor_id}"` });
    else if (r.data.brought_about_by && !actorIds.has(r.data.brought_about_by.actor_id))
      issues.push({ level: "error", where: f.path, message: `unknown brought_about_by actor "${r.data.brought_about_by.actor_id}"` });
    else promises.push(r.data);
  }
  const contracts: ContractFile[] = [];
  for (const f of raw.content.contracts ?? []) {
    const r = ContractFile.safeParse(f.data);
    if (r.error) issues.push(...zodIssues(f.path, r.error));
    else if (r.data.key !== fileName(f.path.replace(/\.json$/, ""))) issues.push({ level: "error", where: f.path, message: `key "${r.data.key}" does not match the file name` });
    else contracts.push(r.data);
  }
  if (!bundle.success || !presets.success || issues.some((i) => i.level === "error")) {
    return { seed: null, issues };
  }
  const b = bundle.data;
  const seed: Seed = {
    statement: b.statements[b.base_year]!,
    statements: b.statements,
    years: b.years,
    baseYear: b.base_year,
    builtAt: b.built_at,
    levers: b.levers,
    cards: cardViews(promises, actors, contracts),
    contracts,
    actors,
    presets: [...presets.data.presets, ...promisePresets(promises)],
    tax: b.tax,
    sources: [...b.sources, ...CONTRACT_SOURCES.filter((c) => !b.sources.some((s) => s.id === c.id))],
  };
  return { seed, issues: [...issues, ...crossCheck(seed)] };
}

/** Parse and cross-check the build bundle and seed files. Throws on any error; warnings are left to `pnpm validate`. */
export function loadSeed(raw: RawSeed = rawSeed()): Seed {
  const { seed, issues } = parseSeed(raw);
  const errors = issues.filter((i) => i.level === "error");
  if (!seed || errors.length) {
    throw new Error(`Seed data failed validation:\n${errors.map((e) => `  ${e.where}: ${e.message}`).join("\n")}`);
  }
  return seed;
}

export type { Lever };
export { fundingKey };
