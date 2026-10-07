"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { SpamCheck } from "./SpamCheck";

/**
 * Follow a promise, an actor, a policy area or everything (PRD F7): RSS, email
 * (double opt-in) or the Telegram bot. No account. The consent text sits next
 * to the email form; Telegram shows it in the bot before anyone follows.
 * Nothing here sends analytics with ids; the server counts aggregates only.
 */

export type FollowKind = "promise" | "actor" | "area" | "all";
export interface FollowTarget {
  kind: FollowKind;
  id: string;
}
export interface FollowOptions {
  /** Bot username; null hides the Telegram option. */
  telegramBot: string | null;
  /** False when the site sends no email (MAIL_PROVIDER=off, e.g. an alpha before SES): the Email option is hidden. */
  email: boolean;
  consent: { version: string; points: string[] };
}

// These two must match feedPath and telegramPayload in @ledger/server/follow (M3b shared conventions).
function feedPath(t: FollowTarget): string {
  return t.kind === "all" ? "/feeds/all.xml" : `/feeds/${t.kind}/${t.id}.xml`;
}
function telegramPayload(t: FollowTarget): string {
  return t.kind === "all" ? "all" : `${{ promise: "p", actor: "a", area: "r" }[t.kind]}_${t.id}`;
}

type Channel = "email" | "telegram" | "rss";
const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", telegram: "Telegram", rss: "RSS feed" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const primary = "cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg no-underline hover:opacity-90 disabled:cursor-wait disabled:opacity-60";
const secondary =
  "cursor-pointer rounded-control bg-bg px-4 py-2 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)]";
const fieldLabel = "text-label font-medium text-muted";

function useOptions(given?: FollowOptions): FollowOptions | "loading" | "error" {
  const [fetched, setFetched] = useState<FollowOptions | "loading" | "error">("loading");
  useEffect(() => {
    if (given) return;
    let off = false;
    fetch("/api/follow/options")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: FollowOptions) => !off && setFetched(d))
      .catch(() => !off && setFetched("error"));
    return () => {
      off = true;
    };
  }, [given]);
  return given ?? fetched;
}

