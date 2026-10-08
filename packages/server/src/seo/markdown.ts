import { contractChange, CORRECTION_PATH, LADDER, type CardView, type Correction, type PromiseFile } from "@ledger/schema";
import { areaLabel, CONTRACT_STATUSES, displayName, eventLabel, gbpBnText, moneyText, statusLabel, ukDate } from "../alerts/labels";
import { OGL, OPEN_PARLIAMENT_LICENCE, OWN_WORK_LICENCE, quoteLicence } from "../api/envelope";
import { absoluteUrl, areaPath, cardCostText, cardHeadline, cardLastUpdated, SITE_NAME, statusCounts, type SeoContext } from "./cards";

/**
 * Promise cards as Markdown, for AI assistants and anyone who reads plain
 * text: /promise/<id>.md (one card) and /llms-full.txt (every card, the
 * method in short and the licences). Built from the same content as the web
 * page, with the same facts in the same order, numbers first.
 */

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
/** Link text cannot hold square brackets or backslashes unescaped. */
const linkText = (s: string) => flat(s).replace(/([\\[\]])/g, "\\$1");
const link = (text: string, url: string) => `[${linkText(text)}](${url})`;

/** Our automated reviewer was called "Junior Editor" until 8 Oct 2026; readers see its current name (apps/web/lib/reviews.ts). */
const REVIEWER_NAME: Record<string, string> = { "Junior Editor": "AI Journalist" };
const reviewer = (r: PromiseFile["reviews"][number]) => `${REVIEWER_NAME[r.by] ?? r.by} (${r.kind === "automated" ? "automated" : r.kind === "legal" ? "legal review" : "editor"})`;

/** "£1.53bn to £1.87bn a year (central £1.7bn)", or why there is no figure. */
function costLine(c: CardView): string {
  const r = c.current.parameters?.how_much_bn_per_year;
  if (!r) return c.current.parameters ? "No costing published" : "Not costable";
  return `${cardCostText(c)} (central ${gbpBnText(Math.abs(r[1]))})`;
}

/** A corrected value in words, as the card shows it. */
function correctionValue(c: Correction, v: unknown): string {
  if (v === null || v === undefined) return "not given";
  if (c.path.endsWith("how_much_bn_per_year") && Array.isArray(v) && v.length === 3) return `${gbpBnText(v[0])} to ${gbpBnText(v[2])} a year`;
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? ukDate(v) : `“${flat(v)}”`;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" && "title" in x ? String((x as { title: unknown }).title) : JSON.stringify(x))).join("; ");
  return JSON.stringify(v);
}

/** "the date of the Delivering entry", "the cost range in version 1". */
function correctionTarget(c: Correction, f: PromiseFile): string {
  const m = CORRECTION_PATH.exec(c.path);
  if (!m) return c.path;
  const field = m[3]!.slice(1).replace(/^parameters\./, "").replace(/[._]/g, " ");
  const i = Number(m[2]);
  if (m[1] === "versions") return `the ${field} in version ${i + 1}`;
  if (m[1] === "events") return f.events[i] ? `the ${field} of the “${eventLabel(f.events[i]!.type)}” entry` : `the ${field} of a timeline entry`;
  return `the ${field} of a reply`;
}

/**
 * One card in Markdown. `level` is the heading level of its title: 1 for the
 * card's own .md file, 2 inside llms-full.txt.
 */
