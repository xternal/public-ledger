"use client";

import { useEffect, useState } from "react";
import type { CardView, Provenance } from "@ledger/schema";
import { LADDER } from "@ledger/schema";
import { EVENT_LABEL, STATUS_LABEL } from "@/lib/copy";
import { fixed, gbp, gbpBn, longDate, monthYear, perHousehold, rangeText, shareOf } from "@/lib/format";
import { AREA_LABEL, costSense, todayIso, whoLine } from "@/lib/promises";
import { track } from "@/lib/analytics";
import { correctionTarget, correctionValue } from "@/lib/corrections";
import { JUNIOR_EDITOR_NOTE, latestReview, reviewerLabel } from "@/lib/reviews";
import { ContractsStrip } from "./ContractsStrip";
import { FollowPanel } from "./FollowPanel";
import { StatusPill } from "./PromiseList";
import { QualityBadge, WithProvenance } from "./ui";

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

/** Today's date, read on the client so a static page never freezes it (review M1). */
function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  return today;
}

function Ladder({ card }: { card: CardView }) {
  const status = card.file.status;
  if (status === "unscoreable") {
    return (
      <p className="m-0 rounded-control bg-sunk px-3.5 py-2.5 text-sm">
        <b className="font-semibold">Unscoreable.</b> No who, how much, when or from where. That makes it a slogan, not a promise we can track.
      </p>
    );
  }
  const idx = (LADDER as readonly string[]).indexOf(status);
  return (
    <div>
      <ol className="m-0 grid list-none grid-cols-6 gap-[3px] p-0" aria-label={`Status: ${STATUS_LABEL[status]}`}>
        {LADDER.map((s, i) => (
          <li key={s} aria-current={i === idx ? "step" : undefined} className="grid gap-1.5">
            <span className={`h-1 rounded-full ${i === idx ? "bg-ink" : i < idx ? "bg-ink/35" : "bg-line"}`} />
            <span className={`text-[11.5px] ${i === idx ? "whitespace-nowrap font-semibold text-ink" : `hidden truncate text-muted sm:block ${i < idx ? "font-medium" : ""}`}`}>
              {STATUS_LABEL[s]}
            </span>
          </li>
        ))}
      </ol>
      {idx < 0 && <p className="mt-2 text-label font-semibold text-bad">{STATUS_LABEL[status]}</p>}
    </div>
  );
}

export interface PromiseDetailProps {
  card: CardView;
  householdsM: number;
  householdsP: Provenance;
  spendingBn: number;
  /** /?s=<code>#scenario for cards with lever settings. */
  runHref: string | null;
}