function useFollowerCount(t: FollowTarget): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    setCount(null);
    fetch(`/api/follow/count?kind=${t.kind}&id=${encodeURIComponent(t.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: unknown } | null) => !off && setCount(typeof d?.count === "number" ? d.count : null))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [t.kind, t.id]);
  return count;
}

export interface FollowPanelProps {
  /** Element id (the opening button's aria-controls). */
  id: string;
  /** What to follow. Omit and pass `areas` to let the reader pick a policy area or everything. */
  target?: FollowTarget;
  areas?: { id: string; label: string }[];
  /** From a server component; fetched from /api/follow/options when omitted. */
  options?: FollowOptions;
}

export function FollowPanel({ id, target, areas, options }: FollowPanelProps) {
  const opts = useOptions(options);
  const [picked, setPicked] = useState<FollowTarget>(target ?? { kind: "all", id: "*" });
  const t = target ?? picked;
  const [channel, setChannel] = useState<Channel>("email");
  const count = useFollowerCount(t);
  const bot = typeof opts === "object" ? opts.telegramBot : null;
  const email = typeof opts === "object" ? opts.email : true;
  const channels: Channel[] = [...(email ? (["email"] as const) : []), ...(bot ? (["telegram"] as const) : []), "rss"];
  const active = channels.includes(channel) ? channel : channels[0]!;

  return (
    <div id={id} className="grid gap-4 rounded-control bg-sunk p-3.5 sm:p-4">
      <p className="m-0 text-label text-muted">Get an alert when a status, deadline, wording or cost changes, or when someone named replies. No account needed.</p>

      {!target && areas && (
        <div className="grid max-w-[340px] gap-1.5">
          <label htmlFor={`${id}-what`} className={fieldLabel}>
            What to follow
          </label>
          <select
            id={`${id}-what`}
            className="select"
            value={`${picked.kind}:${picked.id}`}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(":");
              setPicked({ kind: kind as FollowKind, id: rest.join(":") });
            }}
          >
            <option value="all:*">Every promise</option>
            {areas.map((a) => (
              <option key={a.id} value={`area:${a.id}`}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={`${fieldLabel} mb-1.5 p-0`}>How do you want alerts?</legend>
        <div className="flex flex-wrap gap-1.5">
          {channels.map((c) => (
            <label
              key={c}
              className="cursor-pointer rounded-full bg-bg px-3 py-1 text-label font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)] has-[:checked]:bg-ink has-[:checked]:text-bg has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-solid"
            >
              <input type="radio" name={`${id}-channel`} value={c} checked={active === c} onChange={() => setChannel(c)} className="sr-only" />
              {CHANNEL_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Hidden rather than unmounted, so switching channels keeps what was typed and the finished spam check. */}
      <div hidden={active !== "email"}>
        {opts === "loading" ? (
          <p className="m-0 min-h-[120px] text-label text-muted">Loading…</p>
        ) : opts === "error" ? (
          <p role="alert" className="m-0 text-label text-bad">
            Email alerts are not available right now. Try again later, or use the RSS feed.
          </p>
        ) : (
          <EmailForm id={id} target={t} consent={opts.consent.points} />
        )}
      </div>
      {bot && (
        <div hidden={active !== "telegram"}>
          <TelegramOption target={t} bot={bot} />
        </div>
      )}
      <div hidden={active !== "rss"}>
        <RssOption id={id} target={t} />
      </div>

      <p className="m-0 text-caption text-muted">
        {count !== null && (
          <>
            <b className="font-semibold text-ink">{count.toLocaleString("en-GB")} people</b> follow this.{" "}
          </>
        )}
        We never show who follows what.
      </p>
    </div>
  );
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; message: string } | { kind: "error"; message: string; field?: "email" };

function EmailForm({ id, target, consent }: { id: string; target: FollowTarget; consent: string[] }) {
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState<"instant" | "weekly">("instant");
  const [state, setState] = useState<SendState>({ kind: "idle" });
  // A solved spam check is accepted once; a new widget (new key) solves a fresh one for the next try.
  const [spamKey, setSpamKey] = useState(0);
  const payload = useRef<string | null>(null);
  const onPayload = useCallback((p: string | null) => {
    payload.current = p;
  }, []);
  const input = useRef<HTMLInputElement>(null);

  const waitForSpamCheck = async (ms = 10_000) => {
    const until = Date.now() + ms;
    while (!payload.current && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
    return payload.current;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.kind === "sending") return;
    if (!EMAIL.test(email.trim())) {
      setState({ kind: "error", field: "email", message: "Enter an email address, like name@example.com." });
      input.current?.focus();
      return;
    }
    setState({ kind: "sending" });
    const altcha = await waitForSpamCheck();
    if (!altcha) {
      setState({ kind: "error", message: "The spam check did not finish. Wait a moment and press the button again." });
      return;
    }
    payload.current = null;
    setSpamKey((k) => k + 1);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), targets: [target], cadence, altcha }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; field?: string };
      if (res.ok) setState({ kind: "sent", message: data.message ?? "Check your inbox to confirm." });
      else setState({ kind: "error", field: data.field === "email" ? "email" : undefined, message: data.message ?? "Something went wrong. Please try again." });
    } catch {
      setState({ kind: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  };

  const errId = `${id}-email-status`;
  const consentId = `${id}-consent`;
  const sent = state.kind === "sent";
  // The button disappears on success: move focus to the result, and back to the field on "use a different address".
  const done = useRef<HTMLParagraphElement>(null);
  const reset = useRef(false);
  useEffect(() => {
    if (sent) done.current?.focus();
    else if (reset.current) input.current?.focus();
    reset.current = false;
  }, [sent]);

  return (
    <form noValidate onSubmit={submit} className="grid gap-3.5">
      {!sent && (
        <>
          <div className="grid max-w-[400px] gap-1.5">
            <label htmlFor={`${id}-email`} className={fieldLabel}>
              Email
            </label>
            <input
              ref={input}
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              className="field-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={state.kind === "error" && state.field === "email"}
              aria-describedby={state.kind === "error" ? errId : undefined}
              required
            />
          </div>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className={`${fieldLabel} mb-1.5 p-0`}>How often</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-cadence`} checked={cadence === "instant"} onChange={() => setCadence("instant")} className="size-4 accent-[var(--ink)]" />
                Each time it changes
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="radio" name={`${id}-cadence`} checked={cadence === "weekly"} onChange={() => setCadence("weekly")} className="size-4 accent-[var(--ink)]" />
                A weekly digest, on Mondays
              </label>
            </div>
          </fieldset>
          <div id={consentId} className="grid gap-1.5 rounded-control bg-bg p-3 text-caption text-muted shadow-[inset_0_0_0_1px_var(--line)]">
            <p className="m-0 font-semibold text-ink">Before you follow</p>
            <ul className="m-0 grid list-disc gap-1 pl-4">
              {consent.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <SpamCheck key={spamKey} onPayload={onPayload} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {!sent && (
          <button type="submit" className={primary} disabled={state.kind === "sending"} aria-describedby={consentId}>
            Agree and follow
          </button>
        )}
        {/* One live region for every state, so the result is announced without moving the form around. */}
        <div id={errId} role="status" aria-live="polite" className={sent ? "grid gap-1.5" : "text-label"}>
          {state.kind === "idle" && <span className="text-muted">We email you a link to confirm.</span>}
          {state.kind === "sending" && <span className="text-muted">Sending…</span>}
          {state.kind === "error" && <span className="text-bad">{state.message}</span>}
          {sent && (
            <>
              <p ref={done} tabIndex={-1} className="m-0 text-sm font-semibold">
                {state.message}
              </p>
              <p className="m-0 text-label text-muted">Nothing is followed until you press the button in that email. If it is not there in a few minutes, check your spam folder.</p>
              <button
                type="button"
                onClick={() => {
                  reset.current = true;
                  setState({ kind: "idle" });
                  setEmail("");
                }}
                className="cursor-pointer justify-self-start bg-transparent p-0 text-label font-medium text-accent underline underline-offset-2"
              >
                Use a different address
              </button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}

function TelegramOption({ target, bot }: { target: FollowTarget; bot: string }) {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 max-w-[60ch] text-sm">
        Open our bot in Telegram. It tells you what we store, then you press Follow. Send /stop at any time to delete everything.
      </p>
      <a href={`https://t.me/${bot}?start=${telegramPayload(target)}`} target="_blank" rel="noopener noreferrer" className={`justify-self-start ${primary}`}>
        Open in Telegram
      </a>
    </div>
  );
}

function RssOption({ id, target }: { id: string; target: FollowTarget }) {
  const path = feedPath(target);
  const [origin, setOrigin] = useState("");
  const [note, setNote] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setNote(""), [path]);
  const url = `${origin}${path}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied.");
    } catch {
      field.current?.select();
      setNote("Select the address and copy it.");
    }
  };

  return (
    <div className="grid gap-2.5">
      <p className="m-0 max-w-[60ch] text-sm">Add this feed to any feed reader. It stores nothing about you.</p>
      <div className="flex max-w-[560px] flex-wrap gap-2">
        <label htmlFor={`${id}-feed`} className="sr-only">
          Feed address
        </label>
        <input ref={field} id={`${id}-feed`} readOnly value={url} className="field-input min-w-0 flex-1 basis-[240px]" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy} className={secondary}>
          Copy link
        </button>
      </div>
      <span className="flex flex-wrap items-center gap-3">
        <a href={path} className="text-label font-medium">
          Open the feed
        </a>
        <span aria-live="polite" className="text-caption text-muted">
          {note}
        </span>
      </span>
    </div>
  );
}

/** A Follow button with its panel, for pages without one (actor pages, the promise list). */
export function FollowButton({
  label,
  trackKind,
  ...panel
}: Omit<FollowPanelProps, "id"> & { label: string; trackKind: "promise" | "actor" | "area" }) {
  const [open, setOpen] = useState(false);
  const id = `follow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <div className="grid w-full justify-items-start gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) track("follow_panel_opened", { target_kind: trackKind });
          setOpen(!open);
        }}
        className={secondary}
      >
        {label}
      </button>
      {open && (
        <div className="w-full max-w-[620px]">
          <FollowPanel id={id} {...panel} />
        </div>
      )}
    </div>
  );
}
