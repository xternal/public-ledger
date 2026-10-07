"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { T1_LEVERS, T1Response, type T1Result } from "@ledger/schema";
import type { Change } from "@ledger/engine";
import { useScenario } from "./scenario";
import { track, type T1LeversBucket, type T1SecondsBucket } from "./analytics";

/**
 * T1 on the client: ask GET /api/t1?s=<code> for PolicyEngine's microsimulation
 * of the current scenario, poll while PolicyEngine computes, and share the
 * answer between the "Who gains and loses" panel and "People like me".
 *
 * Nothing starts on its own: PolicyEngine's API is a free public service, so
 * a request only begins when a reader presses the button. Only the scenario
 * code is sent; the reader's household and region choices never leave the page.
 */

/** Stop polling after this long and say so. */
export const T1_POLL_LIMIT_MS = 180_000;
/** Clamp the server's retry_after_s, so a bad value can neither hammer nor stall. */
const RETRY_MIN_S = 2;
const RETRY_MAX_S = 20;
/** One request to our own server should never hang longer than this. */
const REQUEST_TIMEOUT_MS = 30_000;
/** When the scenario changes mid-request, wait for the levers to settle before starting again. */
const RESTART_DELAY_MS = 1_000;
/** Results kept in memory for this page view, so going back to a scenario needs no new request. */
const CACHE_LIMIT = 12;
/** Lever deltas are floats from slider steps; round before using them as a key. */
const KEY_DP = 6;
const MS = 1_000;

export type T1FailReason = "timeout" | "network" | "server" | "busy" | "invalid";

export type T1Phase =
  | { kind: "idle" }
  | { kind: "pending"; startedAt: number; restarted: boolean }
  | { kind: "ready"; result: T1Result }
  | { kind: "not_applicable"; notModelled: string[] }
  | { kind: "error"; reason: T1FailReason };

const T1_SET: ReadonlySet<string> = new Set(T1_LEVERS);
export const isT1Lever = (id: string) => T1_SET.has(id);

/**
 * Taxes on spending. They reach every household's net income, including the
 * example households ("people like me"), but not the official poverty measure,
 * which counts income before them.
 */
export const INDIRECT_TAX_LEVERS: ReadonlySet<string> = new Set(["vat_standard", "fuel_duty"]);

/** The T1 inputs of a scenario: the levers PolicyEngine models and how far they moved. "" when none moved. */
export function t1Key(changes: readonly Change[]): string {
  return changes
    .filter((c) => c.kind === "lever" && isT1Lever(c.lever_id))
    .map((c) => `${c.lever_id}:${(c.delta ?? 0).toFixed(KEY_DP)}`)
    .sort()
    .join(",");
}

/** Changed levers PolicyEngine does not model (Bank Rate, departmental spending, measures), by lever id. */
export function notModelledIds(changes: readonly Change[]): string[] {
  return [...new Set(changes.filter((c) => !isT1Lever(c.lever_id)).map((c) => c.lever_id))];
}

const leversBucket = (n: number): T1LeversBucket => (n <= 1 ? "1" : n === 2 ? "2" : "3+");
const SECONDS_BUCKETS: [number, T1SecondsBucket][] = [
  [5, "0-5"],
  [30, "5-30"],
  [60, "30-60"],
  [120, "60-120"],
];
const secondsBucket = (s: number): T1SecondsBucket => SECONDS_BUCKETS.find(([max]) => s < max)?.[1] ?? "120+";

type Outcome = Exclude<T1Phase, { kind: "idle" } | { kind: "pending" }>;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One GET to /api/t1. Throws only when the caller aborted. The body is read
 * whatever the status: pending comes as 202, PolicyEngine failures as 502 with
 * `status: "error"`, and a rate limit as 429.
 */
