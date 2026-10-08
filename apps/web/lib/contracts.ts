import { contractChange, type ContractLink, type ContractSource, type Status } from "@ledger/schema";
import { longDate, money, signedMoney, signedPct } from "./format";

/** Cards show their contracts once money is committed (M6b): funded, delivering or delivered. */
export const CONTRACT_STATUSES: Status[] = ["funded", "delivering", "delivered"];
export const showsContracts = (status: Status) => CONTRACT_STATUSES.includes(status);

export const SOURCE_LABEL: Record<ContractSource, string> = {
  find_a_tender: "Find a Tender",
  contracts_finder: "Contracts Finder",
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

/**
 * "Ended 31 Oct 2027, 7 months late", "Planned end 30 Sep 2027, 6 months later than first planned",
 * "Planned end 31 Mar 2027, as first planned". A planned end can be in the past: notices often never say a contract ended.
 */
export function endLine(c: ContractLink): { text: string; late: boolean } {
  const ch = contractChange(c);
  const when = `${ch.finished ? "Ended" : "Planned end"} ${longDate(ch.endNow)}`;
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

/** "15"; "14 to 16 for each of 5 lots" when one award covers several lots; "None: awarded without competition"; null when the notice does not say. */
export function bidsText(c: ContractLink): string | null {
  const lots = c.bids_received_by_lot;
  if (lots?.length) {
    const lo = Math.min(...lots);
    const hi = Math.max(...lots);
    return `${lo === hi ? lo : `${lo} to ${hi}`} for each of ${lots.length} lots`;
  }
  if (c.bids_received !== undefined) return String(c.bids_received);
  if (c.competition === "direct") return "None: awarded without competition";
  if (c.competition === "limited") return "Not stated; invited suppliers only";
  return null;
}

/** Words kept in capitals when a notice's ALL-CAPS name is set in normal case. */
const KEEP_UPPER = new Set(["NHS", "UK", "PV", "EV", "EVC", "LLP", "PLC", "CIC", "BDP", "LED", "GB", "HM", "PCC", "ICB"]);

/** Some notices give names in capitals ("BRIGHT SPARK ENERGY SOLUTIONS LIMITED"); show them in normal case. Mixed-case names are left alone. */
export function displayName(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name
    .split(/(\s+|-|\/)/)
    .map((w) => (KEEP_UPPER.has(w) || !/[A-Z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join("");
}

/** "4 contracts, £1.2m in all at their latest values; 2 awarded without competition." */
export function contractsSummary(contracts: ContractLink[]): string {
  const total = contracts.reduce((a, c) => a + contractChange(c).latest.value.amount, 0);
  const direct = contracts.filter((c) => c.competition === "direct").length;
  const n = contracts.length;
  return `${plural(n, "contract")}, ${money(total)} in all at their latest values${direct ? `; ${direct} awarded without competition` : ""}.`;
}