/** The full promise card (PRD F4), for /promise/[id]. Props only, so it needs no sandbox state. */
export function PromiseDetail({ card, householdsM, householdsP, spendingBn, runHref }: PromiseDetailProps) {
  const today = useToday();
  const [followOpen, setFollowOpen] = useState(false);
  const f = card.file;
  const p = card.current.parameters;
  const raw = p?.how_much_bn_per_year ?? null;
  const sense = raw ? costSense(raw) : null;
  const cost = sense?.abs ?? null;
  const events = [
    ...f.events.map((e) => ({ ...e, today: false })),
    ...(today ? [{ date: today, text: "We are here", type: "deadline" as const, today: true, evidence_url: undefined }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <article className="grid gap-7" aria-labelledby={`card-${f.id}`}>
      <header className="grid gap-3">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-label text-muted">
          <a href={`/actor/${card.actor.id}`}>{whoLine(card)}</a>
          {card.party && card.party.id !== card.actor.id && <a href={`/actor/${card.party.id}`}>{card.party.name}</a>}
          <span>{AREA_LABEL[f.policy_area]}</span>
        </span>
        <h1 id={`card-${f.id}`} className="m-0 max-w-[30ch] text-[clamp(26px,3.6vw,36px)] font-semibold leading-[1.15] tracking-[-0.025em]">
          “{card.current.text}”
        </h1>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          <StatusPill status={f.status} />
          {card.outcomeBy && (
            <a href={`/actor/${card.outcomeBy.id}`} className="font-medium" title={f.outcome_by?.note}>
              by {card.outcomeBy.name}
            </a>
          )}
          <span>
            {f.venue_label ? `${f.venue_label}, ` : ""}
            {longDate(f.made_on)}
          </span>
          {f.editor_check_required && <span>{f.reviews.some((r) => r.kind === "automated") ? "Checked by Junior Editor; human editor review to come" : "Needs editor check"}</span>}
          {!card.current.quote_checked_on && <span>Quote not yet checked against the source</span>}
        </span>
      </header>

      <Ladder card={card} />

      {cost && (
        <dl className="m-0 grid grid-cols-1 gap-5 border-y border-line py-4 sm:grid-cols-3">
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">{sense?.raises ? "Raises a year" : "Costs a year"}</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{gbpBn(cost[1])}</dd>
            <dd className="m-0 text-[12.5px] text-muted">range {rangeText(cost, gbpBn)}</dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">{sense?.raises ? "Per household, on average" : "Per household"}</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{gbp(perHousehold(cost[1], householdsM))}</dd>
            <dd className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              range {rangeText(cost, (x) => gbp(perHousehold(x, householdsM)))}
              <WithProvenance p={householdsP}>
                <QualityBadge quality={householdsP.quality} />
              </WithProvenance>
            </dd>
          </div>
          <div className="grid content-start gap-0.5">
            <dt className="text-label text-muted">Share of spending</dt>
            <dd className="m-0 text-[24px] font-semibold tracking-[var(--tracking-figure)]">{fixed(shareOf(cost[1], spendingBn), 2)}%</dd>
            <dd className="m-0 text-[12.5px] text-muted">of {gbpBn(spendingBn)}</dd>
          </div>
        </dl>
      )}
      {p && !cost && <p className="m-0 border-y border-line py-4 text-sm text-muted">{p.cost_note ?? "No official costing yet."}</p>}
      {cost && p?.cost_note && <p className="m-0 -mt-4 text-[12.5px] text-muted">{p.cost_note}</p>}

      {p && (
        <dl className="m-0 grid gap-4 text-sm sm:grid-cols-2">
          {p.who && (
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Who</dt>
              <dd className="m-0">{p.who}</dd>
            </div>
          )}
          {p.when && (
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">When</dt>
              <dd className="m-0">{/^\d{4}-\d{2}-\d{2}$/.test(p.when) ? longDate(p.when) : p.when}</dd>
            </div>
          )}
          <div className="grid gap-0.5 sm:col-span-2">
            <dt className="text-label text-muted">Paid for by</dt>
            <dd className="m-0">{p.funded_by ?? <b className="font-semibold">Funding not stated when it was announced.</b>}</dd>
          </div>
        </dl>
      )}

      <ol className="m-0 grid list-none p-0" aria-label="Timeline">
        {events.map((e, i) => (
          <li key={`${e.date}-${i}`} className={`relative grid grid-cols-[72px_14px_minmax(0,1fr)] items-start gap-2.5 pb-3.5 text-sm last:pb-0 ${e.today ? "font-semibold text-debt-ink" : ""}`}>
            <span className="pt-px text-[12.5px] text-muted">{e.today ? "Today" : monthYear(e.date)}</span>
            <span className="relative flex justify-center pt-1.5">
              <span className={`relative z-10 size-[9px] rounded-full ${e.today ? DOT.today : (DOT[e.type] ?? "bg-ink")}`} />
              {i < events.length - 1 && <span aria-hidden className="absolute bottom-[-18px] top-3 w-px bg-line-strong" />}
            </span>
            <span>
              {e.text}
              {!e.today && <span className="sr-only">, {EVENT_LABEL[e.type]}</span>}
              {e.evidence_url && (
                <>
                  {" "}
                  <a href={e.evidence_url} target="_blank" rel="noopener noreferrer" className="text-label">
                    evidence
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>

      {f.status_note && <p className="m-0 text-[12.5px] leading-relaxed text-muted">{f.status_note}</p>}

      <ContractsStrip card={card} />

      <div className="flex flex-wrap items-center gap-2.5">
        {runHref && (
          <a
            href={runHref}
            onClick={() => track("run_in_sandbox_clicked", { promise_id: f.id })}
            className="rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg no-underline hover:opacity-90"
          >
            Run in the sandbox
          </a>
        )}
        <button
          type="button"
          aria-expanded={followOpen}
          aria-controls={`follow-${f.id}`}
          onClick={() => {
            if (!followOpen) track("follow_panel_opened", { target_kind: "promise" });
            setFollowOpen(!followOpen);
          }}
          className="cursor-pointer rounded-control bg-bg px-4 py-2 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)]"
        >
          Follow this promise
        </button>
        <a href={`/?card=${f.id}#contribute`} className="text-label font-medium">
          Add evidence
        </a>
      </div>

      {followOpen && <FollowPanel id={`follow-${f.id}`} target={{ kind: "promise", id: f.id }} />}

      {f.versions.length > 1 && (
        <section aria-labelledby={`versions-${f.id}`} className="grid gap-2">
          <h2 id={`versions-${f.id}`} className="text-label font-medium text-muted">
            Earlier wording
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0 text-sm">
            {[...f.versions].reverse().map((v) => (
              <li key={v.version} className="grid gap-0.5 border-l-2 border-line-strong pl-3">
                <span className="text-caption text-muted">
                  Version {v.version}, {longDate(v.recorded_on)}
                </span>
                <span>“{v.text}”</span>
                {v.parameters?.how_much_bn_per_year && <span className="text-caption text-muted">Cost then: {rangeText(v.parameters.how_much_bn_per_year, gbpBn)} a year</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {f.replies.length > 0 && (
        <section aria-labelledby={`replies-${f.id}`} className="grid gap-2">
          <h2 id={`replies-${f.id}`} className="text-label font-medium text-muted">
            Right of reply
          </h2>
          {f.replies.map((r, i) => (
            <blockquote key={i} className="m-0 grid gap-1 rounded-control bg-sunk p-4 text-sm">
              <span className="text-caption text-muted">{longDate(r.date)}</span>
              <span>{r.text}</span>
              {r.editor_response && <span className="text-label text-muted">Editors: {r.editor_response}</span>}
            </blockquote>
          ))}
        </section>
      )}

      {f.corrections.length > 0 && (
        <section aria-labelledby={`corrections-${f.id}`} className="grid gap-2">
          <h2 id={`corrections-${f.id}`} className="text-label font-medium text-muted">
            Corrections
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0 text-sm">
            {f.corrections.map((c, i) => (
              <li key={i} className="grid gap-1 border-l-2 border-line-strong pl-3">
                <span className="text-caption text-muted">
                  Corrected on {longDate(c.date)}: {correctionTarget(c, f)}
                </span>
                <span>{c.reason}</span>
                <details className="text-label text-muted">
                  <summary className="cursor-pointer">What changed</summary>
                  <p className="m-0 mt-1">Was: {correctionValue(c, c.was)}</p>
                  <p className="m-0">Now: {correctionValue(c, c.now)}</p>
                  {c.source_url && (
                    <a href={c.source_url} target="_blank" rel="noopener noreferrer">
                      Source for the correction
                    </a>
                  )}
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-2.5 text-label">
        {(() => {
          const r = latestReview(f);
          return r ? (
            <p className="m-0 text-muted" title={r.kind === "automated" ? JUNIOR_EDITOR_NOTE : undefined}>
              <span aria-hidden className="text-good">✓ </span>
              Reviewed by <b className="font-semibold text-ink">{reviewerLabel(r)}</b> on {longDate(r.on)}.{" "}
              <a href="/#reviews">What that means</a>
            </p>
          ) : null;
        })()}
        {f.origin === "reader_submission" && (
          <p className="m-0 text-muted">
            Started from a reader submission{f.credit ? `, sent by ${f.credit}` : ""}.
          </p>
        )}
        <span className="text-muted">Sources</span>
        {f.sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
            {s.title}
          </a>
        ))}
        {p?.cost_sources?.length ? (
          <>
            <span className="mt-1 text-muted">Costings</span>
            {p.cost_sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            ))}
          </>
        ) : null}
      </div>
    </article>
  );
}
