import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Document, isSeq, parseDocument, stringify, type Node, type YAMLMap } from "yaml";
import type { SubmissionView } from "./submissions";

/**
 * Drafts editors finish in a pull request (PROMISE_STANDARD §8, invariant 8).
 * A new promise becomes a skeleton card full of TODO markers; it is meant to
 * fail validation until editors have filled them in, so CI tells them what is
 * left. Evidence becomes one appended event (append-only, like scripts/deadlines.ts).
 *
 * Reader text and language-model suggestions are untrusted: the reader's words
 * go in as values only where the schema needs them (the URL, the quote), and
 * every model suggestion is a YAML comment, never a value.
 */

export interface DraftFile {
  /** Repository path, e.g. content/promises/uk-free-bus-travel-2026.yaml */
  path: string;
  promiseId: string;
  yaml: string;
  mode: "new" | "append";
  /** False when the evidence event is already in the card (nothing to change). */
  changed: boolean;
}

const PROMISE_ID = /^[a-z0-9-]+$/;
const TODO = "TODO";
const POLICY_AREAS = "taxes, social_protection, health, education, economic_affairs, defence, public_order, general_services, housing_env, culture";
const VENUES = "manifesto, speech, debate, tv, interview, press_release, parliament, social";

const oneLine = (s: string, max = 300) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function slug(words: string, max = 5): string {
  return words
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/£/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "and", "of", "to", "we", "will", "i", "our", "for", "in", "on", "be", "is"].includes(w))
    .slice(0, max)
    .join("-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-|-$/g, "");
}

/** A suggested card id; editors confirm or rename it (and the file) in the PR. */
export function suggestPromiseId(s: Pick<SubmissionView, "id" | "matched_quote" | "claimed_quote" | "received_at">, existing: Set<string> = new Set()): string {
  const year = s.received_at.slice(0, 4);
  const words = slug(s.matched_quote?.text ?? s.claimed_quote ?? "");
  let id = words ? `uk-${words}-${year}` : `uk-submission-${s.id.toLowerCase()}`;
  if (existing.has(id)) id = `${id}-${s.id.slice(-4)}`;
  return id;
}

function setComment(doc: Document, path: (string | number)[], comment: string, where: "after" | "before" = "after") {
  const node = doc.getIn(path, true) as Node | undefined;
  if (!node) return;
  if (where === "after") node.comment = ` ${comment}`;
  else node.commentBefore = ` ${comment}`;
}

/** The model's suggested fields: intake stores { unverified, model, generated_at, suggestion }. */
export function prefillSuggestion(prefill: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!prefill) return null;
  const inner = prefill.suggestion;
  return inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : prefill;
}

function suggestionLines(prefill: Record<string, unknown> | null): string[] {
  const suggestion = prefillSuggestion(prefill);
  if (!suggestion) return [];
  const lines = Object.entries(suggestion)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .slice(0, 20)
    .map(([k, v]) => `   ${oneLine(k, 40)}: ${oneLine(typeof v === "string" ? v : JSON.stringify(v), 200)}`);
  return lines.length ? ["Unverified suggestions from the language model. Check each one against the source before using it:", ...lines] : [];
}

const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

/** Skeleton card for a `new_promise` submission. */
export function draftNewPromise(s: SubmissionView, opts: { today: string; existingIds?: Set<string> }): DraftFile {
  const id = suggestPromiseId(s, opts.existingIds);
  const words = s.matched_quote?.text ?? s.claimed_quote ?? null;
  const source: Record<string, string> = { title: TODO, url: s.url };
  if (s.archived_url) source.archived_url = s.archived_url;
  const card: Record<string, unknown> = {
    id,
    actor_id: TODO,
    made_on: TODO,
    policy_area: TODO,
    status: "promised",
    origin: "reader_submission",
    submission_ref: s.id,
    ...(s.credit_handle ? { credit: oneLine(s.credit_handle, 40) } : {}),
    editor_check_required: true,
    outcome_by: TODO,
    sources: [source],
    versions: [
      {
        version: 1,
        text: words ? words : TODO,
        recorded_on: opts.today,
        source_url: s.url,
        quote_checked_on: null,
        parameters: { who: TODO, how_much_bn_per_year: null, when: TODO, funded_by: null },
      },
    ],
    events: [{ date: TODO, type: "promised", text: TODO }],
    replies: [],
  };
  const doc = new Document(card);
  doc.commentBefore = [
    ` Draft from reader submission ${s.id}, received ${ukDay(s.received_at)}.`,
    " Editors: fill in every TODO, check the quote word for word at the source, then run pnpm validate.",
    " This file fails validation until the TODOs are gone. Two editors approve before merge (invariant 8).",
    ...(s.video_time ? [` Time in the video, from the reader: ${oneLine(String(s.video_time), 40)} seconds`] : []),
    ...suggestionLines(s.llm_prefill).map((l) => ` ${l}`),
  ].join("\n");
  setComment(doc, ["id"], "TODO: confirm the id; it must match the file name");
  setComment(doc, ["actor_id"], `TODO: an id from content/actors${s.claimed_actor ? ` (the reader said: ${oneLine(s.claimed_actor, 80)})` : ""}`);
  const readerDate = typeof s.checks.claimed_date === "string" ? ` (the reader said: ${oneLine(s.checks.claimed_date, 40)})` : "";
  setComment(doc, ["made_on"], `TODO: the date the promise was made, YYYY-MM-DD${readerDate}; add venue and venue_label if known (${VENUES})`);
  setComment(doc, ["policy_area"], `TODO: one of ${POLICY_AREAS}`);
  setComment(
    doc,
    ["outcome_by"],
    "TODO: the body that must act to deliver it now, as { actor_id: hm-government } (a government or public body from content/actors), or null when no body in power is committed to it (PROMISE_STANDARD §11)",
  );
  setComment(doc, ["sources", 0, "title"], "TODO: a short title naming the publisher and date");
  setComment(
    doc,
    ["versions", 0, "text"],
    s.matched_quote ? "Matched word for word in the transcript; still check it at the source" : words ? "TODO: the reader's words, not matched to a transcript; check them word for word" : "TODO: the exact words, copied from the source",
  );
  setComment(doc, ["versions", 0, "quote_checked_on"], "TODO: the date an editor checked the words at source_url");
  setComment(doc, ["versions", 0, "parameters", "who"], "TODO: who it applies to, exactly as stated");
  setComment(doc, ["versions", 0, "parameters", "how_much_bn_per_year"], "TODO: [low, central, high] in £bn a year with costed_by (who made the central figure), a cost_note and cost_sources, or leave null if not stated");
  setComment(doc, ["versions", 0, "parameters", "when"], "TODO: when, exactly as stated");
  setComment(doc, ["versions", 0, "parameters", "funded_by"], "TODO: exactly as stated; null means Funding not stated");
  setComment(doc, ["events", 0, "date"], "TODO: same as made_on");
  setComment(doc, ["events", 0, "text"], "TODO: one line on what was promised, and where");
  return { path: `content/promises/${id}.yaml`, promiseId: id, yaml: doc.toString({ lineWidth: 0 }), mode: "new", changed: true };
}

