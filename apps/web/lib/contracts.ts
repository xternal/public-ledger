import { contractChange, type ContractLink, type ContractSource, type Status } from "@ledger/schema";
import { longDate, signedMoney, signedPct } from "./format";

/** Cards show their contracts once money is committed (M6b): funded, delivering or delivered. */
export const CONTRACT_STATUSES: Status[] = ["funded", "delivering", "delivered"];
export const showsContracts = (status: Status) => CONTRACT_STATUSES.includes(status);

export const SOURCE_LABEL: Record<ContractSource, string> = {
  find_a_tender: "Find a Tender",
  contracts_finder: "Contracts Finder",
  zakupki: "zakupki.gov.ru",
};

/** Companies House page for a company number; the register lists officers and beneficial owners, so we link rather than copy. */
export const companiesHouseUrl = (n: string) => `https://find-and-update.company-information.service.gov.uk/company/${n}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Unchanged since 8 Oct 2026" or "+£54,507 (+13.8%) since the first notice". */
export function valueLine(c: ContractLink): string {
  const ch = contractChange(c);
  if (!ch.valueDelta) return `Unchanged since ${longDate(ch.first.fetched_at)}`;
  const pct = ch.valueDeltaPct === null ? "" : ` (${signedPct(ch.valueDeltaPct)})`;
  return `${signedMoney(ch.valueDelta, ch.latest.value.currency)}${pct} since first seen on ${longDate(ch.first.fetched_at)}`;
}

/** "Ended 31 Oct 2027, 7 months late", "Due 30 Sep 2027, 6 months later than first planned", "Due 31 Mar 2027, as first planned". */
export function endLine(c: ContractLink): { text: string; late: boolean } {
  const ch = contractChange(c);
  const when = `${ch.finished ? "Ended" : "Due"} ${longDate(ch.endNow)}`;
  if (ch.monthsLate > 0)
    return { text: `${when}, ${plural(ch.monthsLate, "month")} ${ch.finished ? "late" : "later than first planned"}`, late: true };
  if (ch.monthsLate < 0) return { text: `${when}, ${plural(-ch.monthsLate, "month")} early`, late: false };
  return { text: `${when}, as first planned`, late: false };
}

/** A median delay in months, for a headline figure: "On time", "3 months late", "1 month early". */
export function delayText(months: number): string {
  const m = Math.round(months);
  if (!m) return "On time";
  return `${plural(Math.abs(m), "month")} ${m > 0 ? "late" : "early"}`;
}
