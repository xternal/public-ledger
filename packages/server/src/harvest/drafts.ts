import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Document, parse, Scalar, visit, type Node, type Pair, type ToStringOptions } from "yaml";
import { DRAFT_SOURCE_ID, DraftFile, draftViolations } from "@ledger/schema";
import type { Candidate, HarvestReport, SourceDoc } from "./types";

/**
 * Drafts (M4): one YAML per candidate promise in content/drafts/<date>/, the
 * source text each quote comes from stored byte for byte beside them, and the
 * body of the day's pull request. Nothing here publishes anything: two editors
 * turn each draft into a card or delete it (PROMISE_STANDARD §6), and the PR is
 * never merged automatically. Schema and the exact-match check: @ledger/schema
 * (packages/schema/src/drafts.ts).
 */

export const DRAFTS_DIR = "content/drafts";

export const DRAFT_HEADER = [
  "Draft from automatic intake. Not published.",
  "Editors: check the quote against the source, fill the card, move it to",
  "content/promises/ (see content/README.md), or delete it.",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_WIDTH = 100;
/** Strings with spaces longer than this are written as folded blocks (`>-`), so long quotes read as paragraphs. */
const FOLD_OVER = 80;
/** GitHub refuses PR bodies over 65,536 characters; stay well under. */
const PR_BODY_MAX = 60_000;
const QUOTE_CELL = 160;

const posix = (p: string) => p.split(sep).join("/");
/** Code-unit order: the same on every machine, unlike localeCompare. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** content/drafts/<date>/<date>-<source id>-<n>.yaml */
export const draftId = (date: string, sourceId: string, n: number) => `${date}-${sourceId}-${n}`;

/** Draft ids given out by writeDrafts, so the PR body names the same files. */
const idsWritten = new WeakMap<Candidate, string>();

const textOrNull = (s: string | null | undefined) => (typeof s === "string" && s.trim() ? s : null);

/** The draft file for one candidate (not yet checked; writeDrafts checks it). */
export function draftFromCandidate(c: Candidate, doc: SourceDoc, date: string): DraftFile {
  return {
    draft: "llm_intake",
    intake_date: date,
    source: { id: doc.id, kind: doc.kind, url: doc.url, title: doc.title, date: doc.date, venue_label: doc.venueLabel },
    quote: c.quote,
    source_span: [c.span[0], c.span[1]],
    speaker: {
      name: c.speaker.name.trim() || "unknown",
      role: textOrNull(c.speaker.role),
      party: textOrNull(c.speaker.party),
      member_id: c.speaker.memberId ?? null,
      actor_id: c.speaker.actorId ?? null,
      check: c.speaker.check,
    },
    suggested: {
      policy_area: textOrNull(c.suggested.policy_area),
      who: textOrNull(c.suggested.who),
      how_much: textOrNull(c.suggested.how_much),
      when: textOrNull(c.suggested.when),
      funded_by: textOrNull(c.suggested.funded_by),
      deadline: textOrNull(c.suggested.deadline),
    },
    why: c.why.trim() ? c.why : "No reason given.",
    confidence: c.confidence,
    model: c.model,
    status: "to_review",
  };
}

const CHECK_NOTE = {
  segment: "the source's own data (or the uploader) says this person spoke these words",
  nearby: "the name is printed just before the quote; check it",
  unverified: "only the model says so; check who said it",
} as const;

function render(draft: DraftFile, style: "folded" | "plain" | "quoted"): string {
  const doc = new Document(draft);
  doc.commentBefore = [
    ...DRAFT_HEADER,
    "",
    `The quote is source_span of sources/${draft.source.id}.txt beside this file`,
    "(JavaScript string offsets). pnpm validate re-checks it character for character.",
  ]
    .map((l) => (l ? ` ${l}` : ""))
    .join("\n");
  (doc.getIn(["source_span"], true) as { flow?: boolean }).flow = true;
  if (style !== "quoted") {
    visit(doc, {
      Scalar(key, node) {
        if (key !== "value" || typeof node.value !== "string") return;
        if (ISO_DATE.test(node.value)) node.type = Scalar.QUOTE_DOUBLE;
        else if (style === "folded" && node.value.length > FOLD_OVER && node.value.includes(" ")) node.type = Scalar.BLOCK_FOLDED;
      },
    });
  }
  (doc.getIn(["speaker", "check"], true) as Node).comment = ` ${CHECK_NOTE[draft.speaker.check]}`;
  const pair = (key: string) => (doc.contents as { items: Pair<Scalar, unknown>[] }).items.find((p) => p.key.value === key);
  pair("suggested")!.key.commentBefore = " Unverified suggestions from the language model. Editors confirm each one at the source.";
  const opts: ToStringOptions =
    style === "quoted"
      ? { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", flowCollectionPadding: false }
      : { lineWidth: LINE_WIDTH, flowCollectionPadding: false };
  return doc.toString(opts);
}

/**
 * The draft as YAML: fixed key order, long strings folded. Every string must
 * read back exactly (a quote is compared character for character), so the
 * output is parsed again; if folding would change a value, plainer styles are
 * used instead, down to double-quoted strings on one line.
 */
export function draftYaml(draft: DraftFile): string {
  const want = JSON.stringify(draft);
  for (const style of ["folded", "plain", "quoted"] as const) {
    const out = render(draft, style);
    if (JSON.stringify(parse(out)) === want) return out;
  }
  throw new Error(`draft for ${draft.source.id} does not survive a YAML round trip`);
}

/** The next free draft number for a source in a day's folder (1 when there are none). */
function nextNumber(dir: string, date: string, sourceId: string): number {
  if (!existsSync(dir)) return 1;
  const prefix = `${date}-${sourceId}-`;
  let max = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(".yaml")) continue;
    const n = f.slice(prefix.length, -".yaml".length);
    if (/^\d+$/.test(n)) max = Math.max(max, Number(n));
  }
  return max + 1;
}

