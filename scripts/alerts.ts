/**
 * The alerts job (PRD F7), run by .github/workflows/alerts.yml.
 *
 *   pnpm alerts -- diff --before <sha> --after <sha>   detect changes on main, send instant alerts,
 *                                                      queue weekly digests, update submitters
 *   pnpm alerts -- digest                              send the weekly digest
 *   pnpm alerts -- maintain                            daily clean-up (old deliveries, unconfirmed
 *                                                      sign-ups, rate-limit salts)
 *   add --dry-run to print what would happen without writing or sending anything
 *
 * Production reads every secret from the environment (docs/OPERATIONS.md §8).
 * In CI without DATABASE_URL it prints "Alerts not configured: skipping" and
 * succeeds. Locally without DATABASE_URL it uses its own PGlite database in
 * ./.data/pglite; never point PGLITE_DIR at the dev server's database while the
 * dev server is running (PGlite allows one process per directory).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, loadConfig, mailerFor, telegramSender, type Config } from "../packages/server/src/index";
import {
  actorsFrom,
  cardTitle,
  diffContent,
  gitRunner,
  parseCard,
  partyOf,
  processChanges,
  runDigest,
  runMaintenance,
  snapshotsFor,
  DELIVERY_RETENTION_DAYS,
} from "../packages/server/src/alerts/index";
import { errorText } from "../packages/server/src/alerts/log";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const command = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--dry-run"));

function usage(): never {
  console.error("Usage: pnpm alerts -- diff --before <sha> --after <sha> | digest | maintain  [--dry-run]");
  process.exit(2);
}

/** Card headings for digests, from the content in this checkout. */
function titlesFromDisk(): Map<string, string> {
  const read = (dir: string) =>
    new Map(
      readdirSync(join(root, dir))
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => [`${dir}/${f}`, readFileSync(join(root, dir, f), "utf8")] as [string, string]),
    );
  const actors = actorsFrom(read("content/actors"));
  const titles = new Map<string, string>();
  for (const text of read("content/promises").values()) {
    const card = parseCard(text);
    if (card) titles.set(card.id, cardTitle(card, actors));
  }
  return titles;
}

function warnCaptured(config: Config, captured: unknown[]) {
  if (captured.length && config.production) console.warn(`TELEGRAM_BOT_TOKEN is not set: ${captured.length} Telegram message(s) were not sent.`);
}

async function main() {
  if (!command || !["diff", "digest", "maintain"].includes(command)) usage();
  const needsDb = !(dryRun && command === "diff");
  if (needsDb && process.env.CI && !process.env.DATABASE_URL) {
    console.log("Alerts not configured: skipping");
    return;
  }
  // A dry run sends nothing, so development fallbacks are harmless there.
  const config = loadConfig(dryRun ? { ...process.env, LEDGER_ENV: undefined } : process.env);
  const captured: { chatId: string; text: string }[] = [];

  if (command === "diff") {
    const after = flag("--after") ?? "HEAD";
    const snap = snapshotsFor(gitRunner(root), flag("--before"), after);
    const events = diffContent(snap.before, snap.after, { commit: snap.range.after, siteUrl: config.siteUrl, actors: snap.actors });
    console.log(`Changes ${snap.range.before?.slice(0, 7) ?? "(none)"}..${snap.range.after.slice(0, 7)}: ${events.length}`);
    for (const e of events) console.log(`  [${e.change_type}] ${e.promise_id}: ${e.summary}`);
    if (dryRun || !events.length) return;
    const db = await getDb(config);
    try {
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
      warnCaptured(config, captured);
      if (report.failed) process.exitCode = 1; // failed sends are retried when this run is re-run
    } finally {
      await db.close();
    }
    return;
  }

  const db = await getDb(config);
  try {
    if (command === "digest") {
      if (dryRun) {
        const [r] = await db.query<{ subs: string; changes: string }>(
          "SELECT count(DISTINCT subscription_id) AS subs, count(*) AS changes FROM delivery WHERE status = 'queued_digest'",
        );
        console.log(`Dry run: ${r?.subs ?? 0} subscription(s) have ${r?.changes ?? 0} queued change(s).`);
        return;
      }
      const report = await runDigest({ db, config, mailer: mailerFor(config, db), telegram: telegramSender(config, captured) }, { titles: titlesFromDisk() });
      console.log(`Digest: ${report.emails} email(s), ${report.telegrams} Telegram message(s), ${report.changes} change(s) listed, ${report.failed} failed.`);
      warnCaptured(config, captured);
      if (report.failed) process.exitCode = 1; // failed digests go back to the queue for next week
      return;
    }
    if (dryRun) {
      const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000).toISOString();
      const [r] = await db.query<{ n: string }>("SELECT count(*) AS n FROM delivery WHERE at < $1", [cutoff]);
      console.log(`Dry run: ${r?.n ?? 0} delivery record(s) older than ${DELIVERY_RETENTION_DAYS} days would be deleted.`);
      return;
    }
    const report = await runMaintenance(db);
    console.log(`Maintenance: deleted ${report.deliveries} old delivery record(s), ${report.unconfirmed} unconfirmed sign-up(s), ${report.outbox} old outbox mail(s); pruned rate-limit state.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error("Alerts job failed:", errorText(e));
  process.exit(1);
});