export function cardMarkdown(c: CardView, ctx: SeoContext, level: 1 | 2 = 1): string {
  const h = (n: number) => "#".repeat(level + n);
  const f = c.file;
  const p = c.current.parameters;
  const url = absoluteUrl(ctx, `/promise/${c.id}`);
  const updated = cardLastUpdated(f, ctx.today);
  const speaker = [c.actor.name, c.role, c.party && c.party.id !== c.actor.id ? c.party.name : null].filter(Boolean).join(", ");
  const said = [f.venue_label, ukDate(f.made_on)].filter(Boolean).join(", ");
  const out: string[] = [];
  const line = (...xs: string[]) => out.push(...xs);
  const section = (title: string, body: string[]) => {
    if (body.length) line(`${h(1)} ${title}`, "", ...body, "");
  };

  line(`${h(0)} ${cardHeadline(c)}`, "", `> “${flat(c.current.text)}”`, ">", `> — ${speaker}; ${said}`, "");
  const facts: [string, string | null][] = [
    ["Status", `${statusLabel(f.status)}${c.outcomeBy ? `, brought about by ${c.outcomeBy.name}${f.outcome_by?.note ? ` (${flat(f.outcome_by.note)})` : ""}` : ""}`],
    ["Status ladder", f.status === "unscoreable" ? null : LADDER.map(statusLabel).join(" → ")],
    ["Policy area", link(areaLabel(f.policy_area), absoluteUrl(ctx, areaPath(f.policy_area)))],
    ["Speaker", link(c.actor.name, absoluteUrl(ctx, `/actor/${c.actor.id}`)) + (c.role ? `, ${c.role}` : "")],
    ["Party", c.party && c.party.id !== c.actor.id ? link(c.party.name, absoluteUrl(ctx, `/actor/${c.party.id}`)) : null],
    ["Made on", ukDate(f.made_on)],
    ["Where", f.venue_label ?? f.venue ?? null],
    ["Deadline", f.deadline ? ukDate(f.deadline) : null],
    ["Cost a year", costLine(c)],
    ["Who it affects", p?.who ? flat(p.who) : null],
    ["When", p?.when ? (/^\d{4}-\d{2}-\d{2}$/.test(p.when) ? ukDate(p.when) : flat(p.when)) : null],
    ["Paid for by", p ? (p.funded_by ? flat(p.funded_by) : "Not stated when it was announced") : null],
    [
      "Quote source",
      `${c.current.source_url} (${c.current.quote_checked_on ? `checked word for word on ${ukDate(c.current.quote_checked_on)}` : "not yet checked against the source"}; ${quoteLicence(c.current.source_url)})`,
    ],
    ["Last updated", updated ? ukDate(updated) : null],
    ["Card", url],
  ];
  line(...facts.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`), "");

  section("Where it stands", f.status_note ? [flat(f.status_note)] : []);
  section(
    "Timeline",
    [...f.events]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => `- ${ukDate(e.date)}, ${eventLabel(e.type)}${e.date > ctx.today ? " (to come)" : ""}: ${flat(e.text)}${e.evidence_url ? ` (${link("evidence", e.evidence_url)})` : ""}`),
  );
  section("About the cost", [
    ...(p?.cost_note ? [flat(p.cost_note)] : []),
    ...(p?.cost_sources?.length ? ["", "Costing sources:", ...p.cost_sources.map((s) => `- ${link(s.title, s.url)}`)] : []),
  ]);
  if (CONTRACT_STATUSES.includes(f.status) && c.contracts.length) {
    const latest = c.contracts.map((k) => ({ k, ch: contractChange(k) }));
    const total = latest.reduce((a, x) => a + x.ch.latest.value.amount, 0);
    const direct = c.contracts.filter((k) => k.competition === "direct").length;
    section("Contracts behind delivery", [
      `${c.contracts.length} public ${c.contracts.length === 1 ? "contract" : "contracts"} linked by an editor, ${moneyText(total)} in all at their latest values${direct ? `; ${direct} awarded without competition` : ""}. Figures come from the contract notices (${OGL.name}).`,
      "",
      ...latest.map(
        ({ k, ch }) =>
          `- ${displayName(k.title)}: ${displayName(k.buyer)} to ${displayName(k.supplier.name)}, ${moneyText(ch.latest.value.amount, ch.latest.value.currency)}, awarded ${ukDate(k.awarded_on)}, ends ${ukDate(ch.latest.end_date_actual ?? ch.latest.end_date_planned)} (${link("notice", k.notice_url)})`,
      ),
    ]);
  }
  section(
    "Right of reply",
    f.replies.map((r) => `- ${ukDate(r.date)}: ${flat(r.text)}${r.editor_response ? ` Editors: ${flat(r.editor_response)}` : ""}`),
  );
  section(
    "Earlier wording",
    f.versions.length > 1 ? f.versions.slice(0, -1).map((v) => `- Version ${v.version}, ${ukDate(v.recorded_on)}: “${flat(v.text)}” (${link("source", v.source_url)})`) : [],
  );
  section(
    "Corrections",
    f.corrections.map((x) => `- ${ukDate(x.date)}, ${correctionTarget(x, f)}: ${flat(x.reason)} Was: ${correctionValue(x, x.was)}. Now: ${correctionValue(x, x.now)}.${x.source_url ? ` (${link("source", x.source_url)})` : ""}`),
  );
  section("Sources", f.sources.map((s) => `- ${link(s.title, s.url)}`));
  section(
    "Checks",
    f.reviews.length ? [...f.reviews].reverse().map((r) => `- Checked by ${reviewer(r)} on ${ukDate(r.on)}${f.editor_check_required ? "; human editor review to come" : ""}.`) : [],
  );
  return out.join("\n").trimEnd() + "\n";
}

/** The licence note that ends every Markdown file. */
export function licenceMarkdown(ctx: SeoContext): string {
  return [
    `Public Ledger's own writing (headlines, status notes, cost notes, summaries) is licensed under ${link(OWN_WORK_LICENCE.name, OWN_WORK_LICENCE.url)}: reuse it, crediting Public Ledger with a link to the card.`,
    `Official figures are under the ${link(OGL.name, OGL.url)} unless their source says otherwise; quotes from Parliament under the ${link(OPEN_PARLIAMENT_LICENCE.name, OPEN_PARLIAMENT_LICENCE.url)}; other quotes are short extracts whose rights stay with the speaker.`,
    `How the numbers and statuses are made: ${absoluteUrl(ctx, "/method")}.`,
  ].join(" ");
}

