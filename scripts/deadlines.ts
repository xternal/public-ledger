/**
 * Nightly: make silence visible (PRD F4, PROMISE_STANDARD §3).
 *
 * For every card whose deadline has passed without a terminal status, append
 * one automatic `deadline_missed` event. The status is not changed: an editor
 * confirms `quietly_dropped` (or records what happened) after 30 days.
 * Appends only, so the append-only check still passes.
 *
 *   pnpm deadlines            write the events
 *   pnpm deadlines --dry-run  list what would be written
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, YAMLSeq } from "yaml";

const root = join(import.meta.dirname, "..");
const dir = join(root, "content", "promises");
const dryRun = process.argv.includes("--dry-run");
const TERMINAL = new Set(["delivered", "failed", "quietly_dropped", "unscoreable"]);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

let written = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const path = join(dir, name);
  const doc = parseDocument(readFileSync(path, "utf8"));
  const card = doc.toJS() as { id: string; status: string; deadline?: string; events: { type: string }[] };
  if (!card.deadline || card.deadline >= today || TERMINAL.has(card.status)) continue;
  if (card.events.some((e) => e.type === "deadline_missed")) continue;
  const event = {
    date: today,
    type: "deadline_missed",
    text: "The deadline passed with no evidence of delivery recorded. An editor confirms or corrects this within 30 days.",
    auto: true,
  };
  console.log(`${card.id}: deadline ${card.deadline} passed (status ${card.status})`);
  if (dryRun) continue;
  (doc.get("events") as YAMLSeq).add(doc.createNode(event));
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
  written++;
}
console.log(dryRun ? "dry run: nothing written" : `${written} deadline_missed event(s) appended`);
