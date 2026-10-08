import { constituencies, RECENT_VOTES } from "@ledger/server/mp";
import { getPeople, getSeed } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/copy";
import { FAQ } from "@/lib/faq";
import { gbpBn } from "@/lib/format";
import { pctGdp, per100, ratio, span, spendingSpan } from "@/lib/people-view";
import { costText } from "@/lib/promises";
import { absolute, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { MP_DESCRIPTION } from "@/lib/mp-copy";

export const dynamic = "force-static";

/** A plain-text summary for AI assistants (llmstxt.org), built from the same data as the site. */
export function GET() {
  const seed = getSeed();
  const s = seed.statement;
  const receipts = s.receipts.reduce((a, l) => a + l.bn, 0);
  const spending = s.spending.reduce((a, l) => a + l.bn, 0);
  const people = getPeople();
  const oadr = span(people.charts.oadr);
  const workers = span(people.charts.workers);
  const age = spendingSpan(people);
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
    `- [People and long-term spending](${absolute("/people")}): ONS population projections (principal and variants) and OBR long-term spending projections. In the ONS principal projection there are ${per100(oadr.last)} people over pension age for every 100 of working age in ${oadr.lastYear} (${per100(oadr.first)} in ${oadr.firstYear}; variants ${per100(oadr.range[0])} to ${per100(oadr.range[2])}), and ${ratio(workers.last)} people of working age per person over pension age. In the OBR baseline, age-related spending goes from ${pctGdp(age.first)} of GDP in ${age.firstYear} to ${pctGdp(age.last)} in ${age.lastYear} (OBR scenarios ${pctGdp(age.range[0])} to ${pctGdp(age.range[2])}). Assumption switches pick published variants only.`,
    `- [Your MP](${absolute("/mp")}): ${MP_DESCRIPTION} Each of the ${constituencies().length} constituencies has a page at ${absolute("/mp/<constituency>")}, for example ${absolute("/mp/manchester-central")}: the sitting MP (from the UK Parliament Members API), any promises we track in their name, a summary of their party's, and their last ${RECENT_VOTES} recorded Commons votes (Commons Votes API), with votes on bills our cards cite highlighted. Data checked daily.`,
    `- [Coming up](${absolute("/promises#coming-up")}): open promises due in the next 12 months, nearest deadline first. Readers can follow a deadline window (this month, next 3 months, next 12 months) by email, Telegram or feed.`,
    `- [Atom feed of every change](${absolute("/feeds/all.xml")}): promise changes, contract changes and new editions of the headline figures.`,
    `- [Atom feed of updates to the figures](${absolute("/feeds/updates.xml")}): contracts behind promises that move or are linked, and new OBR forecasts or ONS releases that change the Statement.`,
    `- [Atom feed of promises due in the next 3 months](${absolute("/feeds/deadlines/next-3-months.xml")}): outcomes when they fall due, and a monthly list of what is coming due.`,
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
