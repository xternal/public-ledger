"use client";

import type { PromiseCard } from "@ledger/schema";
import { LADDER } from "@ledger/schema";
import { EVENT_LABEL, STATUS_LABEL } from "@/lib/copy";
import { fixed, gbp, gbpBn, longDate, monthYear, perHousehold, rangeText, shareOf } from "@/lib/format";
import { track } from "@/lib/analytics";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, TextButton, WithProvenance } from "./ui";

const DOT: Record<string, string> = {
  promised: "bg-rec",
  in_plan: "bg-warn",
  funded: "bg-warn",
  legislated: "bg-rec",
  delivering: "bg-warn",
  delivered: "bg-good",
  reworded: "bg-muted",
  failed: "bg-bad",
  deadline_missed: "bg-debt",
  deadline: "bg-bg shadow-[inset_0_0_0_2px_var(--ink)]",
  reply: "bg-muted",
  today: "rounded-[2px] bg-debt",
};

function Ladder({ card }: { card: PromiseCard }) {
  if (card.status === "unscoreable") {
    return (
      <p className="m-0 rounded-control bg-sunk px-3.5 py-2.5 text-sm">
        <b className="font-semibold">Unscoreable.</b> No who, how much, when or from where. That makes it a slogan, not a promise we can track.
      </p>
    );
  }
  const idx = (LADDER as readonly string[]).indexOf(card.status);
  const off = idx < 0;
  return (
    <div>
      <ol className="m-0 grid list-none grid-cols-6 gap-[3px] p-0" aria-label={`Status: ${STATUS_LABEL[card.status]}`}>
        {LADDER.map((s, i) => (
          <li key={s} aria-current={i === idx ? "step" : undefined} className="grid gap-1.5">
            <span className={`h-1 rounded-full ${i === idx ? "bg-ink" : i < idx ? "bg-ink/35" : "bg-line"}`} />
            <span className={`truncate text-[11.5px] ${i === idx ? "font-semibold text-ink" : i < idx ? "font-medium text-muted" : "text-faint"}`}>
              {STATUS_LABEL[s]}
            </span>
          </li>
        ))}
      </ol>
      {off && (
        <p className="mt-2 text-label font-semibold text-bad">
          {STATUS_LABEL[card.status]}
        </p>
      )}
    </div>
  );
}

