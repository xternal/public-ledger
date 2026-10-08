"use client";

import { useEffect, useState } from "react";
import { dueInWindow, windowRange, windowWords, type DeadlineWindow, type Status } from "@ledger/schema";
import { longDate } from "@/lib/format";
import { TERMINAL, todayIso } from "@/lib/promises";
import { FollowButton, type FollowOptions } from "./FollowPanel";
import { StatusPill } from "./PromiseList";

/** A card as the list needs it: no more than that goes to the browser. */
export interface DueItem {
  id: string;
  deadline: string;
  status: Status;
  text: string;
  /** "Wes Streeting · Labour" */
  who: string;
}

/** The window the list shows; the follow panel offers every window. */
const SHOWN: DeadlineWindow = "next-12-months";
const FIRST = 3;

/**
 * "Coming up" on /promises (PRE_SHIP_REVIEW F9): the open promises due in the
 * next 12 months, nearest deadline first, and a way to follow what is due.
 * The page is built ahead of time, so the list is drawn for the build day
 * and redrawn for today's UK date once the page loads.
 */
export function ComingUp({ items, builtOn, windows, options }: { items: DueItem[]; builtOn: string; windows: { id: string; label: string }[]; options: FollowOptions }) {
  const [today, setToday] = useState(builtOn);
  const [all, setAll] = useState(false);
  useEffect(() => setToday(todayIso()), []);

  const due = dueInWindow(items, SHOWN, today);
  const shown = all ? due : due.slice(0, FIRST);
  const monthStart = windowRange(SHOWN, today).from;
  const pastDue = items.filter((c) => c.deadline < monthStart && !TERMINAL.includes(c.status)).length;
  const words = windowWords(SHOWN, today);

  return (
    <section id="coming-up" aria-labelledby="coming-up-h" className="grid content-start gap-3 rounded-control p-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="grid gap-1">
        <h2 id="coming-up-h" className="m-0 text-title font-semibold">
          Coming up
        </h2>
        <p className="m-0 text-label text-muted">
          {due.length ? (
            <>
              <b className="font-semibold text-ink tabular-nums">{due.length}</b> {due.length === 1 ? "promise is" : "promises are"} due from {words}, nearest first.
            </>
          ) : (
            <>No open promise is due from {words}.</>
          )}
        </p>
      </div>

      {due.length > 0 && (
        <ol className="m-0 grid list-none border-t border-line p-0">
          {shown.map((c) => (
            <li key={c.id} className="border-b border-line">
              <a href={`/promise/${c.id}`} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 py-2.5 text-ink no-underline hover:bg-sunk">
                <span className={`text-label font-semibold tabular-nums ${c.deadline < today ? "text-debt-ink" : ""}`}>
                  {longDate(c.deadline)}
                  {c.deadline < today && <span className="block text-caption font-medium">Deadline passed</span>}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="line-clamp-2 text-label font-medium leading-snug">“{c.text}”</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                    {c.who} <StatusPill status={c.status} />
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label">
        {due.length > FIRST && (
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="cursor-pointer bg-transparent p-0 font-medium text-accent underline underline-offset-2">
            {all ? "Show fewer" : `Show ${due.length - FIRST} more`}
          </button>
        )}
        {pastDue > 0 && (
          <a href="/promises?overdue=1&sort=deadline" className="font-medium">
            {pastDue} more {pastDue === 1 ? "is" : "are"} past {pastDue === 1 ? "its deadline" : "their deadlines"}
          </a>
        )}
      </div>

      <FollowButton label="Follow what’s due" trackKind="deadline_window" windows={windows} initial={{ kind: "deadline_window", id: "next-3-months" }} options={options} />
    </section>
  );
}
