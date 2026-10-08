import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { PolicyArea } from "@ledger/schema";
import { statusLabel } from "../alerts/labels";
import { absoluteUrl, areaPath } from "./cards";

/**
 * IndexNow (indexnow.org): tell search engines that use it (Bing, Yandex,
 * Seznam, Naver, Yep) which pages changed, so they re-read them within
 * minutes instead of on their next crawl. One POST to the shared endpoint
 * reaches them all. The key is public by design: the site serves it at
 * /<key>.txt (apps/web/public/), which proves we own the host.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** URLs per request, as the protocol allows. */
export const INDEXNOW_MAX_URLS = 10_000;
const KEY_FILE = /^([a-f0-9]{32})\.txt$/;

/** The key from its file in the web app's public folder: the one <32 hex>.txt whose content is its own name. */
export function indexNowKey(publicDir: string): string {
  const keys = readdirSync(publicDir).flatMap((name) => {
    const m = KEY_FILE.exec(name);
    return m && readFileSync(join(publicDir, name), "utf8").trim() === m[1] ? [m[1]!] : [];
  });
  if (keys.length !== 1) throw new Error(`expected one IndexNow key file (<32 hex>.txt holding its own name) in ${publicDir}, found ${keys.length}`);
  return keys[0]!;
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** Engines accept only URLs on the key's host; duplicates are dropped. */
export function indexNowPayload(siteUrl: string, key: string, urls: string[]): IndexNowPayload {
  const host = new URL(siteUrl).host;
  const urlList = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  return { host, key, keyLocation: absoluteUrl({ siteUrl }, `/${key}.txt`), urlList };
}

/** Only a public https site can be submitted; never localhost or a preview without a key file. */
export function canSubmit(siteUrl: string): boolean {
  try {
    const u = new URL(siteUrl);
    return u.protocol === "https:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !u.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * POST the URLs, in batches the protocol allows. 200 and 202 mean accepted
 * (202: the key is still being checked). Returns how many were accepted.
 */
export async function submitIndexNow(payload: IndexNowPayload, fetchFn: FetchLike, endpoint = INDEXNOW_ENDPOINT): Promise<{ submitted: number; statuses: number[] }> {
  const statuses: number[] = [];
  let submitted = 0;
  for (let i = 0; i < payload.urlList.length; i += INDEXNOW_MAX_URLS) {
    const urlList = payload.urlList.slice(i, i + INDEXNOW_MAX_URLS);
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ...payload, urlList }),
    });
    statuses.push(res.status);
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    submitted += urlList.length;
  }
  return { submitted, statuses };
}

/** What a changed card file says about itself, read loosely from its YAML. */
export interface ChangedCard {
  id: string;
  actor_id: string;
  policy_area: string;
  status: string;
  headline?: string;
  status_note?: string;
  events: string[];
}

export function changedCard(yamlText: string): ChangedCard | null {
  let d: Record<string, unknown>;
  try {
    d = parse(yamlText) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!d || typeof d.id !== "string") return null;
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  return {
    id: d.id,
    actor_id: str(d.actor_id) ?? "",
    policy_area: str(d.policy_area) ?? "",
    status: str(d.status) ?? "",
    headline: str(d.headline),
    status_note: str(d.status_note),
    events: (Array.isArray(d.events) ? d.events : []).flatMap((e) => (e && typeof e === "object" && typeof (e as { text?: unknown }).text === "string" ? [(e as { text: string }).text] : [])),
  };
}

/**
 * The pages a card change touches: the card and its Markdown, the ledger, its
 * policy-area page, its speaker's page and their party's, and llms-full.txt.
 */
export function pagesForCards(cards: ChangedCard[], siteUrl: string, partyOf: (actorId: string) => string | undefined = () => undefined): string[] {
  const paths = new Set<string>();
  for (const c of cards) {
    paths.add(`/promise/${c.id}`);
    paths.add(`/promise/${c.id}.md`);
    const area = PolicyArea.safeParse(c.policy_area);
    if (area.success) paths.add(areaPath(area.data));
    if (c.actor_id) paths.add(`/actor/${c.actor_id}`);
    const party = partyOf(c.actor_id);
    if (party) paths.add(`/actor/${party}`);
  }
  if (cards.length) ["/promises", "/llms-full.txt"].forEach((p) => paths.add(p));
  return [...paths].map((p) => absoluteUrl({ siteUrl }, p));
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Whether the live site already serves this version of a card: its Markdown
 * (/promise/<id>.md) shows the card's headline, status, status note and
 * every timeline entry. Used to wait for the deploy before pinging, so search
 * engines never fetch the old page.
 */
export function servesCard(markdown: string, card: ChangedCard): boolean {
  const text = flat(markdown);
  const signals = [
    ...(card.headline ? [`# ${flat(card.headline)}`] : []),
    `**Status:** ${statusLabel(card.status)}`,
    ...(card.status_note ? [flat(card.status_note)] : []),
    ...card.events.map(flat),
  ];
  return signals.every((s) => text.includes(s));
}

/**
 * Poll the live Markdown of each changed card until the deploy serves it, or
 * until `timeoutMs` passes. Returns the cards that are live.
 */
export async function waitForDeploy(
  cards: ChangedCard[],
  siteUrl: string,
  fetchFn: FetchLike,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<ChangedCard[]> {
  const { timeoutMs = 6 * 60_000, intervalMs = 20_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = opts;
  const live = new Set<string>();
  const start = now();
  for (;;) {
    for (const c of cards) {
      if (live.has(c.id)) continue;
      try {
        const res = await fetchFn(absoluteUrl({ siteUrl }, `/promise/${c.id}.md`), { headers: { "cache-control": "no-cache" } });
        if (res.ok && servesCard(await res.text(), c)) live.add(c.id);
      } catch {
        // Not reachable yet; try again on the next round.
      }
    }
    if (live.size === cards.length || now() - start >= timeoutMs) break;
    await sleep(intervalMs);
  }
  return cards.filter((c) => live.has(c.id));
}
