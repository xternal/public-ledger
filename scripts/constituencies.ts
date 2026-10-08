/**
 * Refresh data/reference/constituencies.json: the 650 Westminster
 * constituencies from the UK Parliament Members API (Open Parliament
 * Licence), with the slug each /mp/<slug> page uses.
 *
 *   pnpm constituencies
 *
 * Boundaries change only at a boundary review, so this is rarely needed.
 * Slugs are page addresses: if one changes, add a redirect from the old one.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchConstituencyList } from "../packages/server/src/mp/refresh";

const OUT = join(import.meta.dirname, "..", "data", "reference", "constituencies.json");

async function main(): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const next = await fetchConstituencyList((url, init) => fetch(url, init), today);

  let before: { constituencies: { slug: string }[] } | null = null;
  try {
    before = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    // first run
  }
  const gone = before ? before.constituencies.map((c) => c.slug).filter((s) => !next.constituencies.some((c) => c.slug === s)) : [];

  mkdirSync(dirname(OUT), { recursive: true });
  // One constituency a line, so a refresh reads as a short diff.
  const { constituencies, ...meta } = next;
  const head = JSON.stringify(meta, null, 2).slice(0, -2);
  writeFileSync(OUT, `${head},\n  "constituencies": [\n${constituencies.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]\n}\n`);
  console.log(`Wrote ${next.constituencies.length} constituencies to ${OUT}.`);
  if (gone.length) console.log(`Slugs no longer in the list (add redirects): ${gone.join(", ")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
