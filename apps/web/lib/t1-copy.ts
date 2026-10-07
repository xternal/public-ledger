import type { T1Provenance } from "@ledger/schema";
import { T1_EDITORIAL_BAND } from "@ledger/schema";
import type { T1FailReason } from "./t1";
import { fixed, gbp, signed } from "./format";

/**
 * Words for the "Who gains and loses" panel (T1, PolicyEngine microsimulation)
 * and the "People like me" block. Plain British English; the technical terms
 * live in the method note.
 */

const BAND_PCT = Math.round(T1_EDITORIAL_BAND * 100);

export const T1_COPY = {
  kicker: "Your tax and benefit changes, household by household",
  heading: "Who gains and loses",
  intro:
    "PolicyEngine, an open-source tax and benefit model, runs your changes over a representative sample of UK households. It shows who gains and who loses, which a quick costing cannot.",
  start: "Show who gains and loses (about a minute)",
  startNote: "It runs on PolicyEngine's free public service, so it starts only when you ask.",
  pending: "PolicyEngine is working this out. New scenarios take about a minute.",
  restarted: "Your scenario changed, so PolicyEngine is starting again. New scenarios take about a minute.",
  cancel: "Cancel",
  retry: "Try again",
  notApplicable: "None of your changes are tax or benefit rules PolicyEngine models, so there is nothing to show here.",

  revenueTitle: "Borrowing, per year: two models side by side",
  t0Label: "Our quick estimate",
  t0Note: "HMRC costings, which include how taxpayers respond",
  t1Label: "PolicyEngine",
  t1Note: "Survey households, no change in behaviour",
  agree: "The two models agree to within 15%.",
  coversOnly: "Both figures cover only the changes PolicyEngine models.",
  notInModel: "Not in this model:",

  decilesTitle: "Change in household income, by income decile",
  decilesNote: `Decile 1 is the tenth of households with the lowest incomes. Whiskers show the ±${BAND_PCT}% range.`,
  winnersTitle: "Share of households that gain or lose",
  winnersAll: `All households (central estimates: read each share as ±${BAND_PCT}%)`,
  winnersByDecile: "By income decile",
  regionsTitle: "Average change a year, by region",
  regionsNote: `Per household. Whiskers show the ±${BAND_PCT}% range.`,
  regionMissing: (name: string) => `${name}: not available in this model.`,
  povertyTitle: "Poverty and inequality",
  povertyNote: `Share of people in poverty as PolicyEngine measures it, before and after your changes. Central estimates: read each as ±${BAND_PCT}%.`,
  povertyIndirect:
    "Poverty follows the official measure, which counts income before taxes on spending, so VAT and fuel duty do not move it.",
  openInPe: "Open this reform in PolicyEngine",
  showTable: "Show as table",
  hideTable: "Hide table",
} as const;

export const T1_FAIL_COPY: Record<T1FailReason, string> = {
  timeout: "PolicyEngine is taking longer than usual. Try again in a few minutes.",
  network: "We could not reach our server. Check your connection and try again.",
  busy: "Lots of people are asking at once. Try again in a minute.",
  server: "PolicyEngine could not work this scenario out just now. Try again later.",
  invalid: "PolicyEngine's answer did not look right, so we are not showing it. Try again later.",
};

export const WINNER_LABEL = {
  gain_more_5: "Gain more than 5%",
  gain_less_5: "Gain less than 5%",
  no_change: "No change",
  lose_less_5: "Lose less than 5%",
  lose_more_5: "Lose more than 5%",
} as const;

export const POVERTY_LABEL = {
  all: "Poverty, everyone",
  child: "Child poverty",
  adult: "Working-age poverty",
  senior: "Pensioner poverty",
} as const;

export const INEQUALITY_LABEL = {
  gini: "Inequality (Gini index)",
  top_10_pct_share: "Income share of the top 10%",
  top_1_pct_share: "Income share of the top 1%",
} as const;