/**
 * Write each candidate to content/drafts/<date>/<date>-<source id>-<n>.yaml and
 * each source that produced one to content/drafts/<date>/sources/<source id>.txt,
 * byte for byte. Returns the paths written, relative to root.
 *
 * Every draft is checked again here, with the same rules CI uses: a candidate
 * whose quote is not exactly its span of the source, or whose draft fails the
 * schema, is not written; it moves from report.candidates to report.dropped
 * (and report.sources counts are updated), so the PR body stays true and the
 * validate step cannot fail on a draft we wrote. Numbering continues after any
 * drafts already in the folder. A source whose stored text differs from the
 * text fetched now is left alone (its earlier drafts point into the old text).
 */
export function writeDrafts(report: HarvestReport, docs: SourceDoc[], opts: { root: string; date: string }): string[] {
  const { root, date } = opts;
  if (!ISO_DATE.test(date)) throw new Error(`writeDrafts: date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  const dir = join(root, DRAFTS_DIR, date);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const groups = new Map<string, Candidate[]>();
  for (const c of report.candidates) {
    const list = groups.get(c.sourceId);
    if (list) list.push(c);
    else groups.set(c.sourceId, [c]);
  }

  const written: string[] = [];
  const kept: Candidate[] = [];
  for (const sourceId of [...groups.keys()].sort()) {
    const list = groups.get(sourceId)!.sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]);
    const drop = (c: Candidate, reason: string) => report.dropped.push({ sourceId, reason, quote: c.quote.slice(0, 300) });
    const fail = (message: string) => {
      report.errors.push({ sourceId, message });
      for (const c of list) drop(c, "not written (see errors)");
    };
    const doc = byId.get(sourceId);
    if (!doc) {
      fail("no source text for this source; drafts not written");
      continue;
    }
    if (!DRAFT_SOURCE_ID.test(doc.id)) {
      fail("source id is not filesystem-safe; drafts not written");
      continue;
    }
    if (Buffer.from(doc.text, "utf8").toString("utf8") !== doc.text) {
      fail("source text cannot be stored byte for byte (broken Unicode); drafts not written");
      continue;
    }
    const srcPath = join(dir, "sources", `${doc.id}.txt`);
    if (existsSync(srcPath) && readFileSync(srcPath, "utf8") !== doc.text) {
      fail(`the source text changed since earlier drafts of ${date}; new drafts not written (review or delete the earlier ones, then run again)`);
      continue;
    }

    const ready: { c: Candidate; draft: DraftFile }[] = [];
    for (const c of list) {
      const draft = draftFromCandidate(c, doc, date);
      const schema = DraftFile.safeParse(draft);
      const problems = schema.success ? draftViolations(draft, doc.text) : schema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      if (problems.length) drop(c, `failed the draft check: ${problems[0]}`);
      else ready.push({ c, draft });
    }
    if (!ready.length) continue;

    mkdirSync(join(dir, "sources"), { recursive: true });
    if (!existsSync(srcPath)) {
      writeFileSync(srcPath, doc.text, "utf8");
      written.push(posix(relative(root, srcPath)));
    }
    let n = nextNumber(dir, date, doc.id);
    for (const { c, draft } of ready) {
      const id = draftId(date, doc.id, n++);
      const path = join(dir, `${id}.yaml`);
      writeFileSync(path, draftYaml(draft), "utf8");
      written.push(posix(relative(root, path)));
      idsWritten.set(c, id);
      kept.push(c);
    }
  }
  report.candidates = kept;
  for (const s of report.sources) s.candidates = kept.filter((c) => c.sourceId === s.id).length;
  return written;
}

// ---------------------------------------------------------------- reading back

/** YAML files under dir, recursively, in a stable order. Symlinks are skipped. */
function yamlFiles(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => byText(a.name, b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory() && recursive) out.push(...yamlFiles(p, true));
    else if (e.isFile() && /\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

function readYaml(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every quote already on a card (content/promises/*.yaml, all versions[].text)
 * or in a draft (content/drafts/**\/*.yaml), so extraction can skip duplicates.
 * Unreadable files are skipped here; pnpm validate reports them.
 */
export function knownQuotes(root: string): string[] {
  const out = new Set<string>();
  for (const path of yamlFiles(join(root, "content", "promises"), false)) {
    const card = readYaml(path) as { versions?: { text?: unknown }[] } | null;
    for (const v of Array.isArray(card?.versions) ? card.versions : []) if (typeof v?.text === "string" && v.text) out.add(v.text);
  }
  for (const path of yamlFiles(join(root, DRAFTS_DIR), true)) {
    const draft = readYaml(path) as { quote?: unknown } | null;
    if (typeof draft?.quote === "string" && draft.quote) out.add(draft.quote);
  }
  return [...out];
}

/**
 * The checks pnpm validate runs on every draft still in the tree: it parses
 * with DraftFile, sits at content/drafts/<intake_date>/<intake_date>-<source id>-<n>.yaml,
 * has its source text at sources/<source id>.txt beside it, and passes
 * draftViolations against that text. Any failure is an error (the CI guarantee
 * of zero invented quotes); every draft also gets a warning until editors
 * resolve it.
 */
export function checkDrafts(root: string): { errors: string[]; warnings: string[]; drafts: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const base = join(root, DRAFTS_DIR);
  const texts = new Map<string, string | null>();
  const files = yamlFiles(base, true);
  for (const path of files) {
    const rel = posix(relative(root, path));
    warnings.push(`${rel}: draft awaiting editors`);
    let data: unknown;
    try {
      data = parse(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(`${rel}: not valid YAML (${(e as Error).message.split("\n")[0]})`);
      continue;
    }
    const r = DraftFile.safeParse(data);
    if (!r.success) {
      for (const i of r.error.issues) errors.push(`${rel}: ${i.path.join(".") || "(file)"}: ${i.message}`);
      continue;
    }
    const d = r.data;
    const parts = posix(relative(base, path)).split("/");
    const name = parts.at(-1)!;
    const prefix = `${d.intake_date}-${d.source.id}-`;
    if (parts.length !== 2 || parts[0] !== d.intake_date) errors.push(`${rel}: a draft lives in ${DRAFTS_DIR}/<intake_date>/ (here ${d.intake_date})`);
    else if (!name.startsWith(prefix) || !/^\d+\.yaml$/.test(name.slice(prefix.length)))
      errors.push(`${rel}: the file name should be ${prefix}<n>.yaml`);
    const srcPath = join(path, "..", "sources", `${d.source.id}.txt`);
    if (!texts.has(srcPath)) texts.set(srcPath, existsSync(srcPath) ? readFileSync(srcPath, "utf8") : null);
    const text = texts.get(srcPath);
    if (text == null) {
      errors.push(`${rel}: its source text sources/${d.source.id}.txt is missing, so the quote cannot be checked`);
      continue;
    }
    for (const v of draftViolations(d, text)) errors.push(`${rel}: ${v}`);
  }
  return { errors, warnings, drafts: files.length };
}

// ---------------------------------------------------------------- PR body

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line, at most max characters (code points), with an ellipsis when cut. */
function shorten(s: string, max: number): string {
  const flat = Array.from(s.replace(/\s+/g, " ").trim());
  return flat.length > max ? `${flat.slice(0, max - 1).join("").trimEnd()}…` : flat.join("");
}

/** Safe inside a Markdown table cell: one line, no column breaks, no HTML, no @mentions. */
export function mdCell(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>|]/g, "\\$&")
    .replace(/@(?=\w)/g, "@​");
}

const pct = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
const mdUrl = (url: string) => url.replace(/[\s()<>]/g, pct);
const fragmentPart = (s: string) => encodeURIComponent(s).replace(/[-!'()*]/g, pct);

/** A link to the source that, in browsers that support text fragments, scrolls to the quote. */
function sourceLink(url: string, quote: string): string {
  const words = quote.replace(/\s+/g, " ").trim().split(" ");
  const frag = url.includes("#")
    ? ""
    : words.length > 10
      ? `#:~:text=${fragmentPart(words.slice(0, 5).join(" "))},${fragmentPart(words.slice(-5).join(" "))}`
      : `#:~:text=${fragmentPart(words.join(" "))}`;
  return `[open](${mdUrl(url)}${frag})`;
}

const ukLongDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(",", "");

const ukTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);

