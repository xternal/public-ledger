"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CardView, Provenance, Status } from "@ledger/schema";
import { COSTED_BY_LABEL, LADDER } from "@ledger/schema";
import { EVENT_LABEL, STATUS_LABEL } from "@/lib/copy";
import { fixed, gbp, gbpBn, longDate, monthYear, perHousehold, rangeText, shareOf } from "@/lib/format";
import { AREA_LABEL, costSense, todayIso } from "@/lib/promises";
import { track } from "@/lib/analytics";
import { correctionTarget, correctionValue } from "@/lib/corrections";
import { AI_JOURNALIST_NOTE, latestReview, reviewerLabel } from "@/lib/reviews";
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

/** Another card to read next, as the related list shows it. */
export interface RelatedCard {
  id: string;
  headline: string;
  who: string;
  status: Status;
}

export interface PromiseDetailProps {
  card: CardView;
  householdsM: number;
  householdsP: Provenance;
  spendingBn: number;
  /** /?s=<code>#scenario for cards with lever settings. */
  runHref: string | null;
  /** The editors' short summary of what is promised, or the quote cut short until they write one. */
  headline: string;
  /** The last day the card changed (YYYY-MM-DD): its newest event, version, correction or review. */
  updated: string | null;
  /** The policy area's own page. */
  areaHref: string;
  /** Up to three cards to read next: same area first, then same party. */
  related: RelatedCard[];
}

/** A titled block in the reading column. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="m-0 text-[17px] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One fact in the "At a glance" card. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="m-0 text-sm leading-snug">{children}</dd>
    </div>
  );
}

/** A folded block under "More detail": the heading shows, the rest opens on demand. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-b border-line py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
        {title}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-3 grid gap-3 text-sm">{children}</div>
    </details>
  );
}

/**
 * The full promise card (PRD F4), for /promise/[id], laid out to be read in
 * one pass: the promise and where it stands first; then, beside it, the facts
 * at a glance and the one action that matters (Follow); then the story in
 * order (status, timeline, cost, contracts, replies); details folded last.
 * Props only, so it needs no sandbox state.
 */
