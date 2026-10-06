import { createHash } from "node:crypto";
import { cardTitle, currentVersion, parseCard, type LooseActor, type LooseCard, type LooseEvent } from "./content";
import { costRangeText, eventLabel, statusLabel, truncate, ukDate } from "./labels";

/**
 * Change detection (PRD F7): compare promise files before and after a merge to
 * main and describe each public change in plain English. Alerts fire on a new
 * card, a status change, a new timeline event (an automatic `deadline_missed`
 * has its own type), a new version (rewording), a change in the current cost
 * range, and a published right of reply.
 */

export type ChangeType = "new_card" | "status" | "event" | "deadline_missed" | "version" | "cost" | "reply";

export interface ChangeEvent {
  /** Stable: the same change in the same commit always gets the same id, so re-runs never duplicate. */
  id: string;
  promise_id: string;
  actor_id: string;
  policy_area: string;
  change_type: ChangeType;
  /** "Status changed: Promised → Funded" */
  summary: string;
  /** {siteUrl}/promise/{id} */
  url: string;
  commit_sha: string;
  /** Card heading for messages ("Andy Burnham: “…”"); not stored. */
  title: string;
  /** For submitter updates; not stored. */
  submission_ref?: string;
  evidence_url?: string;
}

export interface DiffOptions {
  /** The commit the changes were merged in (the `after` side). */
  commit: string;
  siteUrl: string;
  /** Actor names for headings and replies; ids are shown when missing. */
  actors?: Map<string, LooseActor>;
}

/**
 * Ids: sha256 of commit + promise + type + detail. History entries (cards,
 * events, versions, replies) are append-only (invariant 5), so the entry itself
 * identifies the change and the commit is left out: an overlapping manual
 * re-run cannot announce the same entry twice. Status and cost changes can
 * legitimately recur (a correction, then the real change), so they keep the commit.
 */
export function changeId(commit: string | null, promiseId: string, type: ChangeType, detail: string): string {
  return createHash("sha256")
    .update([commit ?? "history", promiseId, type, detail].join("\n"))
    .digest("hex");
}

const stable = (x: unknown) => JSON.stringify(x ?? null);
const eventKey = (e: LooseEvent) => stable({ date: e.date, type: e.type, text: e.text, evidence_url: e.evidence_url });

function cardsById(files: Map<string, string>): Map<string, LooseCard> {
  const out = new Map<string, LooseCard>();
  for (const text of files.values()) {
    const card = parseCard(text);
    if (card) out.set(card.id, card);
  }
  return out;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Change events between two snapshots of content/promises (path → YAML text). Deleted cards produce nothing. */
export function diffContent(before: Map<string, string>, after: Map<string, string>, opts: DiffOptions): ChangeEvent[] {
  const was = cardsById(before);
  const now = cardsById(after);
  const site = opts.siteUrl.replace(/\/$/, "");
  const name = (id: string | undefined) => (id && opts.actors?.get(id)?.name) || id || "Someone";
  const events: ChangeEvent[] = [];

  for (const id of [...now.keys()].sort()) {
    const card = now.get(id)!;
    const old = was.get(id);
    const base = {
      promise_id: card.id,
      actor_id: card.actor_id,
      policy_area: card.policy_area,
      url: `${site}/promise/${card.id}`,
      commit_sha: opts.commit,
      title: cardTitle(card, opts.actors),
    };
    const add = (change_type: ChangeType, summary: string, idCommit: string | null, detail: string, extra: Partial<ChangeEvent> = {}) =>
      events.push({ ...base, ...extra, id: changeId(idCommit, card.id, change_type, detail), change_type, summary });

    if (!old) {
      const words = currentVersion(card)?.text ?? "";
      add("new_card", `New promise card: ${name(card.actor_id)}, “${truncate(words, 160)}”`, null, card.id, card.submission_ref ? { submission_ref: card.submission_ref } : {});
      continue;
    }

    if (old.status !== card.status) {
      add("status", `Status changed: ${statusLabel(old.status)} → ${statusLabel(card.status)}`, opts.commit, `${old.status}->${card.status}`);
    }

    const oldNumbers = new Set(old.versions.map((v, i) => v.version ?? i + 1));
    card.versions.forEach((v, i) => {
      const n = v.version ?? i + 1;
      if (oldNumbers.has(n) || n === 1) return;
      const prev = card.versions[i - 1]?.text ?? "";
      add("version", `Reworded: “${truncate(prev, 200)}” → “${truncate(v.text ?? "", 200)}”`, null, stable({ n, text: v.text }));
    });

    const oldCost = currentVersion(old)?.parameters?.how_much_bn_per_year ?? null;
    const newCost = currentVersion(card)?.parameters?.how_much_bn_per_year ?? null;
    if (stable(oldCost) !== stable(newCost)) {
      add("cost", `Cost changed: now ${lower(costRangeText(newCost))}, was ${lower(costRangeText(oldCost))}`, opts.commit, `${stable(oldCost)}->${stable(newCost)}`);
    }

    const seen = new Set(old.events.map(eventKey));
    for (const e of card.events) {
      const key = eventKey(e);
      if (seen.has(key)) continue;
      const text = truncate(e.text ?? "", 280);
      const extra = e.evidence_url ? { evidence_url: e.evidence_url } : {};
      if (e.type === "deadline_missed") {
        const due = card.deadline ? ` (${ukDate(card.deadline)})` : "";
        add("deadline_missed", `Deadline passed${due}: ${text}`, null, key, extra);
      } else {
        add("event", `${eventLabel(e.type ?? "")}${e.date ? `, ${ukDate(e.date)}` : ""}: ${text}`, null, key, extra);
      }
    }

    const seenReplies = new Set(old.replies.map(stable));
    for (const r of card.replies) {
      if (seenReplies.has(stable(r))) continue;
      add("reply", `Reply from ${name(r.from_actor_id)}: ${truncate(r.text ?? "", 280)}`, null, stable(r));
    }
  }
  return events;
}
