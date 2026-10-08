import { snapshotsFor, type GitRunner } from "../alerts/git";
import { changedCard, indexNowPayload, pagesForCards, submitIndexNow, waitForDeploy, type ChangedCard, type FetchLike } from "./indexnow";

/**
 * After cards change on main: wait until the live site serves the new
 * version of each changed card, then submit their pages to IndexNow. Cards
 * the deploy has not reached in time are left out and named, so they can be
 * sent later by hand (pnpm indexnow -- --before … --after …); engines are
 * never pointed at a page that has not changed yet.
 */
export interface ChangesInput {
  git: GitRunner;
  before?: string | null;
  after: string;
  siteUrl: string;
  key: string;
  fetchFn: FetchLike;
  dryRun?: boolean;
  /** Wait for the deploy before submitting (default true). */
  wait?: boolean;
  waitOptions?: Parameters<typeof waitForDeploy>[3];
  log?: (line: string) => void;
}

export async function indexNowForChanges(input: ChangesInput): Promise<{ urls: string[]; submitted: number; waitingFor: string[] }> {
  const log = input.log ?? (() => {});
  const snap = snapshotsFor(input.git, input.before, input.after);
  const cards = [...snap.after.values()].map(changedCard).filter((c): c is ChangedCard => !!c);
  const partyOf = (id: string) => snap.actors.get(id)?.party_id;
  if (!cards.length) {
    log("IndexNow: no card changed; nothing to submit.");
    return { urls: [], submitted: 0, waitingFor: [] };
  }
  if (input.dryRun) {
    const urls = pagesForCards(cards, input.siteUrl, partyOf);
    log(`IndexNow dry run: would submit ${urls.length} URL(s) once the deploy shows ${cards.map((c) => c.id).join(", ")}:`);
    urls.forEach((u) => log(`  ${u}`));
    return { urls, submitted: 0, waitingFor: [] };
  }
  const live = input.wait === false ? cards : await waitForDeploy(cards, input.siteUrl, input.fetchFn, input.waitOptions);
  const waitingFor = cards.filter((c) => !live.includes(c)).map((c) => c.id);
  if (waitingFor.length) {
    log(
      `IndexNow: the live site does not show the new version of ${waitingFor.join(", ")} yet, so those are not submitted. ` +
        `Once it does: pnpm indexnow -- --before ${snap.range.before ?? "<sha>"} --after ${snap.range.after}`,
    );
  }
  if (!live.length) return { urls: [], submitted: 0, waitingFor };
  const urls = pagesForCards(live, input.siteUrl, partyOf);
  const { submitted, statuses } = await submitIndexNow(indexNowPayload(input.siteUrl, input.key, urls), input.fetchFn);
  log(`IndexNow accepted ${submitted} URL(s) for ${live.map((c) => c.id).join(", ")} (HTTP ${statuses.join(", ")}).`);
  return { urls, submitted, waitingFor };
}