const MARK = { segment: "✓", nearby: "≈", unverified: "?" } as const;

/** Markdown for the day's pull request: what was found, what was dropped, errors, and how to review. */
export function prBody(report: HarvestReport, opts: { now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const { date, candidates, dropped, errors } = report;
  const sourcesWith = new Set(candidates.map((c) => c.sourceId));
  const models = [...new Set(candidates.map((c) => c.model))].sort();

  const head = [
    `## Intake for ${ukLongDate(date)}`,
    "",
    `**${plural(candidates.length, "candidate promise")}** from ${sourcesWith.size} of ${plural(report.sources.length, "source")}; ${dropped.length} dropped by the checks; ${plural(errors.length, "error")}.`,
    "",
    `Run finished ${ukTime(now)}${models.length ? ` · model ${models.map((m) => `\`${mdCell(m)}\``).join(", ")}` : ""}. Dates are UK dates; times are UK time.`,
    "",
    "> Nothing here is published. Every quote below is the source's own words at the stored offsets, re-checked by `pnpm validate` before this pull request opened. Who said it, and every suggested field, still needs an editor.",
    "",
  ].join("\n");

  // Review instructions, dropped and errors go in full; the candidate tables get what room is left.
  const tail: string[] = [];
  if (dropped.length) {
    const counts = new Map<string, number>();
    for (const d of dropped) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
    // Examples in turn from each reason, so the list shows the variety.
    const byReason = reasons.map(([r]) => dropped.filter((d) => d.reason === r));
    const examples: HarvestReport["dropped"] = [];
    for (let i = 0; examples.length < 10 && byReason.some((l) => l.length > i); i++) {
      for (const l of byReason) if (l[i] && examples.length < 10) examples.push(l[i]!);
    }
    tail.push(
      `### Dropped: ${dropped.length}`,
      "",
      "Kept out by the checks. Listed so editors can spot one worth adding by hand.",
      "",
      "| Reason | Count |",
      "|---|---:|",
      ...reasons.map(([r, n]) => `| ${mdCell(r)} | ${n} |`),
      "",
      "Examples:",
      "",
      ...examples.map((d) => `- ${mdCell(d.reason)} · \`${mdCell(d.sourceId)}\` · “${mdCell(shorten(d.quote, QUOTE_CELL))}”`),
      "",
    );
  }
  if (errors.length) {
    const shown = errors.slice(0, 30);
    tail.push(
      `### Errors: ${errors.length}`,
      "",
      ...shown.map((e) => `- \`${mdCell(e.sourceId)}\`: ${mdCell(shorten(e.message, 300))}`),
      ...(errors.length > shown.length ? [`- …and ${errors.length - shown.length} more in the run log`] : []),
      "",
    );
  }
  tail.push(
    "### How to review",
    "",
    "1. **Two editors** review this pull request (docs/PROMISE_STANDARD.md §6).",
    `2. For each draft in \`${DRAFTS_DIR}/${date}/\`: check the quote word for word at the source, then either turn it into a full card in \`content/promises/\` (see \`content/README.md\`), or delete the draft.`,
    `3. Before merge, every draft has become a card or been deleted, and \`${DRAFTS_DIR}/${date}/\` (with its \`sources/\` folder) is gone. Nothing is published from drafts.`,
    "4. This pull request is never merged automatically.",
    "",
    "GitHub does not start CI on a pull request opened by a workflow. Push a commit to the branch to run it.",
    "",
  );
  const tailText = tail.join("\n");

  let budget = PR_BODY_MAX - head.length - tailText.length;
  const sections: string[] = [];
  const order = [...report.sources.filter((s) => sourcesWith.has(s.id)).map((s) => s.id), ...[...sourcesWith].filter((id) => !report.sources.some((s) => s.id === id)).sort()];
  let omitted = 0;
  for (const id of order) {
    const src = report.sources.find((s) => s.id === id);
    const rows = candidates.filter((c) => c.sourceId === id);
    const top = [
      `### ${mdCell(src?.title ?? id)}`,
      "",
      `\`${mdCell(id)}\` · ${src ? `[${mdCell(src.url)}](${mdUrl(src.url)})` : "source not listed"} · text in \`sources/${mdCell(id)}.txt\``,
      "",
      "| Draft | Speaker | Quote | Confidence | Source |",
      "|---|---|---|---:|---|",
    ].join("\n");
    if (top.length + 200 > budget) {
      omitted += rows.length;
      continue;
    }
    const lines = [top];
    budget -= top.length + 1;
    rows.forEach((c, i) => {
      const s = c.speaker;
      const who = `${MARK[s.check]} ${s.name}${s.role ? `, ${s.role}` : ""}${s.party ? ` (${s.party})` : ""}`;
      const row = `| \`${mdCell(idsWritten.get(c) ?? String(i + 1))}\` | ${mdCell(who)} | “${mdCell(shorten(c.quote, QUOTE_CELL))}” | ${c.confidence.toFixed(2)} | ${src ? sourceLink(src.url, c.quote) : "–"} |`;
      if (row.length + 1 > budget) {
        omitted++;
        return;
      }
      lines.push(row);
      budget -= row.length + 1;
    });
    sections.push(lines.join("\n"), "");
  }
  const legend = candidates.length
    ? ["Speaker: ✓ the source's own data (or the uploader) says who spoke · ≈ the name is printed just before the quote · ? only the model says so.", ""]
    : ["No candidate promises.", ""];
  const more = omitted ? [`…and ${plural(omitted, "more candidate")}, left out of this description for length: see the files in \`${DRAFTS_DIR}/${date}/\`.`, ""] : [];
  return [head, ...legend, ...sections, ...more, tailText].join("\n");
}
