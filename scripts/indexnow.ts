/**
 * pnpm indexnow: tell search engines that use IndexNow (Bing, Yandex, Seznam,
 * Naver, Yep) which Public Ledger pages changed, so they re-read them now.
 *
 *   pnpm indexnow -- --before <sha> --after <sha>   the pages of cards that changed between two commits,
 *                                                   once the live site serves them (waits up to 6 minutes)
 *   pnpm indexnow -- --all                          every URL in the live sitemap (the first time, or after a big change)
 *   pnpm indexnow -- <url> [<url>…]                 just these URLs
 *   add --dry-run to print the URLs without sending them, --no-wait to skip waiting for the deploy
 *
 * The site is SITE_URL (or --site <url>), and must be the public https site:
 * engines check the key file at <site>/<key>.txt (apps/web/public/). The
 * alerts job runs the same submission after every content change on main
 * (scripts/alerts.ts), so this command is for the first run and for by hand.
 */
import { join } from "node:path";
import { canSubmit, indexNowKey, indexNowPayload, submitIndexNow, type FetchLike } from "../packages/server/src/seo/indexnow";
import { indexNowForChanges } from "../packages/server/src/seo/indexnow-changes";
import { gitRunner } from "../packages/server/src/alerts/git";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const site = (flag("--site") ?? process.env.SITE_URL ?? "").replace(/\/$/, "");
const fetchFn: FetchLike = (url, init) => fetch(url, init);

function usage(): never {
  console.error("Usage: pnpm indexnow -- --before <sha> --after <sha> | --all | <url>…  [--site <url>] [--dry-run] [--no-wait]");
  process.exit(2);
}

async function main() {
  if (!site) {
    console.error("Set SITE_URL (or pass --site https://…): the public site whose pages changed.");
    process.exit(2);
  }
  if (!canSubmit(site)) {
    console.error(`${site} is not a public https site; IndexNow only takes pages engines can fetch.`);
    process.exit(2);
  }
  const key = indexNowKey(join(root, "apps/web/public"));

  if (flag("--after") || flag("--before")) {
    const report = await indexNowForChanges({
      git: gitRunner(root),
      before: flag("--before"),
      after: flag("--after") ?? "HEAD",
      siteUrl: site,
      key,
      fetchFn,
      dryRun,
      wait: !args.includes("--no-wait"),
      log: console.log,
    });
    if (report.waitingFor.length) process.exitCode = 1;
    return;
  }

  let urls: string[];
  if (args.includes("--all")) {
    const res = await fetch(`${site}/sitemap.xml`);
    if (!res.ok) throw new Error(`${site}/sitemap.xml answered ${res.status}`);
    urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
    urls.push(`${site}/llms.txt`, `${site}/llms-full.txt`);
  } else {
    urls = args.filter((a, i) => /^https?:\/\//.test(a) && args[i - 1] !== "--site");
    if (!urls.length) usage();
  }
  const payload = indexNowPayload(site, key, urls);
  if (dryRun) {
    console.log(`Dry run: would submit ${payload.urlList.length} URL(s) for ${payload.host}:`);
    for (const u of payload.urlList) console.log(`  ${u}`);
    return;
  }
  const { submitted, statuses } = await submitIndexNow(payload, fetchFn);
  console.log(`IndexNow accepted ${submitted} URL(s) for ${payload.host} (HTTP ${statuses.join(", ")}).`);
}

main().catch((e) => {
  console.error("IndexNow failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