/** "2024-25" from a dataset name like "enhanced_frs_2024_25" or a path ending in it; null when there is no year in it. */
export function datasetYear(dataset: string | null): string | null {
  const m = dataset?.match(/(20\d{2})_(\d{2})(?!\d)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** One plain sentence on why T0 and T1 differ (docs/MODEL.md, ensemble display). */
export function disagreeText(p: T1Provenance, t1Year: string, t0Year: string): string {
  const dataYear = datasetYear(p.dataset);
  const years =
    dataYear && dataYear !== t1Year
      ? ` PolicyEngine's survey data are from ${dataYear}, projected to ${t1Year}; our estimate uses HMRC's first-year costing for the change.`
      : ` The two also start from different years of data.`;
  return `The models differ. Our quick estimate uses HMRC's costings, which include how taxpayers change their behaviour. PolicyEngine's is a static estimate on survey households, so nobody changes behaviour.${years}`;
}

export const provenanceText = (p: T1Provenance) =>
  `PolicyEngine UK ${p.model_version}, data ${p.data_version}. Static: no change in behaviour. Ranges are ±${BAND_PCT}% around PolicyEngine's single estimate.`;

/** People like me (Your share). */
export const LIKE_ME_COPY = {
  heading: "People like me",
  intro: "How your scenario changes the income of an example household, worked out by PolicyEngine. Your choices stay on this device.",
  household: "Household",
  region: "Region",
  householdResult: "A household like yours",
  regionResult: (name: string) => `Average in ${name}`,
  netIncome: "Income after tax and benefits",
  noRegion: (name: string) => `${name}: not available in this model.`,
  // The edition of data/seed/archetype_spending.json (etl/archetype_spending.py): update both together.
  spending:
    "Each example household spends what the ONS finds a similar household spends (Family spending in the UK, April 2024 to March 2025), so VAT and fuel duty reach it.",
  noHousehold: "PolicyEngine has no figure for this household in this result.",
  idle: "Move a tax or benefit lever in the sandbox, such as VAT or income tax, then choose “Show who gains and loses” under your scenario.",
  idleLink: "Go to the sandbox",
  ask: "Choose “Show who gains and loses” under your scenario to see a household like yours.",
  askLink: "Go to the panel",
  notApplicable: "Your scenario changes nothing PolicyEngine models, so it has no figure for a household like yours.",
  pending: "PolicyEngine is working this out. New scenarios take about a minute.",
  failed: "PolicyEngine's result is not available. You can try again from the panel under your scenario.",
  seeAll: "See who gains and loses",
} as const;

/** "−3.0%", "+0.25%": one decimal, two under 0.1. */
export const pctChange = (x: number) => signed(x, (a) => `${fixed(a, a < 0.1 ? 2 : 1)}%`, 0.005);
/** "−£468" */
export const gbpChange = (x: number) => signed(x, gbp, 0.5);
/** A 0–1 share as "24.9%"; tiny non-zero shares as "under 0.1%". */
export const share = (x: number) => (x <= 0 ? "0%" : x < 0.0005 ? "under 0.1%" : `${fixed(x * 100, 1)}%`);
/** Change between two 0–1 rates in percentage points: "no change", "+0.2pp". */
export const ppChange = (before: number, after: number) => {
  const d = (after - before) * 100;
  return Math.abs(d) < 0.05 ? "no change" : `${signed(d, (a) => fixed(a, 1))}pp`;
};

/** Method section: T1 in plain words (docs/MODEL.md T1 and ensemble display). */
export const T1_METHOD = {
  heading: "Who gains and loses: microsimulation",
  paragraphs: [
    "The “Who gains and loses” panel uses PolicyEngine UK, an open-source model of the UK tax and benefit system. It applies your tax and benefit changes to every household in a large survey that represents the country (the Family Resources Survey, reweighted by PolicyEngine), works out each household's income before and after, and adds them up by income decile and region.",
    `This is a static microsimulation: everyone keeps the same job, hours and spending, so nobody changes their behaviour. PolicyEngine gives one figure for each result; we show it with a ±${BAND_PCT}% range, labelled Modelled, and name the model and data versions it came from.`,
    "Our quick estimate and PolicyEngine can differ. The quick estimate uses HMRC's costings, which include how taxpayers respond; PolicyEngine's is static and starts from survey data a year or two old, projected forward. When the two are more than 15% apart, the panel shows both and says why. Disagreement is information, not an error.",
    "The example households in “People like me” are the same for everyone. Their earnings and spending are fixed: spending is the Office for National Statistics' average for a similar household (Family spending in the UK, April 2024 to March 2025), so changes to VAT and fuel duty reach them. PolicyEngine charges VAT at the standard rate on half of that spending and scales it up to match total VAT receipts, which counts VAT that businesses pass on in prices.",
    "It runs on PolicyEngine's free public service, only when you ask. Only the scenario is sent; your salary, household and region stay on your device.",
  ],
  modelledHelp: "Produced by a model, ours or PolicyEngine's, and shown as a range.",
} as const;
