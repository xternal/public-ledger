/**
 * The alerts job (PRD F7), run by .github/workflows/alerts.yml.
 *
 *   pnpm alerts -- diff --before <sha> --after <sha>   detect changes on main, send instant alerts,
 *                                                      queue weekly digests, update submitters;
 *                                                      then announce data changes (below)
 *   pnpm alerts -- digest                              send the weekly digest; in the first week of a
 *                                                      UK month, also the monthly "coming due" list
 *   pnpm alerts -- maintain                            daily clean-up (old deliveries, unconfirmed
 *                                                      sign-ups and additions, rate-limit salts), then announce
 *                                                      data changes (below)
 *   pnpm alerts -- data [--after <sha>]                announce data changes only
 *   pnpm alerts -- due                                 send this month's "coming due" list now
 *   add --dry-run to print what would happen without writing or sending anything
 *
 * Data changes (contracts, new editions of the headline figures; PRE_SHIP_REVIEW
 * F8) are read from data/build between the last commit already announced (kept
 * in the database) and this one. Data refreshes that touch nothing in content/
 * do not trigger the push run, so the daily maintenance run picks them up: a
 * data change is announced within a day, with no change to the workflow.
 *
 * Production reads every secret from the environment (docs/OPERATIONS.md §8).
 * In CI without DATABASE_URL it prints "Alerts not configured: skipping" and
 * succeeds. Locally without DATABASE_URL it uses its own PGlite database in
 * ./.data/pglite; never point PGLITE_DIR at the dev server's database while the
 * dev server is running (PGlite allows one process per directory).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, loadConfig, mailerFor, telegramSender, type Config, type Db } from "../packages/server/src/index";
import {
  actorsFrom,
  cardTitle,
  dataSnapshotsFor,
  diffContent,
  diffData,
  gitRunner,
  isFirstWeek,
  parseCard,
  partyOf,
  processChanges,
  resolveCommit,
  runComingDue,
  runDataAlerts,
  runDigest,
  runMaintenance,
  snapshotsFor,
  DELIVERY_RETENTION_DAYS,
  type DueCard,
} from "../packages/server/src/alerts/index";
import { errorText } from "../packages/server/src/alerts/log";
import { DEADLINE_WINDOWS, dueInWindow, ukDay, windowPhrase } from "../packages/schema/src/deadlines";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const command = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--dry-run"));
const COMMANDS = ["diff", "digest", "maintain", "data", "due"];
const git = gitRunner(root);

function usage(): never {
  console.error("Usage: pnpm alerts -- diff --before <sha> --after <sha> | digest | maintain | data [--after <sha>] | due  [--dry-run]");
  process.exit(2);
}

/** Cards in this checkout, with their headings for digests and the monthly list. */
function cardsFromDisk(): DueCard[] {
  const read = (dir: string) =>
    new Map(
      readdirSync(join(root, dir))
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => [`${dir}/${f}`, readFileSync(join(root, dir, f), "utf8")] as [string, string]),
    );
  const actors = actorsFrom(read("content/actors"));
  return [...read("content/promises").values()].flatMap((text) => {
    const card = parseCard(text);
    return card ? [{ id: card.id, deadline: card.deadline, status: card.status, title: cardTitle(card, actors) }] : [];
  });
}

function warnCaptured(config: Config, captured: unknown[]) {
  if (captured.length && config.production) console.warn(`TELEGRAM_BOT_TOKEN is not set: ${captured.length} Telegram message(s) were not sent.`);
}

/** Data changes from the cursor to `target`. Returns whether every message went out. */
async function announceData(db: Db, config: Config, captured: { chatId: string; text: string }[], target?: string): Promise<boolean> {
  const run = await runDataAlerts({ db, config, mailer: mailerFor(config, db), telegram: telegramSender(config, captured) }, git, { target });
  const range = `${run.range.before?.slice(0, 7) ?? "(none)"}..${run.range.after.slice(0, 7)}`;
  if (run.outcome === "started") console.log(`Data alerts start at ${range.slice(-7)}: nothing announced this time.`);
  else if (run.outcome === "reset") console.log(`Data alerts: history changed under the last announced commit; starting again at ${range.slice(-7)}.`);
  else if (run.outcome === "behind") console.log(`Data changes: already announced up to ${run.range.before?.slice(0, 7)}.`);
  else {
    console.log(`Data changes ${range}: ${run.events.length}`);
    for (const e of run.events) console.log(`  [${e.change_type}] ${e.promise_id ?? "statement"}: ${e.summary}`);
    if (run.fanOut) console.log(`Sent ${run.fanOut.emails} email(s) and ${run.fanOut.telegrams} Telegram message(s); queued ${run.fanOut.queued} for digests; ${run.fanOut.failed} failed.`);
  }
  return !run.fanOut?.failed;
}

/** Dry run: print the data changes between two commits, touching nothing. */
function printData(beforeRef: string | undefined, afterRef: string) {
  const after = resolveCommit(git, afterRef);
  const before = resolveCommit(git, beforeRef) ?? (after ? resolveCommit(git, `${after}^`) : null);
  if (!after || !before) return console.log("Data changes: no range to compare.");
  const snap = dataSnapshotsFor(git, before, after);
  const events = diffData(snap.before, snap.after, { commit: after, siteUrl: loadConfig({ ...process.env, LEDGER_ENV: undefined }).siteUrl, actors: snap.actors });
  console.log(`Data changes ${before.slice(0, 7)}..${after.slice(0, 7)}: ${events.length}`);
  for (const e of events) console.log(`  [${e.change_type}] ${e.promise_id ?? "statement"}: ${e.summary}`);
}