/** /promise/<id>.md: one card, then the licence. */
export function cardMarkdownFile(c: CardView, ctx: SeoContext): string {
  return `${cardMarkdown(c, ctx, 1)}\n---\n\n${licenceMarkdown(ctx)}\n`;
}

/** How a card works, in short, for readers who have only the text. */
export function methodMarkdown(ctx: SeoContext): string[] {
  return [
    `- One published standard for every party: ${link("the promise standard", "https://github.com/xternal/public-ledger/blob/main/docs/PROMISE_STANDARD.md")}. No code path treats one party differently.`,
    "- The quote is the speaker's exact words, copied from the source and checked word for word. The headline is our neutral summary of it.",
    `- Status ladder: ${LADDER.map(statusLabel).join(" → ")}. Off the ladder: ${statusLabel("failed")} (the deadline passed and evidence shows it was not met, or it was officially abandoned) and ${statusLabel("quietly_dropped")} (the deadline passed with no official statement and no evidence of delivery). ${statusLabel("unscoreable")}: two or more of who, how much and when are missing, so it cannot be tracked.`,
    "- A status changes only on evidence: every timeline entry after the promise itself links to a plan, a bill, a Budget line or a delivery record.",
    "- Cost is a year, to the public purse, as a low–high range with a central figure; \"raises\" means it brings money in. When a source gives one figure, the range is an editorial ±10% and the cost note says so.",
    "- \"Paid for by\" is exactly what was said when the promise was made; \"not stated\" means nothing was.",
    "- History is append-only: a rewording adds a new version, and a fix to our own mistake is a dated, public correction showing the old and new value.",
    "- Every card is re-read against its live sources by AI Journalist, our automated reviewer (quote, dates, evidence, status, cost, neutral wording, legal risk). Human editors review next; nothing a reader sends in is published until two editors agree.",
    `- Full method: ${absoluteUrl(ctx, "/method")}. Open data API (JSON and CSV): ${absoluteUrl(ctx, "/method/api")}.`,
  ];
}

/** /llms-full.txt: every card in Markdown, after the method in short and the licences. */
export function llmsFull(cards: CardView[], ctx: SeoContext, intro: { description: string }): string {
  const mix = statusCounts(cards)
    .map((x) => `${statusLabel(x.status)} ${x.count}`)
    .join(", ");
  return [
    `# ${SITE_NAME}: every promise in full`,
    "",
    `> ${intro.description}`,
    "",
    `Every UK political promise Public Ledger tracks, ${cards.length} cards (${mix}), as Markdown, newest promise first. Built on ${ukDate(ctx.today)} from the same data as the site. Each card is also a web page at ${absoluteUrl(ctx, "/promise/<id>")} and a Markdown file at ${absoluteUrl(ctx, "/promise/<id>.md")}. A shorter guide to the whole site: ${absoluteUrl(ctx, "/llms.txt")}.`,
    "",
    "## How a card works",
    "",
    ...methodMarkdown(ctx),
    "",
    "## Licences",
    "",
    licenceMarkdown(ctx),
    "",
    "## Cards",
    "",
    ...cards.map((c) => `- ${link(cardHeadline(c), absoluteUrl(ctx, `/promise/${c.id}`))}: ${c.actor.name}, ${statusLabel(c.file.status)}`),
    "",
    ...cards.flatMap((c) => ["---", "", cardMarkdown(c, ctx, 2)]),
  ].join("\n");
}