/**
 * Append one item to a top-level block sequence by inserting text, so the rest
 * of the file keeps its exact formatting and the PR diff is only the new lines
 * (re-serialising the whole document would re-flow every folded paragraph).
 * Comment lines (untrusted text included) are each prefixed with "#".
 */
function appendToBlockSeq(text: string, key: string, item: Record<string, unknown>, comments: string[]): string {
  const doc = parseDocument(text);
  const seq = doc.get(key, true);
  if (!isSeq(seq) || seq.flow || !seq.items.length || !seq.range) {
    // Unusual layout (flow style or empty): fall back to re-serialising.
    const node = doc.createNode(item) as YAMLMap;
    node.commentBefore = comments.map((c) => ` ${c}`).join("\n");
    if (isSeq(seq)) seq.add(node);
    else doc.set(key, doc.createNode([item]));
    return doc.toString({ lineWidth: 0 });
  }
  const dashAt = seq.range[0];
  const indent = " ".repeat(dashAt - (text.lastIndexOf("\n", dashAt - 1) + 1));
  const body = stringify([item], { lineWidth: 0 });
  const snippet = [...comments.map((c) => `# ${c.replace(/[\r\n\u0085\u2028\u2029]+/g, " ")}`), ...body.trimEnd().split("\n")].map((l) => indent + l).join("\n") + "\n";
  const at = seq.range[1];
  const head = text.slice(0, at);
  const sep = head.endsWith("\n") ? "" : "\n";
  return head + sep + snippet + text.slice(at);
}

/** Append one event (and the source, if new) to an existing card for an `evidence` submission. */
export function draftEvidence(s: SubmissionView, cardYaml: string, opts: { today: string }): DraftFile {
  const promiseId = s.promise_id ?? "";
  if (!PROMISE_ID.test(promiseId)) throw new Error("evidence submission has no valid card id");
  const path = `content/promises/${promiseId}.yaml`;
  const doc = parseDocument(cardYaml);
  if (!isSeq(doc.get("events"))) throw new Error(`${path} has no events list`);
  const card = doc.toJS() as { events?: { evidence_url?: string }[]; sources?: { url?: string }[] };
  if (card.events?.some((e) => e.evidence_url === s.url)) return { path, promiseId, yaml: cardYaml, mode: "append", changed: false };

  let yaml = cardYaml;
  if (!card.sources?.some((x) => x.url === s.url)) {
    const src: Record<string, string> = { title: TODO, url: s.url };
    if (s.archived_url) src.archived_url = s.archived_url;
    yaml = appendToBlockSeq(yaml, "sources", src, [`From reader evidence ${s.id}. TODO: a short title naming the publisher and date`]);
  }
  yaml = appendToBlockSeq(yaml, "events", { date: TODO, type: s.evidence_type || TODO, text: TODO, evidence_url: s.url }, [
    `Reader evidence ${s.id}, received ${ukDay(s.received_at)}. Added for triage on ${opts.today}.`,
    "TODO: the date the change happened (YYYY-MM-DD) and one line on what changed. Decide whether the status changes too.",
    ...(s.evidence_type === "reworded" ? ["Rewording also needs a new entry in versions (append, never edit an old one)."] : []),
    ...(s.claimed_quote ? [`The reader's note (unverified): ${oneLine(s.claimed_quote)}`] : []),
    ...(s.archived_url ? [`Archived copy: ${s.archived_url}`] : []),
    ...suggestionLines(s.llm_prefill),
  ]);
  return { path, promiseId, yaml, mode: "append", changed: true };
}

/** Read a card from this checkout (used when there is no GitHub token). */
export function localCardReader(start = process.cwd()): (promiseId: string) => string | null {
  let root = start;
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const up = dirname(root);
    if (up === root) return () => null;
    root = up;
  }
  return (promiseId) => {
    if (!PROMISE_ID.test(promiseId)) return null;
    const path = join(root, "content", "promises", `${promiseId}.yaml`);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
}
