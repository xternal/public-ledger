import type { CardView, ContractLink } from "@ledger/schema";
import { contractChange } from "@ledger/schema";
import { longDate, money } from "@/lib/format";
import { SOURCE_LABEL, bidsText, companiesHouseUrl, contractsSummary, displayName, endLine, showsContracts, valueLine } from "@/lib/contracts";
import { WithProvenance } from "./ui";

/**
 * Contracts behind delivery (M6b): the public contracts an editor linked to
 * the card, with who won, how many bid, and how the value and end date have
 * moved since the first notice. Shown once the card is funded or later.
 */
/** Contracts listed in full before "Show more". */
const SHOWN = 3;

export function ContractsStrip({ card }: { card: CardView }) {
  if (!showsContracts(card.file.status) || !card.contracts.length) return null;
  const id = `contracts-${card.id}`;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-1">
        <h2 id={id} className="m-0 text-label font-medium text-muted">
          Contracts behind delivery
        </h2>
        <p className="m-0 text-caption text-muted">
          Public contracts an editor linked to this promise. Figures come from the contract notices and are read again every night; a change adds a new entry and
          never rewrites an old one.
        </p>
      </div>
      <p className="m-0 text-sm">{contractsSummary(card.contracts)}</p>
      <ul className="m-0 grid list-none border-t border-line p-0">
        {card.contracts.slice(0, SHOWN).map((c) => (
          <Contract key={c.id} c={c} />
        ))}
      </ul>
      {card.contracts.length > SHOWN && (
        // The rest one click away, so a long list never buries the card.
        <details className="group">
          <summary className="cursor-pointer list-none text-label font-medium text-ink underline underline-offset-2 group-open:mb-1">
            <span className="group-open:hidden">Show {card.contracts.length - SHOWN} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="m-0 grid list-none p-0">
            {card.contracts.slice(SHOWN).map((c) => (
              <Contract key={c.id} c={c} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Contract({ c }: { c: ContractLink }) {
  const ch = contractChange(c);
  const end = endLine(c);
  const p = {
    quality: "sourced" as const,
    source_id: c.source,
    method_note: `From the ${SOURCE_LABEL[c.source]} notice, as published on ${longDate(ch.latest.fetched_at)}.`,
  };
  return (
    <li className="grid gap-3 border-b border-line py-4">
      <div className="grid gap-0.5">
        <a href={c.notice_url} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold leading-snug">
          {c.title}
        </a>
        <span className="text-label text-muted">
          {displayName(c.buyer)} · awarded {longDate(c.awarded_on)}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
        <div className="grid content-start gap-0.5">
          <dt className="text-caption text-muted">Supplier</dt>
          <dd className="m-0">
            {c.supplier.companies_house_number ? (
              <a href={companiesHouseUrl(c.supplier.companies_house_number)} target="_blank" rel="noopener noreferrer" title="Companies House: officers and owners">
                {displayName(c.supplier.name)}
              </a>
            ) : (
              displayName(c.supplier.name)
            )}
          </dd>
        </div>
        <div className="grid content-start gap-0.5">
          <dt className="text-caption text-muted">Bids received</dt>
          <dd className="m-0">{bidsText(c) ?? <span className="text-muted">Not stated</span>}</dd>
        </div>
        <div className="grid content-start gap-0.5">
          <dt className="text-caption text-muted">Value</dt>
          <dd className="m-0">
            <WithProvenance p={p}>
              <span className="font-semibold tabular-nums">{money(ch.latest.value.amount, ch.latest.value.currency)}</span>
            </WithProvenance>
          </dd>
          <dd className={`m-0 text-caption ${ch.valueDelta > 0 ? "text-debt-ink" : "text-muted"}`}>
            {ch.valueDelta ? `First ${money(ch.first.value.amount, ch.first.value.currency)}. ` : ""}
            {valueLine(c)}
          </dd>
        </div>
        <div className="grid content-start gap-0.5">
          <dt className="text-caption text-muted">End date</dt>
          <dd className={`m-0 ${end.late ? "font-medium text-debt-ink" : ""}`}>{end.text}</dd>
          {ch.endNow !== ch.endFirst && <dd className="m-0 text-caption text-muted">First planned {longDate(ch.endFirst)}</dd>}
        </div>
      </dl>
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
        <a href={c.notice_url} target="_blank" rel="noopener noreferrer">
          Notice on {SOURCE_LABEL[c.source]}
        </a>
        {c.archived_url && (
          <a href={c.archived_url} target="_blank" rel="noopener noreferrer">
            Archived copy
          </a>
        )}
        <a href={c.record_url} target="_blank" rel="noopener noreferrer">
          Open data record
        </a>
        <span className="text-muted">
          {c.snapshots.length === 1 ? "1 entry" : `${c.snapshots.length} entries`} since {longDate(ch.first.fetched_at)}
        </span>
      </span>
    </li>
  );
}
