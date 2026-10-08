import { z } from "zod";
import { IsoDate, type Source } from "./provenance";

/**
 * Contracts behind delivery (M6b, docs/DATA_MODEL.md "ContractLink").
 *
 * Editors link a promise to the public contracts that carry it out, by hand
 * (`contracts:` in the card's YAML); nothing is matched automatically. The
 * nightly ETL (etl/contracts.py) fetches each linked contract's open
 * contracting (OCDS) record and keeps data/build/contracts/<key>.json. When
 * the value or dates change, it appends a snapshot: snapshots are append-only,
 * like a card's timeline, and `pnpm validate --base` rejects an edited one.
 */

/** Where a contract's open data comes from. `zakupki` is kept for Russia (M8) and not fetched yet. */
export const ContractSource = z.enum(["find_a_tender", "contracts_finder", "zakupki"]);
export type ContractSource = z.infer<typeof ContractSource>;

export const Ocid = z.string().regex(/^ocds-[a-z0-9]+-[A-Za-z0-9-]+$/, "an OCDS id, e.g. ocds-h6vhtk-0525b3");

/**
 * An editor's link from a promise to a contract. Usually just the OCID. Give
 * `award_id` when the procurement awarded several contracts (lots), and
 * `notice_url` for Contracts Finder, whose notices are fetched by notice id.
 */
export const ContractRef = z.union([
  Ocid,
  z
    .object({
      ocid: Ocid,
      award_id: z.string().min(1).optional(),
      notice_url: z.url().optional(),
    })
    .strict(),
]);
export type ContractRef = z.infer<typeof ContractRef>;

export const refOcid = (r: ContractRef): string => (typeof r === "string" ? r : r.ocid);

/** The contract's file name under data/build/contracts/, without ".json": the OCID, plus the award when one is named. */
export const contractKey = (r: ContractRef): string => (typeof r === "string" || !r.award_id ? refOcid(r) : `${r.ocid}--award-${r.award_id}`);

export const Money = z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) });
export type Money = z.infer<typeof Money>;

/** The contract as the nightly fetch found it on a day it had changed. Never edited once published. */
export const ContractSnapshot = z.object({
  fetched_at: IsoDate,
  value: Money,
  end_date_planned: IsoDate,
  end_date_actual: IsoDate.optional(),
});
export type ContractSnapshot = z.infer<typeof ContractSnapshot>;

export const ContractFile = z
  .object({
    key: z.string().min(1),
    ocid: Ocid,
    award_id: z.string().min(1).optional(),
    source: ContractSource,
    title: z.string().min(1),
    buyer: z.string().min(1),
    /** The award or contract notice a reader can open. */
    notice_url: z.url(),
    archived_url: z.url().optional(),
    /** The machine-readable record the ETL read. */
    record_url: z.url(),
    supplier: z.object({
      name: z.string().min(1),
      /** Companies House lists the company's officers and beneficial owners; we link to it and store nothing about them. */
      companies_house_number: z
        .string()
        .regex(/^[A-Z0-9]{8}$/)
        .optional(),
    }),
    awarded_on: IsoDate,
    bids_received: z.number().int().nonnegative().optional(),
    /** When one award covers several lots: the bids each lot received, in lot order. */
    bids_received_by_lot: z.array(z.number().int().nonnegative()).min(2).optional(),
    /** How the contract was let (OCDS procurementMethod): "direct" means awarded without competition. */
    competition: z.enum(["open", "selective", "limited", "direct"]).optional(),
    snapshots: z.array(ContractSnapshot).min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.key !== contractKey({ ocid: c.ocid, award_id: c.award_id }))
      ctx.addIssue({ code: "custom", path: ["key"], message: `key must be "${contractKey({ ocid: c.ocid, award_id: c.award_id })}"` });
    c.snapshots.forEach((s, i) => {
      const prev = c.snapshots[i - 1];
      if (prev && s.fetched_at < prev.fetched_at) ctx.addIssue({ code: "custom", path: ["snapshots", i], message: "snapshots must be in date order" });
    });
  });
export type ContractFile = z.infer<typeof ContractFile>;

/** The link the build plan names: a contract as it stands for one promise. */
export interface ContractLink extends ContractFile {
  id: string;
  promise_id: string;
}

/** The publishers behind contract data, for provenance tips. */
export const CONTRACT_SOURCES: Source[] = [
  {
    id: "find_a_tender",
    title: "Find a Tender: contract notices as open contracting data (OCDS)",
    publisher: "Cabinet Office",
    url: "https://www.find-tender.service.gov.uk/",
    licence: "OGL v3",
  },
  {
    id: "contracts_finder",
    title: "Contracts Finder: contract notices",
    publisher: "Cabinet Office",
    url: "https://www.contractsfinder.service.gov.uk/",
    licence: "OGL v3",
  },
];

const DAYS_PER_MONTH = 30.4375;
const MS_PER_DAY = 86_400_000;
const PERCENT = 100;

/** Whole months from one ISO date to another; negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY / DAYS_PER_MONTH);
}

export interface ContractChange {
  first: ContractSnapshot;
  latest: ContractSnapshot;
  /** Latest value minus the value first seen, in the contract's currency. */
  valueDelta: number;
  /** The same as a share of the first value; null when the first value was zero. */
  valueDeltaPct: number | null;
  /** The end date first planned, and the end now: the actual end once there is one, else the latest planned end. */
  endFirst: string;
  endNow: string;
  finished: boolean;
  /** Months from the first planned end to the end now; negative means early. */
  monthsLate: number;
}

export function contractChange(c: Pick<ContractFile, "snapshots">): ContractChange {
  const first = c.snapshots[0]!;
  const latest = c.snapshots[c.snapshots.length - 1]!;
  const valueDelta = latest.value.amount - first.value.amount;
  const endNow = latest.end_date_actual ?? latest.end_date_planned;
  return {
    first,
    latest,
    valueDelta,
    valueDeltaPct: first.value.amount ? (valueDelta / first.value.amount) * PERCENT : null,
    endFirst: first.end_date_planned,
    endNow,
    finished: !!latest.end_date_actual,
    monthsLate: monthsBetween(first.end_date_planned, endNow),
  };
}

/** Summary across an actor's linked contracts: total change in value and the median delay. */
export function contractTotals(contracts: Pick<ContractFile, "snapshots">[]): { count: number; valueDelta: number; medianMonthsLate: number | null } {
  const changes = contracts.map(contractChange);
  const late = changes.map((c) => c.monthsLate).sort((a, b) => a - b);
  const mid = Math.floor(late.length / 2);
  const median = !late.length ? null : late.length % 2 ? late[mid]! : (late[mid - 1]! + late[mid]!) / 2;
  return { count: changes.length, valueDelta: changes.reduce((a, c) => a + c.valueDelta, 0), medianMonthsLate: median };
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * A contract's history only grows: compared with the published file, the
 * identity is the same and every snapshot is still there, unchanged and in
 * place. New snapshots may only be added at the end.
 */
export function contractAppendOnlyIssues(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const issues: string[] = [];
  for (const k of ["key", "ocid", "award_id", "source"]) {
    if (stable(b[k]) !== stable(a[k])) issues.push(`${k} changed; a contract file keeps its identity`);
  }
  const was = Array.isArray(b.snapshots) ? b.snapshots : [];
  const now = Array.isArray(a.snapshots) ? a.snapshots : [];
  was.forEach((s, i) => {
    if (stable(s) !== stable(now[i])) issues.push(`snapshots[${i}] was changed or removed; snapshots are append-only (add a new one instead)`);
  });
  return issues;
}
