import { backtestSummary, PolicyArea } from "@ledger/schema";
import { areaPath, cardHeadline } from "@ledger/server/seo";
import { constituencies, RECENT_VOTES } from "@ledger/server/mp";
import { getForecasts, getPeople, getSeed } from "@/lib/data";
import { endpoints } from "@/lib/api";
import { backtestLead } from "@/lib/method-copy";
import { STATUS_LABEL } from "@/lib/copy";
import { FAQ } from "@/lib/faq";
import { gbpBn } from "@/lib/format";
import { pctGdp, per100, ratio, span, spendingSpan } from "@/lib/people-view";
import { AREA_LABEL, costText } from "@/lib/promises";
import { absolute, SITE_DESCRIPTION, SITE_NAME, SOURCE_CODE } from "@/lib/site";
import { MP_DESCRIPTION } from "@/lib/mp-copy";
import { PRIVACY_SUMMARY } from "@/lib/privacy-copy";

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
  const { forecasts } = getForecasts();
  const shown = forecasts.filter((f) => f.recorded_as === "shown");
  const context = backtestSummary(forecasts.filter((f) => f.recorded_as === "context"));
  const firstRecorded = shown.map((f) => f.recorded_on).sort()[0] ?? null;
  const areas = PolicyArea.options.filter((a) => seed.cards.some((c) => c.file.policy_area === a));
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
    `- [Every promise in full](${absolute("/llms-full.txt")}): all ${seed.cards.length} promise cards as Markdown in one file (quote, speaker, party, date, status and status note, cost range, who pays, timeline with evidence links, contracts, corrections, sources), with the method in short and the licences. Each card alone is at ${absolute("/promise/<id>.md")}.`,
    `- Promises by policy area: ${areas.map((a) => `[${AREA_LABEL[a]}](${absolute(areaPath(a))})`).join(", ")}. Each lists the cards in that area and how they stand.`,
    `- [People and long-term spending](${absolute("/people")}): ONS population projections (principal and variants) and OBR long-term spending projections. In the ONS principal projection there are ${per100(oadr.last)} people over pension age for every 100 of working age in ${oadr.lastYear} (${per100(oadr.first)} in ${oadr.firstYear}; variants ${per100(oadr.range[0])} to ${per100(oadr.range[2])}), and ${ratio(workers.last)} people of working age per person over pension age. In the OBR baseline, age-related spending goes from ${pctGdp(age.first)} of GDP in ${age.firstYear} to ${pctGdp(age.last)} in ${age.lastYear} (OBR scenarios ${pctGdp(age.range[0])} to ${pctGdp(age.range[2])}). Assumption switches pick published variants only.`,
    `- [Your MP](${absolute("/mp")}): ${MP_DESCRIPTION} Each of the ${constituencies().length} constituencies has a page at ${absolute("/mp/<constituency>")}, for example ${absolute("/mp/manchester-central")}: the sitting MP (from the UK Parliament Members API), any promises we track in their name, a summary of their party's, and their last ${RECENT_VOTES} recorded Commons votes (Commons Votes API), with votes on bills our cards cite highlighted. Data checked daily.`,
    `- [How the numbers are made](${absolute("/method")}): sources, quality labels, why results are ranges, who checks the cards, and a changelog of every data edition.`,
    `- [Forecasts against what happened](${absolute("/method/backtest")}): every forecast the site shows is recorded and scored against the official outturn. ${backtestLead(backtestSummary(shown), firstRecorded)} Earlier official forecasts checked for context: ${context.scored}.`,
    `- [Open data API](${absolute("/method/api")}): the same data as JSON or CSV, free, no key.`,
    `- [Coming up](${absolute("/promises#coming-up")}): open promises due in the next 12 months, nearest deadline first. Readers can follow a deadline window (this month, next 3 months, next 12 months) by email, Telegram or feed.`,
    `- [Privacy notice](${absolute("/privacy")}): ${PRIVACY_SUMMARY}`,
    `- [Source code](${SOURCE_CODE.url}): the site, the data pipeline and every promise file, open source under ${SOURCE_CODE.licence}. Every edit to a promise card is a public commit.`,
    `- [Atom feed of every change](${absolute("/feeds/all.xml")}): promise changes, contract changes and new editions of the headline figures.`,
    `- [Atom feed of updates to the figures](${absolute("/feeds/updates.xml")}): contracts behind promises that move or are linked, and new OBR forecasts or ONS releases that change the Statement.`,
    `- [Atom feed of promises due in the next 3 months](${absolute("/feeds/deadlines/next-3-months.xml")}): outcomes when they fall due, and a monthly list of what is coming due.`,
    "",
    "## Open data API",
    "",
    "Read-only, JSON by default; add .csv for a spreadsheet. Every number carries unit, quality, source_id and vintage (edition); every response carries its licence (Open Government Licence v3.0; Open Parliament Licence for quotes from Parliament). Open CORS for GET. No reader data.",
    "",
    ...endpoints().map((e) => `- [${e.path}](${absolute(e.example)})${e.csv ? ` ([CSV](${absolute(`${e.example}.csv`)}))` : ""}: ${e.about}`),
    "",
    "## Promises",
    "",
    ...seed.cards.map(
      (c) =>
        `- [${cardHeadline(c)}](${absolute(`/promise/${c.id}`)}) ([Markdown](${absolute(`/promise/${c.id}.md`)})): ${c.actor.name}, “${c.current.text.replace(/\s+/g, " ").trim()}”. ${STATUS_LABEL[c.file.status]}. ${costText(c)}.`,
    ),
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