async function getOnce(code: string, signal: AbortSignal): Promise<T1Response | { fail: T1FailReason }> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/t1?s=${encodeURIComponent(code)}`, {
      signal: ctl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) return { fail: "busy" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { fail: res.ok ? "invalid" : "server" };
    }
    const parsed = T1Response.safeParse(body);
    if (!parsed.success) return { fail: res.ok ? "invalid" : "server" };
    return parsed.data;
  } catch (e) {
    if (signal.aborted) throw e;
    return { fail: "network" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Ask, then poll every retry_after_s until PolicyEngine answers or T1_POLL_LIMIT_MS passes. */
async function pollT1(code: string, signal: AbortSignal): Promise<Outcome> {
  const started = Date.now();
  for (;;) {
    const res = await getOnce(code, signal);
    if ("fail" in res) return { kind: "error", reason: res.fail };
    switch (res.status) {
      case "ok":
        return { kind: "ready", result: res.result };
      case "not_applicable":
        return { kind: "not_applicable", notModelled: res.not_modelled };
      case "error":
        return { kind: "error", reason: "server" };
      case "pending": {
        const wait = Math.min(Math.max(res.retry_after_s, RETRY_MIN_S), RETRY_MAX_S) * MS;
        if (Date.now() - started + wait > T1_POLL_LIMIT_MS) return { kind: "error", reason: "timeout" };
        await sleep(wait, signal);
      }
    }
  }
}

export interface T1ContextValue {
  /** The scenario changes at least one lever T1 models. */
  applicable: boolean;
  /** State for the current scenario's T1 inputs. */
  phase: T1Phase;
  /** Start (or retry) the request for the current scenario. */
  start: () => void;
  /** Stop a pending request and go back to the button. */
  cancel: () => void;
  /** Lever ids changed in the current scenario that T1 does not model. */
  notModelled: string[];
}

const T1Context = createContext<T1ContextValue | null>(null);

interface Entry {
  key: string;
  phase: T1Phase;
}

const IDLE: T1Phase = { kind: "idle" };

export function T1Provider({ children }: { children: ReactNode }) {
  const { result, code } = useScenario();
  const key = useMemo(() => t1Key(result.changes), [result.changes]);
  const notModelled = useMemo(() => notModelledIds(result.changes), [result.changes]);

  const [entry, setEntry] = useState<Entry>({ key, phase: IDLE });
  const [cache, setCache] = useState<ReadonlyMap<string, T1Result>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);
  // The latest code and entry, for async work and effects that must not re-run on every change.
  const codeRef = useRef(code);
  const entryRef = useRef(entry);
  useEffect(() => {
    codeRef.current = code;
    entryRef.current = entry;
  });

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(
    (forKey: string, restarted: boolean, delayMs: number) => {
      abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setEntry({ key: forKey, phase: { kind: "pending", startedAt: Date.now(), restarted } });
      void (async () => {
        try {
          if (delayMs) await sleep(delayMs, ctl.signal);
          track("t1_requested", { levers_count: leversBucket(forKey.split(",").length) });
          const askedAt = Date.now();
          const out = await pollT1(codeRef.current, ctl.signal);
          if (ctl.signal.aborted) return;
          if (out.kind === "ready") {
            track("t1_ready", { seconds: secondsBucket((Date.now() - askedAt) / MS) });
            setCache((prev) => {
              const next = new Map(prev);
              next.set(forKey, out.result);
              while (next.size > CACHE_LIMIT) next.delete(next.keys().next().value!);
              return next;
            });
          } else if (out.kind === "error") {
            track("t1_failed", { reason: out.reason });
          }
          setEntry({ key: forKey, phase: out });
        } catch {
          // Aborted: a newer request or a cancel owns the state now.
        } finally {
          if (abortRef.current === ctl) abortRef.current = null;
        }
      })();
    },
    [abort],
  );

  // The scenario's T1 inputs changed: show a kept result, start again if a request was running, or go back to the button.
  useEffect(() => {
    const prev = entryRef.current;
    if (prev.key === key) return;
    const wasPending = prev.phase.kind === "pending";
    abort();
    const kept = cache.get(key);
    if (!key) setEntry({ key, phase: IDLE });
    else if (kept) setEntry({ key, phase: { kind: "ready", result: kept } });
    else if (wasPending) run(key, true, RESTART_DELAY_MS);
    else setEntry({ key, phase: IDLE });
  }, [key, cache, abort, run]);

  useEffect(() => abort, [abort]);

  const start = useCallback(() => {
    if (key) run(key, false, 0);
  }, [key, run]);

  const cancel = useCallback(() => {
    abort();
    setEntry({ key, phase: IDLE });
  }, [abort, key]);

  // Between a scenario change and the effect above, never show the previous scenario's state.
  const phase: T1Phase =
    entry.key === key
      ? entry.phase
      : cache.has(key)
        ? { kind: "ready", result: cache.get(key)! }
        : entry.phase.kind === "pending" && key
          ? { kind: "pending", startedAt: entry.phase.startedAt, restarted: true }
          : IDLE;

  const value = useMemo<T1ContextValue>(
    () => ({ applicable: key !== "", phase, start, cancel, notModelled }),
    [key, phase, start, cancel, notModelled],
  );

  return createElement(T1Context.Provider, { value }, children);
}

/** T1 state for the current scenario, or null outside a T1Provider (pages without the panel). */
export function useT1(): T1ContextValue | null {
  return useContext(T1Context);
}
