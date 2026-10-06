/**
 * pnpm validate: schemas, cross-file references, the balance check and a
 * lint that keeps data out of components. Exits non-zero on any error;
 * warnings (cards not yet publishable) are printed but do not fail.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSeed } from "@ledger/schema/seed";
import { BALANCE_TOLERANCE_BN } from "@ledger/schema";
import { baseSettings, compute, createModel } from "@ledger/engine";

const root = join(import.meta.dirname, "..");
const errors: string[] = [];
const warnings: string[] = [];

// 1. Schemas and cross-file checks
const { seed, issues } = parseSeed();
for (const i of issues) (i.level === "error" ? errors : warnings).push(`${i.where}: ${i.message}`);

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

for (const w of warnings) console.log(`warn   ${w}`);
for (const e of errors) console.log(`error  ${e}`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
