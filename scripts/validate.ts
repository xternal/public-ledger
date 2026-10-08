/**
 * pnpm validate: schemas, cross-file references, the balance check, a lint
 * that keeps data out of components, and the exact-match check on intake
 * drafts. Exits non-zero on any error; warnings (cards not yet publishable)
 * are printed but do not fail. A draft still in content/drafts/ is an error,
 * so an intake PR cannot be merged until editors have turned every draft into
 * a card or deleted it; the intake job itself passes --allow-drafts.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseSeed } from "@ledger/schema/seed";
import { loadPeople } from "@ledger/schema/people";
import { BALANCE_TOLERANCE_BN, appendOnlyIssues } from "@ledger/schema";
import { baseSettings, compute, createModel } from "@ledger/engine";
import { checkDrafts } from "../packages/server/src/harvest/drafts";

const root = join(import.meta.dirname, "..");
const errors: string[] = [];
const warnings: string[] = [];

// 1. Schemas and cross-file checks
const { seed, issues } = parseSeed();
for (const i of issues) (i.level === "error" ? errors : warnings).push(`${i.where}: ${i.message}`);
// /people (M6): population and long-term spending projections.
try {
  loadPeople();
} catch (e) {
  errors.push((e as Error).message);
}

// 2. Balance: receipts + borrowing == spending, at base and for every preset and card scenario
if (seed) {
  const model = createModel(seed.statement, seed.levers);
  const base = baseSettings(model);
  const scenarios = [
    { name: "base", settings: base },
    ...seed.presets.map((p) => ({ name: `preset ${p.id}`, settings: { ...base, ...p.settings } })),
  ];
  for (const s of scenarios) {
    const r = compute(model, s.settings);
    const rec = Object.values(r.receipts).reduce((a, b) => a + b, 0);
    const sp = Object.values(r.spending).reduce((a, b) => a + b, 0);
    const gap = rec + r.totals.borrowing_bn - sp;
    if (Math.abs(gap) > BALANCE_TOLERANCE_BN) errors.push(`balance (${s.name}): off by ${gap.toFixed(3)}bn`);
  }
}

// 3. No data in components (invariant 1): money, units and years must come from the seed
const DATA_LITERAL = [
  // "per £1" is a unit, not a figure
  { re: /£\s?(?!1(?![\d,.]))\d/, why: "a £ amount" },
  { re: /\b\d[\d,.]*\s?(bn|tn)\b/, why: "a £bn/£tn figure" },
  { re: /\b\d+(\.\d+)?pp\b/, why: "a percentage-point figure" },
  { re: /\b20[1-3]\d\b/, why: "a year" },
];
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx|ts)$/.test(name)) yield p;
  }
}
for (const file of files(join(root, "apps/web/components"))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (/^\s*\*/.test(line)) return; // JSDoc
    for (const { re, why } of DATA_LITERAL) {
      if (re.test(code)) errors.push(`${relative(root, file)}:${i + 1}: ${why} in a component; move it to data/seed`);
    }
  });
}

// 4. Promise history is append-only (invariant 5): compare every card with the base branch.
const baseArg = process.argv.indexOf("--base");
const baseRef = baseArg >= 0 ? process.argv[baseArg + 1] : null;
if (baseRef) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let baseFiles: string[] = [];
  try {
    baseFiles = git("ls-tree", "--name-only", `${baseRef}:content/promises`).split("\n").filter((f) => f.endsWith(".yaml"));
  } catch {
    warnings.push(`append-only: ${baseRef} has no content/promises yet; nothing to compare`);
  }
  for (const name of baseFiles) {
    const path = join(root, "content", "promises", name);
    let now: unknown;
    try {
      now = parseYaml(readFileSync(path, "utf8"));
    } catch {
      errors.push(`content/promises/${name}: removed or unreadable; published cards cannot be deleted`);
      continue;
    }
    const was = parseYaml(git("show", `${baseRef}:content/promises/${name}`));
    for (const issue of appendOnlyIssues(was, now)) errors.push(`content/promises/${name}: ${issue}`);
  }
  console.log(`append-only check against ${baseRef}: ${baseFiles.length} published card(s)`);
}

// 5. Intake drafts (M4): every quote must be exactly its span of the stored source text.
// Zero invented quotes is checked here, offline, for every draft in content/drafts/.
const drafts = checkDrafts(root);
errors.push(...drafts.errors);
// Unresolved drafts block a merge; the morning intake job, which opens the PR, allows them.
(process.argv.includes("--allow-drafts") ? warnings : errors).push(...drafts.warnings);
if (drafts.drafts) console.log(`intake drafts: ${drafts.drafts} checked against their stored sources`);

for (const w of warnings) console.log(`warn   ${w}`);
for (const e of errors) console.log(`error  ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
