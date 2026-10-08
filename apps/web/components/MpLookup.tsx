"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { findMp, type LookupState } from "@/app/mp/actions";
import type { LookupResult } from "@ledger/server/mp";
import { LOOKUP_PRIVACY } from "@/lib/mp-copy";

const INITIAL: LookupState = { result: null };

type Problem = Exclude<LookupResult, { kind: "found" } | { kind: "choices" }>;

function message(r: Problem): string {
  switch (r.kind) {
    case "empty":
      return "Type a postcode, or the name of a constituency or MP.";
    case "unavailable":
      return "The lookup service is not answering right now. Try again in a minute, or pick your constituency from the list further down.";
    case "not_found":
      switch (r.reason) {
        case "postcode":
          return "We could not find that postcode. Check it and try again, or search by constituency or MP instead.";
        case "outcode":
          return "That is the first half of a postcode. Type the whole postcode, such as SW1A 1AA: one postcode area can span several constituencies.";
        case "short":
          return "Type at least two letters, or your postcode.";
        case "name":
          return "No constituency or sitting MP matches that. Check the spelling, or try your postcode.";
      }
  }
}

/**
 * The one search box on /mp. It posts to the server (a Server Action), which
 * finds the constituency and sends the reader to its page; it works without
 * JavaScript too. The postcode is never put in the address bar.
 */
export function MpLookup() {
  const [state, action, pending] = useActionState(findMp, INITIAL);
  // Held here so the box keeps what was typed after a search (React clears uncontrolled fields after a form action).
  const [value, setValue] = useState("");
  const status = useRef<HTMLDivElement>(null);
  const r = state.result;
  const problem = r && r.kind !== "found" && r.kind !== "choices" ? r : null;

  // Choices or a problem: take the reader to it, so screen readers and phones both land on the answer.
  useEffect(() => {
    if (r && r.kind !== "found") status.current?.focus();
  }, [r]);

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-2" noValidate>
        <label htmlFor="mp-q" className="text-label font-medium text-ink">
          Postcode, constituency or MP
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="mp-q"
            name="q"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="postal-code"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={80}
            placeholder="For example SW1A 1AA"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "mp-q-status mp-q-privacy" : "mp-q-privacy"}
            className="min-w-0 flex-1 rounded-control border border-line-strong bg-bg px-3.5 py-2.5 text-[17px] text-ink placeholder:text-faint aria-[invalid=true]:border-bad"
          />
          <button
            type="submit"
            disabled={pending}
            className="cursor-pointer rounded-control bg-ink px-5 py-2.5 text-[15px] font-semibold text-bg hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Finding…" : "Find my MP"}
          </button>
        </div>
        <p id="mp-q-privacy" className="m-0 text-caption text-muted">
          {LOOKUP_PRIVACY}
        </p>
      </form>

      <div id="mp-q-status" ref={status} tabIndex={-1} aria-live="polite" className="outline-none">
        {problem && <p className="m-0 rounded-control bg-sunk px-3.5 py-3 text-sm text-ink">{message(problem)}</p>}
        {r?.kind === "choices" && (
          <div className="grid gap-2">
            <p className="m-0 text-sm font-medium text-ink">Which one do you mean?</p>
            <ul className="m-0 grid list-none border-t border-line p-0">
              {r.choices.map((c) => (
                <li key={c.slug} className="border-b border-line">
                  <a href={`/mp/${c.slug}`} className="grid gap-0.5 px-3 py-2.5 text-ink no-underline transition-colors hover:bg-sunk">
                    <span className="text-[15px] font-medium">{c.mp ?? c.constituency}</span>
                    {c.mp && (
                      <span className="text-label text-muted">
                        MP for {c.constituency}
                        {c.party ? `, ${c.party}` : ""}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
