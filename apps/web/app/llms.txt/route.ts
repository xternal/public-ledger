import { getSeed } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/copy";
import { FAQ } from "@/lib/faq";
import { gbpBn } from "@/lib/format";
import { costText } from "@/lib/promises";
import { absolute, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const dynamic = "force-static";

/** A plain-text summary for AI assistants (llmstxt.org), built from the same data as the site. */
export function GET() {
  const seed = getSeed();
  const s = seed.statement;
  const receipts = s.receipts.reduce((a, l) => a + l.bn, 0);
  const spending = s.spending.reduce((a, l) => a + l.bn, 0);
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `In ${s.meta.fiscal_year} (${s.meta.vintage_label}) the UK state spent ${gbpBn(spending)}. Taxes and other income covered ${gbpBn(receipts)}; ${gbpBn(s.borrowing_bn)} was borrowed. Figures are official outturn or forecasts, each linked to its source. Model results are ranges (low, central, high), never single numbers, and are not forecasts.`,
    "",
    "## Pages",
    "",
    `- [Annual statement and sandbox](${absolute("/")}): where the money came from and went, and what changing a tax or spending lever would do, as a range.`,
    `- [Promise ledger](${absolute("/promises")}): every tracked UK political promise with its cost, who pays, status and evidence. One standard for every party.`,
    `- [Atom feed of every change](${absolute("/feeds/all.xml")})`,
    "",
    "## Promises",
    "",
    ...seed.cards.map((c) => `- [${c.actor.name}: “${c.current.text}”](${absolute(`/promise/${c.id}`)}): ${STATUS_LABEL[c.file.status]}. ${costText(c)}.`),
    "",
    "## Sources",
    "",
    ...seed.sources.map((src) => `- [${src.title}](${src.url})`),
    "",
    "## Questions",
    "",
    ...FAQ.flatMap(({ q, a }) => [`### ${q}`, "", a, ""]),
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
