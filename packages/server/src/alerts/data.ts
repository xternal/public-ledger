import { cardTitle, parseCard, type LooseActor, type LooseCard } from "./content";
import { changeId, type ChangeEvent } from "./diff";
import { CONTRACT_STATUSES, displayName, gbpBnText, moneyText, signedMoneyText, signedPctText, truncate, ukDate } from "./labels";

/**
 * Data alerts (PRE_SHIP_REVIEW F8): change events from data/build, kept to the
 * few a reader cares about, numbers first.
 *
 * - `contract`: a contract linked to a card (and shown on it: funded or later)
 *   gained a snapshot, because its value or dates moved, or appeared on the
 *   card for the first time. Goes to followers of the promise, its actor, party
 *   and area, as content changes do.
 * - `edition`: a new edition (vintage) of the Statement's figures for a year,
 *   such as a new OBR forecast or ONS outturn release, that changes what the
 *   Statement shows: borrowing, income or spending. Belongs to no promise, so
 *   only people who follow everything hear about it.
 *
 * Like diffContent, this compares two snapshots of files and is pure, so tests
 * use fixtures. Contract snapshots and editions are append-only history, so
 * their ids leave the commit out: an overlapping run cannot announce one twice.
 */

/** One side of a data diff: files as text, keyed as below. */
export interface DataSide {
  /** content/promises path → YAML: every card at this commit (links and status decide what is shown). */
  promises: Map<string, string>;
  /** Contract key → JSON (data/build/contracts/<key>.json). A missing key means not fetched at this commit. */
  contracts: Map<string, string>;
  /** Fiscal year → JSON (data/build/statements/<year>.json). */
  statements: Map<string, string>;
}

export interface DataDiffOptions {
  commit: string;
  siteUrl: string;
  actors?: Map<string, LooseActor>;
}

// ---------------------------------------------------------------- loose readers (the alerts job must not fail on a half-valid file)

export interface LooseSnapshot {
  fetched_at: string;
  value: { amount: number; currency: string };
  end_date_planned: string;
  end_date_actual?: string;
}
export interface LooseContract {
  key: string;
  title: string;
  buyer: string;
  supplier: string;
  awarded_on?: string;
  notice_url?: string;
  snapshots: LooseSnapshot[];
}

