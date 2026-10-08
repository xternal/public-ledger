import type { PeopleBundle } from "@ledger/schema";
import { pctGdp, spendingSpan } from "./people-view";

/**
 * Words for /people. Plain British English, numbers first; any figure in a
 * sentence is read from people.json, never typed here.
 */

export const PEOPLE_TITLE = "An ageing country: people and long-term spending";
export const PEOPLE_DESCRIPTION =
  "How many people over pension age there will be for every 100 of working age, births and deaths, and what an ageing population means for public spending over the coming decades, from ONS and OBR projections.";

export const PEOPLE_COPY = {
  assumptionsTitle: "Assumptions",
  assumptionsIntro: "Each switch picks a projection the ONS has published. We do not make our own.",
  assumptionYear: (year: string) => `Long-term assumption, ${year}`,
  childrenPerWoman: (x: number) => `${x.toFixed(2)} children per woman`,
  netMigration: (people: string) => `${people} a year`,
  noNetMigration: "None",
  lifeExpectancy: (male: number, female: number) => `${male.toFixed(1)} years for men, ${female.toFixed(1)} for women`,
  showing: (label: string) => `Showing the ONS variant "${label}" against the principal projection.`,
  specialCase: "It is an illustrative special case, so it is not part of the shaded range of high and low variants.",
  notPublished: "The ONS publishes no projection with this mix of assumptions. It changes one assumption at a time, plus these combinations:",
  spaTimetable: "The pension ages the ONS projections use",
  backToPrincipal: "Back to the principal projection",
  principal: "ONS principal projection",
  band: "Range of ONS high and low variants",
  past: "ONS estimates",
  pastThenProjected: "Left of the dotted line: ONS estimates. Right of it: ONS projections.",
  oadrTitle: "People over pension age for every 100 people of working age",
  oadrTerm: "The old-age dependency ratio. Working age means 16 up to state pension age.",
  workersTitle: "People of working age for each person over pension age",
  workersTerm: "Computed from ONS projections: everyone aged 16 up to state pension age, divided by everyone at or over it. A count of people by age, not of people in work.",
  vitalTitle: "Births and deaths each year",
  vitalTerm: "Counted in the year to 30 June, as the ONS projections are.",
  births: "Births",
  deaths: "Deaths",
  spendingTitle: "Spending that rises with age, % of GDP",
  spendingTerm: "Health, adult social care, education, the state pension, other welfare and public service pensions: the OBR's age-related spending.",
  spendingControl: "OBR scenario",
  baseline: "OBR baseline",
  scenarioBand: "Range of OBR scenarios",
  spendingPoints: "The OBR breaks spending down for these years only.",
  componentsTitle: "What age-related spending is made of, OBR baseline",
  tableYear: "Year",
  tableRange: "Range",
  tableTo: "to",
  estimate: "estimate",
  sourcesTitle: "Sources and editions",
} as const;

export function peopleFaq(p: PeopleBundle): { q: string; a: string }[] {
  const s = spendingSpan(p);
  return [
    {
      q: "Are these forecasts?",
      a: "No. They are projections: what happens if assumptions about births, deaths and migration hold. The ONS publishes a principal projection and variants with higher or lower assumptions. We show them all and make none of our own.",
    },
    {
      q: "Why does an ageing population matter for public money?",
      a: `Spending on health, care and the state pension rises with age, while most tax is paid by people of working age. In the OBR's baseline, spending that rises with age goes from ${pctGdp(s.first)} of GDP in ${s.firstYear} to ${pctGdp(s.last)} in ${s.lastYear}.`,
    },
    {
      q: "Who decides the state pension age?",
      a: "The government, through Parliament. The ONS projections follow the law as it stands; the OBR's baseline follows the government's stated plan. Neither publishes a projection with a different pension age, so this page has no switch for it.",
    },
    {
      q: "Is “people of working age per person over pension age” the number of workers?",
      a: "No. It counts everyone aged 16 up to state pension age and divides by everyone at or over it. Some people of working age do not work and some people over pension age do. We work it out from the ONS projection counts and mark it as an estimate.",
    },
  ];
}