export function PromiseDetail({
  card,
  today,
  followOpen,
  onToggleFollow,
  onAddEvidence,
}: {
  card: PromiseCard;
  today: string | null;
  followOpen: boolean;
  onToggleFollow: () => void;
  onAddEvidence: () => void;
}) {
  const { seed, baseResult, applyPreset } = useScenario();
  const { macro } = seed.statement;
  const cost = card.parameters?.how_much_bn_per_year ?? null;
  const preset = seed.presets.find((p) => p.promise_id === card.id);
  const events = [...card.timeline.map((e) => ({ ...e, today: false })), ...(today ? [{ date: today, event: "Today", type: "deadline" as const, today: true }] : [])].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  return (
    <article className="grid gap-5 rounded-panel border border-line p-6 md:sticky md:top-[76px]" aria-labelledby={`card-${card.id}`}>
      <header className="grid gap-1.5">
        <span className="text-label text-muted">
          {card.actor.role}
          {card.actor.party ? `, ${card.actor.party}` : ""}
        </span>
        <h3 id={`card-${card.id}`} className="text-[20px] font-semibold leading-snug tracking-[-0.015em]">
          {card.actor.name}: “{card.text}”
        </h3>
        <span className="text-label text-muted">
          {card.venue_label ? `${card.venue_label}, ` : ""}
          {longDate(card.made_on)}
        </span>
      </header>

      <Ladder card={card} />

      {cost && (
        <dl className="m-0 grid grid-cols-1 gap-5 border-y border-line py-4 sm:grid-cols-3">
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">Per year</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{gbpBn(cost[1])}</dd>
            <dd className="m-0 text-[12.5px] text-muted">range {rangeText(cost, gbpBn)}</dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">Per household</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{gbp(perHousehold(cost[1], macro.households_m))}</dd>
            <dd className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              range {rangeText(cost, (x) => gbp(perHousehold(x, macro.households_m)))}
              <WithProvenance p={macro.provenance.households_m!}>
                <QualityBadge quality={macro.provenance.households_m!.quality} />
              </WithProvenance>
            </dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">Share of spending</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{fixed(shareOf(cost[1], baseResult.totals.spending_bn), 2)}%</dd>
            <dd className="m-0 text-[12.5px] text-muted">of {gbpBn(baseResult.totals.spending_bn)}</dd>
          </div>
        </dl>
      )}

      {card.parameters && (
        <div className="grid gap-0.5">
          <span className="text-label text-muted">Paid for by</span>
          <span className="text-sm">{card.parameters.funded_by ?? "Not stated when it was announced. Unless a source is named, it is borrowed."}</span>
        </div>
      )}

      <ol className="m-0 grid list-none p-0" aria-label="Timeline">
        {events.map((e, i) => (
          <li
            key={`${e.date}-${i}`}
            className={`relative grid grid-cols-[72px_14px_minmax(0,1fr)] items-start gap-2.5 pb-3.5 text-sm last:pb-0 ${e.today ? "font-semibold text-debt" : ""}`}
          >
            <span className="pt-px text-[12.5px] text-muted">{e.today ? "Today" : monthYear(e.date)}</span>
            <span className="relative flex justify-center pt-1.5">
              <span className={`relative z-10 size-[9px] rounded-full ${e.today ? DOT.today : DOT[e.type] ?? "bg-ink"}`} />
              {i < events.length - 1 && <span aria-hidden className="absolute bottom-[-18px] top-3 w-px bg-line-strong" />}
            </span>
            <span>
              {e.today ? "We are here" : e.event}
              {!e.today && <span className="sr-only">, {EVENT_LABEL[e.type]}</span>}
            </span>
          </li>
        ))}
      </ol>

      {card.status_note && <p className="m-0 text-[12.5px] leading-relaxed text-muted">{card.status_note}</p>}

      <div className="flex flex-wrap items-center gap-2.5">
        {preset && (
          <button
            type="button"
            className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
            onClick={() => {
              applyPreset(preset);
              track("promise_run_in_sandbox", { promise_id: card.id });
              document.getElementById("scenario")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Run in the sandbox
          </button>
        )}
        <button
          type="button"
          aria-expanded={followOpen}
          aria-controls="follow-panel"
          onClick={onToggleFollow}
          className="cursor-pointer rounded-control bg-bg px-4 py-2 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)]"
        >
          Follow this promise
        </button>
        <TextButton onClick={onAddEvidence}>Add evidence</TextButton>
      </div>

      {followOpen && (
        <div id="follow-panel" className="grid gap-2.5 rounded-control bg-sunk p-3.5">
          <p className="m-0 text-label text-muted">Get an alert when the status changes or the deadline passes. No account needed.</p>
          <div className="flex flex-wrap gap-1.5">
            {["RSS feed", "Email alerts", "Telegram bot"].map((c) => (
              <button key={c} type="button" disabled className="cursor-not-allowed rounded-full border border-line-strong bg-bg px-2.5 py-1 text-label font-medium text-muted">
                {c}
              </button>
            ))}
          </div>
          <p className="m-0 text-caption text-muted">Coming soon: alerts are not wired up yet. We never show who follows what.</p>
        </div>
      )}

      <div className="grid gap-1 text-label">
        <span className="text-muted">Sources</span>
        {card.sources.length ? (
          card.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
          ))
        ) : (
          <span className="text-muted">Pending editor check.</span>
        )}
      </div>
    </article>
  );
}