function json(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (x: unknown) => (typeof x === "string" ? x : "");

export function parseContract(text: string | undefined): LooseContract | null {
  const d = json(text);
  if (!d || typeof d.key !== "string" || !Array.isArray(d.snapshots)) return null;
  const snapshots = (d.snapshots as Record<string, unknown>[]).flatMap((s): LooseSnapshot[] => {
    const v = s?.value as { amount?: unknown; currency?: unknown } | undefined;
    if (!s || typeof v?.amount !== "number" || typeof s.end_date_planned !== "string") return [];
    return [
      {
        fetched_at: str(s.fetched_at),
        value: { amount: v.amount, currency: typeof v.currency === "string" ? v.currency : "GBP" },
        end_date_planned: s.end_date_planned,
        ...(typeof s.end_date_actual === "string" ? { end_date_actual: s.end_date_actual } : {}),
      },
    ];
  });
  if (!snapshots.length) return null;
  const supplier = d.supplier as { name?: unknown } | undefined;
  return {
    key: d.key,
    title: str(d.title) || d.key,
    buyer: str(d.buyer),
    supplier: str(supplier?.name),
    awarded_on: str(d.awarded_on) || undefined,
    notice_url: str(d.notice_url) || undefined,
    snapshots,
  };
}

/** The Statement's headline figures for one year, as the alerts and the updates feed read them. */
export interface Headline {
  year: string;
  vintage: string;
  /** "OBR forecast, March 2026" */
  vintage_label: string;
  kind: string;
  borrowing: number;
  income: number;
  spending: number;
  /** Where the borrowing figure comes from, for the feed's provenance line. */
  source?: { id: string; title: string; url: string; published_on?: string };
  quality?: string;
}

const sum = (lines: unknown) => (Array.isArray(lines) ? lines.reduce((a: number, l: { bn?: unknown }) => a + (typeof l?.bn === "number" ? l.bn : 0), 0) : 0);

export function parseStatement(text: string | undefined): Headline | null {
  return headlineOf(json(text));
}

/** The headline figures of a Statement object (a data/build/statements file, or one year of the app's seed). */
export function headlineOf(statement: unknown): Headline | null {
  const d = statement && typeof statement === "object" && !Array.isArray(statement) ? (statement as Record<string, unknown>) : null;
  const meta = d?.meta as Record<string, unknown> | undefined;
  if (!d || !meta || typeof meta.fiscal_year !== "string" || typeof meta.vintage !== "string" || typeof d.borrowing_bn !== "number") return null;
  const prov = d.borrowing_provenance as { source_id?: unknown; quality?: unknown } | undefined;
  const sources = Array.isArray(meta.sources) ? (meta.sources as Record<string, unknown>[]) : [];
  const src = sources.find((s) => s?.id === prov?.source_id);
  return {
    year: meta.fiscal_year,
    vintage: meta.vintage,
    vintage_label: str(meta.vintage_label) || meta.vintage,
    kind: str(meta.kind) || "outturn",
    borrowing: d.borrowing_bn,
    income: sum(d.receipts),
    spending: sum(d.spending),
    ...(src ? { source: { id: str(src.id), title: str(src.title), url: str(src.url), ...(src.published_on ? { published_on: str(src.published_on) } : {}) } } : {}),
    ...(typeof prov?.quality === "string" ? { quality: prov.quality } : {}),
  };
}

// ---------------------------------------------------------------- wording

/** "£125,000, was £117,502 (+£7,498, +6.4%)" */
function valueChange(was: LooseSnapshot, now: LooseSnapshot): string {
  const cur = now.value.currency;
  const delta = now.value.amount - was.value.amount;
  const pct = was.value.amount ? `, ${signedPctText((delta / was.value.amount) * 100)}` : "";
  return `value ${moneyText(now.value.amount, cur)}, was ${moneyText(was.value.amount, was.value.currency)} (${signedMoneyText(delta, cur)}${pct})`;
}

/** What moved between two snapshots, numbers first; null when nothing a reader sees changed. */
export function contractChangeText(c: LooseContract, was: LooseSnapshot, now: LooseSnapshot): string | null {
  const parts: string[] = [];
  if (was.value.amount !== now.value.amount || was.value.currency !== now.value.currency) parts.push(valueChange(was, now));
  if (now.end_date_actual && now.end_date_actual !== was.end_date_actual) parts.push(`ended ${ukDate(now.end_date_actual)} (planned end ${ukDate(now.end_date_planned)})`);
  else if (now.end_date_planned !== was.end_date_planned) parts.push(`planned end ${ukDate(now.end_date_planned)}, was ${ukDate(was.end_date_planned)}`);
  if (!parts.length) return null;
  const what = [`“${truncate(c.title, 120)}”`, c.buyer ? displayName(c.buyer) : null].filter(Boolean).join(", ");
  return `Contract changed: ${parts.join("; ")}. ${what}.`;
}

/** "Contract linked: £117,502, “Photo Voltaic Solar Panels”, awarded 3 October 2025 by … to …. Planned end 31 March 2026." */
export function contractLinkedText(c: LooseContract): string {
  const s = c.snapshots[c.snapshots.length - 1]!;
  const parties = [c.buyer ? `by ${displayName(c.buyer)}` : null, c.supplier ? `to ${displayName(c.supplier)}` : null].filter(Boolean).join(" ");
  const awarded = c.awarded_on ? `, awarded ${ukDate(c.awarded_on)}${parties ? ` ${parties}` : ""}` : parties ? `, ${parties}` : "";
  const end = s.end_date_actual ? `Ended ${ukDate(s.end_date_actual)}.` : `Planned end ${ukDate(s.end_date_planned)}.`;
  return `Contract linked: ${moneyText(s.value.amount, s.value.currency)}, “${truncate(c.title, 120)}”${awarded}. ${end}`;
}

/** The figures the Statement shows changed? Compared as displayed, so a revision too small to show is not news. */
export function headlineChanged(was: Headline, now: Headline): boolean {
  return (["borrowing", "income", "spending"] as const).some((k) => gbpBnText(was[k]) !== gbpBnText(now[k]));
}

/** "2026-27 borrowing: £120bn, was £115bn. Income £1,310bn, was £1,304bn. OBR forecast, November 2026." */
export function editionText(now: Headline, was: Headline | null): string {
  if (!was) {
    return `${now.year} borrowing: ${gbpBnText(now.borrowing)}. Income ${gbpBnText(now.income)}, spending ${gbpBnText(now.spending)}. First figures for this year: ${now.vintage_label}.`;
  }
  // Borrowing always leads; income and spending only when they moved.
  const moved = (a: number, b: number) => (gbpBnText(a) === gbpBnText(b) ? null : `${gbpBnText(b)}, was ${gbpBnText(a)}`);
  const borrowing = moved(was.borrowing, now.borrowing) ?? `${gbpBnText(now.borrowing)}, unchanged`;
  const income = moved(was.income, now.income);
  const spending = moved(was.spending, now.spending);
  return [`${now.year} borrowing: ${borrowing}.`, income && `Income ${income}.`, spending && `Spending ${spending}.`, `${now.vintage_label}.`].filter(Boolean).join(" ");
}

/** Heading for edition changes in messages (they belong to no promise card). */
export const EDITION_TITLE = "The Statement: new official figures";

// ---------------------------------------------------------------- the diff

function cardsByPath(files: Map<string, string>): Map<string, LooseCard> {
  const out = new Map<string, LooseCard>();
  for (const text of files.values()) {
    const c = parseCard(text);
    if (c) out.set(c.id, c);
  }
  return out;
}

const shows = (c: LooseCard | undefined, key: string) => !!c && CONTRACT_STATUSES.includes(c.status) && c.contracts.includes(key);

/** Contract and edition events between two commits' data/build (and the cards that link contracts). */
export function diffData(before: DataSide, after: DataSide, opts: DataDiffOptions): ChangeEvent[] {
  const site = opts.siteUrl.replace(/\/$/, "");
  const events: ChangeEvent[] = [];
  const was = cardsByPath(before.promises);
  const now = cardsByPath(after.promises);

  for (const id of [...now.keys()].sort()) {
    const card = now.get(id)!;
    if (!CONTRACT_STATUSES.includes(card.status)) continue;
    const old = was.get(id);
    for (const key of card.contracts) {
      const c = parseContract(after.contracts.get(key));
      if (!c) continue; // linked but not fetched yet
      const prev = parseContract(before.contracts.get(key));
      const base = {
        promise_id: card.id,
        actor_id: card.actor_id,
        policy_area: card.policy_area,
        change_type: "contract" as const,
        url: `${site}/promise/${card.id}#contracts-${card.id}`,
        commit_sha: opts.commit,
        title: cardTitle(card, opts.actors),
        ...(card.deadline ? { deadline: card.deadline } : {}),
      };
      if (!prev || !shows(old, key)) {
        // First time readers can see this contract on the card: newly fetched, newly linked, or the card just reached "funded".
        events.push({ ...base, id: changeId(null, card.id, "contract", `${key}:linked`), summary: contractLinkedText(c) });
        continue;
      }
      for (let i = prev.snapshots.length; i < c.snapshots.length; i++) {
        const text = contractChangeText(c, c.snapshots[i - 1]!, c.snapshots[i]!);
        if (!text) continue;
        events.push({ ...base, id: changeId(null, card.id, "contract", `${key}:snapshot:${i}:${JSON.stringify(c.snapshots[i])}`), summary: text });
      }
    }
  }

  for (const year of [...after.statements.keys()].sort()) {
    const now = parseStatement(after.statements.get(year));
    if (!now) continue;
    const prev = parseStatement(before.statements.get(year));
    if (prev && prev.vintage === now.vintage) continue; // same edition: corrections are not a new edition
    if (prev && !headlineChanged(prev, now)) continue;
    events.push({
      id: changeId(null, `statement:${now.year}`, "edition", now.vintage),
      promise_id: null,
      actor_id: null,
      policy_area: null,
      change_type: "edition",
      summary: editionText(now, prev),
      url: `${site}/#statement`,
      commit_sha: opts.commit,
      title: EDITION_TITLE,
    });
  }
  return events;
}