async function main() {
  if (!command || !COMMANDS.includes(command)) usage();
  const needsDb = !(dryRun && ["diff", "data", "due"].includes(command));
  if (needsDb && process.env.CI && !process.env.DATABASE_URL) {
    console.log("Alerts not configured: skipping");
    return;
  }
  // A dry run sends nothing, so development fallbacks are harmless there.
  const config = loadConfig(dryRun ? { ...process.env, LEDGER_ENV: undefined } : process.env);
  const captured: { chatId: string; text: string }[] = [];

  if (command === "due" && dryRun) {
    const cards = cardsFromDisk();
    const today = ukDay();
    for (const w of DEADLINE_WINDOWS) {
      const due = dueInWindow(cards, w, today);
      console.log(`${w}: ${due.length} due ${windowPhrase(w, today)}${due.length ? `: ${due.map((c) => c.id).join(", ")}` : ""}`);
    }
    return;
  }

  if (command === "diff") {
    const after = flag("--after") ?? "HEAD";
    const snap = snapshotsFor(git, flag("--before"), after);
    const events = diffContent(snap.before, snap.after, { commit: snap.range.after, siteUrl: config.siteUrl, actors: snap.actors });
    console.log(`Changes ${snap.range.before?.slice(0, 7) ?? "(none)"}..${snap.range.after.slice(0, 7)}: ${events.length}`);
    for (const e of events) console.log(`  [${e.change_type}] ${e.promise_id}: ${e.summary}`);
    if (dryRun) {
      printData(flag("--before"), after);
      return;
    }
    const db = await getDb(config);
    try {
      if (events.length) {
        const report = await processChanges(events, {
          db,
          config,
          mailer: mailerFor(config, db),
          telegram: telegramSender(config, captured),
          partyOf: (id) => partyOf(snap.actors, id),
        });
        console.log(
          `Stored ${report.newChanges} new change(s). Sent ${report.emails} email(s) and ${report.telegrams} Telegram message(s); queued ${report.queued} for digests; ${report.submitterUpdates} submitter update(s); ${report.failed} failed.`,
        );
        if (report.failed) process.exitCode = 1; // failed sends are retried when this run is re-run
      }
      if (!(await announceData(db, config, captured, snap.range.after))) process.exitCode = 1;
      warnCaptured(config, captured);
    } finally {
      await db.close();
    }
    return;
  }

  if (command === "data" && dryRun) {
    printData(flag("--before"), flag("--after") ?? "HEAD");
    return;
  }

  const db = await getDb(config);
  try {
    if (command === "data") {
      if (!(await announceData(db, config, captured, flag("--after")))) process.exitCode = 1;
      warnCaptured(config, captured);
      return;
    }
    const comingDue = async (force: boolean) => {
      const report = await runComingDue(
        { db, config, mailer: mailerFor(config, db), telegram: telegramSender(config, captured) },
        { cards: cardsFromDisk(), commit: resolveCommit(git, "HEAD") ?? "unknown", force },
      );
      if (report.skipped) console.log("Coming due: sent in the first week of a month only.");
      else console.log(`Coming due: ${report.emails} email(s), ${report.telegrams} Telegram message(s), ${report.failed} failed.`);
      if (report.failed) process.exitCode = 1; // failed lists are retried by the next run this month
    };
    if (command === "due") {
      await comingDue(true);
      warnCaptured(config, captured);
      return;
    }
    if (command === "digest") {
      if (dryRun) {
        const [r] = await db.query<{ subs: string; changes: string }>(
          "SELECT count(DISTINCT subscription_id) AS subs, count(*) AS changes FROM delivery WHERE status = 'queued_digest'",
        );
        console.log(`Dry run: ${r?.subs ?? 0} subscription(s) have ${r?.changes ?? 0} queued change(s).`);
        if (isFirstWeek(ukDay())) console.log("Dry run: this run would also send this month's coming-due list.");
        return;
      }
      const titles = new Map(cardsFromDisk().map((c) => [c.id, c.title]));
      const report = await runDigest({ db, config, mailer: mailerFor(config, db), telegram: telegramSender(config, captured) }, { titles });
      console.log(`Digest: ${report.emails} email(s), ${report.telegrams} Telegram message(s), ${report.changes} change(s) listed, ${report.failed} failed.`);
      if (report.failed) process.exitCode = 1; // failed digests go back to the queue for next week
      await comingDue(false);
      warnCaptured(config, captured);
      return;
    }
    if (dryRun) {
      const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000).toISOString();
      const [r] = await db.query<{ n: string }>("SELECT count(*) AS n FROM delivery WHERE at < $1", [cutoff]);
      console.log(`Dry run: ${r?.n ?? 0} delivery record(s) older than ${DELIVERY_RETENTION_DAYS} days would be deleted.`);
      return;
    }
    const report = await runMaintenance(db);
    console.log(
      `Maintenance: deleted ${report.deliveries} old delivery record(s), ${report.unconfirmed} unconfirmed sign-up(s), ${report.pendingAdditions} unconfirmed addition(s), ${report.outbox} old outbox mail(s); pruned rate-limit state.`,
    );
    if (!(await announceData(db, config, captured))) process.exitCode = 1;
    warnCaptured(config, captured);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error("Alerts job failed:", errorText(e));
  process.exit(1);
});