export function PromiseDetail({ card, householdsM, householdsP, spendingBn, runHref, headline, updated, areaHref, related }: PromiseDetailProps) {
  const today = useToday();
  const [followOpen, setFollowOpen] = useState(false);
  const f = card.file;
  const p = card.current.parameters;
  const raw = p?.how_much_bn_per_year ?? null;
  const sense = raw ? costSense(raw) : null;
  const cost = sense?.abs ?? null;
  const review = latestReview(f);
  const events = [
    ...f.events.map((e) => ({ ...e, today: false })),
    ...(today ? [{ date: today, text: "We are here", type: "deadline" as const, today: true, evidence_url: undefined }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const when = p?.when ? (/^\d{4}-\d{2}-\d{2}$/.test(p.when) ? longDate(p.when) : p.when) : f.deadline ? `By ${longDate(f.deadline)}` : null;

  return (
    <article className="grid gap-8" aria-labelledby={`card-${f.id}`}>
      <header className="grid gap-4">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted">
          <a href={`/actor/${card.actor.id}`}>{card.actor.name}</a>
          {card.party && card.party.id !== card.actor.id && (
            <>
              <span aria-hidden>·</span>
              <a href={`/actor/${card.party.id}`}>{card.party.name}</a>
            </>
          )}
          <span aria-hidden>·</span>
          <a href={areaHref}>{AREA_LABEL[f.policy_area]}</a>
        </span>
        <div className="grid gap-2">
          <p className="m-0 text-body font-semibold text-ink">{headline}</p>
          <h1 id={`card-${f.id}`} className="m-0 max-w-[32ch] text-[clamp(26px,3.6vw,38px)] font-semibold leading-[1.15] tracking-[-0.025em]">
            “{card.current.text}”
          </h1>
        </div>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          <StatusPill status={f.status} />
          {card.broughtAboutBy && (
            <a href={`/actor/${card.broughtAboutBy.id}`} className="font-medium" title={f.brought_about_by?.note}>
              by {card.broughtAboutBy.name}
            </a>
          )}
          <span>
            {f.venue_label ? `${f.venue_label}, ` : ""}
            {longDate(f.made_on)}
          </span>
          {!card.current.quote_checked_on && <span>Quote not yet checked against the source</span>}
        </span>
        <Ladder card={card} />
      </header>

      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* At a glance and Follow: first on phones, beside the story on wide screens. */}
        <aside aria-labelledby={`glance-${f.id}`} className="grid gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1">
          <div className="grid gap-5 rounded-panel bg-surface p-5 shadow-[inset_0_0_0_1px_var(--line)]">
            <h2 id={`glance-${f.id}`} className="m-0 text-label font-medium text-muted">
              At a glance
            </h2>
            <dl className="m-0 grid gap-4">
              <div className="grid gap-0.5">
                <dt className="text-caption text-muted">{sense?.raises ? "Raises a year" : "Costs a year"}</dt>
                {cost ? (
                  <>
                    <dd className="m-0 text-[26px] font-semibold leading-none tracking-[var(--tracking-figure)]">{gbpBn(cost[1])}</dd>
                    <dd className="m-0 text-caption text-muted">range {rangeText(cost, gbpBn)}</dd>
                    {p?.costed_by && (
                      <dd className="m-0 text-caption text-muted">
                        Central figure: {p.costed_by.name} ({COSTED_BY_LABEL[p.costed_by.kind]})
                      </dd>
                    )}
                    <dd className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-caption text-muted">
                      about {gbp(perHousehold(cost[1], householdsM))} per household · {fixed(shareOf(cost[1], spendingBn), 2)}% of spending
                      <WithProvenance p={householdsP} align="end">
                        <QualityBadge quality={householdsP.quality} />
                      </WithProvenance>
                    </dd>
                  </>
                ) : (
                  <dd className="m-0 text-sm">{p ? "No costing published" : "Not costable"}</dd>
                )}
              </div>
              {p?.who && <Fact label="Who it affects">{p.who}</Fact>}
              {when && <Fact label="When">{when}</Fact>}
              {p && <Fact label="Paid for by">{p.funded_by ?? <span className="font-semibold">Not stated when it was announced</span>}</Fact>}
            </dl>

            {/* On phones the action comes first, so it is on the first screen; on wide screens it follows the facts. */}
            <div className="order-first grid gap-3 lg:order-none">
              <button
                type="button"
                aria-expanded={followOpen}
                aria-controls={`follow-${f.id}`}
                onClick={() => {
                  if (!followOpen) track("follow_panel_opened", { target_kind: "promise" });
                  setFollowOpen(!followOpen);
                }}
                className="w-full cursor-pointer rounded-control bg-ink px-4 py-2.5 text-sm font-semibold text-bg hover:opacity-90"
              >
                {followOpen ? "Close" : "Follow this promise"}
              </button>
              {!followOpen && <p className="m-0 text-center text-caption text-muted">Hear when it moves, or when its deadline passes in silence.</p>}
              {followOpen && <FollowPanel id={`follow-${f.id}`} target={{ kind: "promise", id: f.id }} />}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-label">
                {runHref && (
                  <a href={runHref} onClick={() => track("run_in_sandbox_clicked", { promise_id: f.id })} className="font-medium">
                    Run in the sandbox
                  </a>
                )}
                <a href={`/?card=${f.id}#contribute`} className="font-medium">
                  Add evidence
                </a>
              </div>
            </div>
          </div>
          {review && (
            <p className="m-0 px-1 text-caption text-muted" title={review.kind === "automated" ? AI_JOURNALIST_NOTE : undefined}>
              <span aria-hidden className="text-good">✓ </span>
              Checked by {reviewerLabel(review)} on {longDate(review.on)}
              {f.editor_check_required ? "; human editor review to come" : ""}. <a href="/method#reviews">What that means</a>
            </p>
          )}
          {updated && (
            <p className="m-0 px-1 text-caption text-muted">
              Last updated <time dateTime={updated}>{longDate(updated)}</time>
            </p>
          )}
        </aside>

        <div className="grid min-w-0 gap-10 lg:col-start-1 lg:row-start-1">
          {f.status_note && (
            <Section id={`stands-${f.id}`} title="Where it stands">
              <p className="m-0 max-w-[65ch] leading-relaxed text-ink">{f.status_note}</p>
            </Section>
          )}

          <Section id={`timeline-${f.id}`} title="What has happened">
            <ol className="m-0 grid list-none p-0" aria-label="Timeline">
              {events.map((e, i) => (
                <li key={`${e.date}-${i}`} className={`relative grid grid-cols-[72px_14px_minmax(0,1fr)] items-start gap-3 pb-5 text-sm last:pb-0 ${e.today ? "font-semibold text-debt-ink" : ""}`}>
                  <span className="pt-px text-[12.5px] text-muted">{e.today ? "Today" : monthYear(e.date)}</span>
                  <span className="relative flex justify-center pt-1.5">
                    <span className={`relative z-10 size-[9px] rounded-full ${e.today ? DOT.today : (DOT[e.type] ?? "bg-ink")}`} />
                    {i < events.length - 1 && <span aria-hidden className="absolute bottom-[-26px] top-3 w-px bg-line-strong" />}
                  </span>
                  <span className="leading-relaxed">
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
          </Section>

          {p?.cost_note && (
            <Section id={`cost-${f.id}`} title="About the cost">
              <p className="m-0 max-w-[65ch] leading-relaxed text-muted">{p.cost_note}</p>
              {p.cost_sources?.length ? (
                <ul className="m-0 grid list-none gap-1 p-0 text-label">
                  {p.cost_sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          )}

          <ContractsStrip card={card} />

          {f.replies.length > 0 && (
            <Section id={`replies-${f.id}`} title="Right of reply">
              {f.replies.map((r, i) => (
                <blockquote key={i} className="m-0 grid gap-1 rounded-control bg-sunk p-4 text-sm">
                  <span className="text-caption text-muted">{longDate(r.date)}</span>
                  <span>{r.text}</span>
                  {r.editor_response && <span className="text-label text-muted">Editors: {r.editor_response}</span>}
                </blockquote>
              ))}
            </Section>
          )}

          <Section id={`more-${f.id}`} title="More detail">
            <div className="border-t border-line">
              <Fold title={`Sources (${f.sources.length})`}>
                <ul className="m-0 grid list-none gap-1.5 p-0">
                  {f.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
                {f.origin === "reader_submission" && <p className="m-0 text-muted">Started from a reader submission{f.credit ? `, sent by ${f.credit}` : ""}.</p>}
              </Fold>
              {f.versions.length > 1 && (
                <Fold title={`Earlier wording (${f.versions.length - 1})`}>
                  <ol className="m-0 grid list-none gap-3 p-0">
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
                </Fold>
              )}
              {f.corrections.length > 0 && (
                <Fold title={`Corrections (${f.corrections.length}): what we fixed, in public`}>
                  <ol className="m-0 grid list-none gap-3 p-0">
                    {f.corrections.map((c, i) => (
                      <li key={i} className="grid gap-1 border-l-2 border-line-strong pl-3">
                        <span className="text-caption text-muted">
                          Corrected on {longDate(c.date)}: {correctionTarget(c, f)}
                        </span>
                        <span>{c.reason}</span>
                        <span className="text-label text-muted">Was: {correctionValue(c, c.was)}</span>
                        <span className="text-label text-muted">Now: {correctionValue(c, c.now)}</span>
                        {c.source_url && (
                          <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-label">
                            Source for the correction
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                </Fold>
              )}
              <Fold title="How cards are checked">
                <p className="m-0 text-muted">
                  Status follows the{" "}
                  <a href="https://github.com/xternal/public-ledger/blob/main/docs/PROMISE_STANDARD.md">promise standard</a>, the same for every party. A status
                  changes only on evidence. Anyone named on a card can reply, and replies are published next to it. {AI_JOURNALIST_NOTE}
                </p>
              </Fold>
            </div>
          </Section>

          {related.length > 0 && (
            <Section id={`related-${f.id}`} title="Related promises">
              <ul className="m-0 grid list-none border-t border-line p-0">
                {related.map((r) => (
                  <li key={r.id} className="border-b border-line">
                    <a href={`/promise/${r.id}`} className="grid gap-1 py-3 text-ink no-underline hover:underline">
                      <span className="text-sm font-medium">{r.headline}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                        {r.who}
                        <StatusPill status={r.status} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <a href={areaHref} className="justify-self-start text-label font-medium">
                Every promise in {AREA_LABEL[f.policy_area]}
              </a>
            </Section>
          )}
        </div>
      </div>
    </article>
  );
}
