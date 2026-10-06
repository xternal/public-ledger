/**
 * Questions shown on the home page and repeated as FAQPage structured data.
 * One list, so the markup always matches what readers see.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Public Ledger?",
    a: "An open profit-and-loss account of the UK state. It shows where public money comes from (taxes, other income and borrowing), where it goes, and what political promises would cost and who would pay.",
  },
  {
    q: "Where do the numbers come from?",
    a: "From official publications: ONS public sector finances, OBR forecasts, HM Treasury spending statistics, HMRC tax costings, DWP benefit statistics, GOV.UK tax rates and the Bank of England. Every number links to its source and the date of the release it came from.",
  },
  {
    q: "Is the sandbox a forecast?",
    a: "No. It shows the first-year effect of a change as a range, using official costings. Real outcomes depend on how people and the economy respond, so results are ranges, never single numbers.",
  },
  {
    q: "How is a promise's status decided?",
    a: "By one published standard, the same for every party. A status changes only on evidence: a plan, a bill, money in a budget, or delivery. The full history of each card is kept, including any rewording of the promise.",
  },
  {
    q: "Do I need an account?",
    a: "No. Reading, using the sandbox and sharing a scenario never need an account. You can follow a promise by RSS, email or Telegram without one.",
  },
  {
    q: "Is my salary sent anywhere?",
    a: "No. The \"your share\" calculator runs in your browser. What you type is never sent or stored.",
  },
  {
    q: "Can I send in a promise or evidence?",
    a: "Yes, with the form on this page. Editors check every submission against the original source, and nothing is published until two editors agree.",
  },
];
