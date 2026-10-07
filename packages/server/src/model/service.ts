import { T1Result, type Settings, type T1Response } from "@ledger/schema";
import type { Db } from "../db";
import { errorText } from "../log";
import { rateLimit } from "../spam";
import { countUsage, type T1Outcome } from "../usage";
import { PolicyEngineError } from "./policyengine";
import type { SimulateStep, T1Household, T1Provider } from "./provider";
import { startYearOf, toPolicyEngineReform, type LeverModel, type ReformMapping } from "./reform";
import { TransformError } from "./transform";

/**
 * GET /api/t1 behind the route: answer from the cache, or move a computation
 * one step on. A request never waits on more than one round of calls to the
 * provider (the first request registers the reform and computes the example
 * households at once; each later one asks once whether the result is ready).
 * The reader's browser polls every RETRY_AFTER_S seconds.
 */
export const T1_CACHE_DAYS = 30;
export const RETRY_AFTER_S = 5;
/** New computations per client per day (an answer from the cache does not count). */
export const T1_DAILY_LIMIT = 30;
/** PolicyEngine takes about a minute for a new reform; give up after this. */
export const PENDING_LIMIT_MS = 10 * 60_000;
/** An error is answered from the cache for this long, then a new request tries again. */
export const ERROR_RETRY_MS = 10 * 60_000;

const DAY_MS = 86_400_000;

export interface T1Request {
  /** Canonical scenario code (?s=…). */
  scenario: string;
  /** Fiscal year, e.g. "2025-26". */
  year: string;
  model: LeverModel;
  settings: Settings;
}

export interface T1Deps {
  provider: T1Provider;
  /** Per-client key for the rate limit (the request IP); hashed with a daily salt, never stored. */
  clientKey: string;
  now?: Date;
  dailyLimit?: number;
  log?: (line: string) => void;
}

export interface T1Answer {
  response: T1Response;
  httpStatus: number;
  /** For aggregate usage counts only. */
  outcome: T1Outcome;
}

interface Row {
  status: "pending" | "ok" | "error";
  policy_id: number | null;
  result: unknown;
  error: string | null;
  requested_at: Date | string;
  updated_at: Date | string;
}

const MESSAGES = {
  upstream: "PolicyEngine could not run this scenario just now. Try again in a few minutes.",
  rate_limited: "Too many new scenarios from this connection today. Try again tomorrow.",
} as const;

const ms = (d: Date | string) => new Date(d).getTime();
const pending = (outcome: "started" | "pending" = "pending"): T1Answer => ({ response: { status: "pending", retry_after_s: RETRY_AFTER_S }, httpStatus: 202, outcome });
const upstreamError = (): T1Answer => ({ response: { status: "error", message: MESSAGES.upstream }, httpStatus: 502, outcome: "error" });

export async function getT1(db: Db, req: T1Request, deps: T1Deps): Promise<T1Answer> {
  const answer = await answerT1(db, req, deps);
  // Aggregate count only: no scenario, no client (privacy rule 3). Counting never fails the request.
  await countUsage(db, { event: "t1_requested", props: { outcome: answer.outcome } }, 1, deps.now ?? new Date()).catch(() => undefined);
  return answer;
}

async function answerT1(db: Db, req: T1Request, deps: T1Deps): Promise<T1Answer> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? ((line: string) => console.warn(line));
  const startYear = startYearOf(req.year);
  const mapping = toPolicyEngineReform(req.settings, req.model, startYear);
  if (mapping.modelled.length === 0) {
    return { response: { status: "not_applicable", not_modelled: mapping.not_modelled }, httpStatus: 200, outcome: "not_applicable" };
  }

  const [row] = await db.query<Row>(
    "SELECT status, policy_id, result, error, requested_at, updated_at FROM t1_result WHERE scenario = $1 AND year = $2",
    [req.scenario, req.year],
  );
  const t = now.getTime();

  if (row?.status === "ok" && t - ms(row.updated_at) < T1_CACHE_DAYS * DAY_MS) {
    const cached = T1Result.safeParse(row.result);
    if (cached.success) return { response: { status: "ok", result: cached.data }, httpStatus: 200, outcome: "cached" };
    log("t1: cached result no longer matches the schema; recomputing");
  }

  if (row?.status === "pending" && row.policy_id !== null) {
    if (t - ms(row.requested_at) < PENDING_LIMIT_MS) return check(db, req, deps, mapping, row.policy_id, row.result, startYear, now, log);
    await saveError(db, req, "pending_timeout", now);
    return upstreamError();
  }

  if (row?.status === "error" && t - ms(row.updated_at) < ERROR_RETRY_MS) return upstreamError();

  return start(db, req, deps, mapping, startYear, now, log);
}

/** A new computation: register the reform and compute the example households, in one round of calls. */
async function start(
  db: Db,
  req: T1Request,
  deps: T1Deps,
  mapping: ReformMapping,
  startYear: number,
  now: Date,
  log: (line: string) => void,
): Promise<T1Answer> {
  if (!(await rateLimit(db, deps.clientKey, "t1", deps.dailyLimit ?? T1_DAILY_LIMIT, now))) {
    return { response: { status: "error", message: MESSAGES.rate_limited }, httpStatus: 429, outcome: "rate_limited" };
  }
  let step: SimulateStep;
  let households: T1Household[];
  try {
    [step, households] = await Promise.all([
      deps.provider.simulate(mapping.data, startYear, null, now),
      deps.provider.households(mapping.data, startYear),
    ]);
  } catch (e) {
    log(`t1: start failed: ${errorText(e)}`);
    await saveError(db, req, codeOf(e), now);
    return upstreamError();
  }
  if (step.status === "ok") return finish(db, req, mapping, step, households, now, log);
  await db.query(
    `INSERT INTO t1_result (scenario, year, status, policy_id, result, error, polls, requested_at, updated_at, completed_at)
     VALUES ($1, $2, 'pending', $3, $4::jsonb, NULL, 0, $5, $5, NULL)
     ON CONFLICT (scenario, year) DO UPDATE SET status = 'pending', policy_id = EXCLUDED.policy_id, result = EXCLUDED.result,
       error = NULL, polls = 0, requested_at = EXCLUDED.requested_at, updated_at = EXCLUDED.updated_at, completed_at = NULL`,
    [req.scenario, req.year, step.handle, JSON.stringify({ households }), now.toISOString()],
  );
  return pending("started");
}

/** Ask the provider once whether the population result is ready. */
async function check(
  db: Db,
  req: T1Request,
  deps: T1Deps,
  mapping: ReformMapping,
  handle: number,
  partial: unknown,
  startYear: number,
  now: Date,
  log: (line: string) => void,
): Promise<T1Answer> {
  const households = (partial as { households?: T1Household[] } | null)?.households;
  if (!Array.isArray(households)) {
    await saveError(db, req, "missing_households", now);
    return upstreamError();
  }
  let step: SimulateStep;
  try {
    step = await deps.provider.simulate(mapping.data, startYear, handle, now);
  } catch (e) {
    log(`t1: check failed: ${errorText(e)}`);
    await saveError(db, req, codeOf(e), now);
    return upstreamError();
  }
  if (step.status === "pending") {
    await db.query("UPDATE t1_result SET polls = polls + 1, updated_at = $3 WHERE scenario = $1 AND year = $2", [
      req.scenario,
      req.year,
      now.toISOString(),
    ]);
    return pending();
  }
  return finish(db, req, mapping, step, households, now, log);
}

async function finish(
  db: Db,
  req: T1Request,
  mapping: ReformMapping,
  step: Extract<SimulateStep, { status: "ok" }>,
  households: T1Household[],
  now: Date,
  log: (line: string) => void,
): Promise<T1Answer> {
  for (const w of step.warnings) log(`t1: ${w}`);
  const parsed = T1Result.safeParse({
    scenario: req.scenario,
    year: req.year,
    quality: "modelled",
    modelled: mapping.modelled,
    not_modelled: mapping.not_modelled,
    households,
    ...step.population,
  });
  if (!parsed.success) {
    log(`t1: result failed the schema at ${parsed.error.issues[0]?.path.join(".") ?? "?"}`);
    await saveError(db, req, "invalid_result", now);
    return upstreamError();
  }
  await db.query(
    `INSERT INTO t1_result (scenario, year, status, policy_id, result, error, polls, requested_at, updated_at, completed_at)
     VALUES ($1, $2, 'ok', $3, $4::jsonb, NULL, 1, $5, $5, $5)
     ON CONFLICT (scenario, year) DO UPDATE SET status = 'ok', policy_id = EXCLUDED.policy_id, result = EXCLUDED.result,
       error = NULL, polls = t1_result.polls + 1, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at`,
    [req.scenario, req.year, step.handle, JSON.stringify(parsed.data), now.toISOString()],
  );
  return { response: { status: "ok", result: parsed.data }, httpStatus: 200, outcome: "ready" };
}

async function saveError(db: Db, req: T1Request, code: string, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO t1_result (scenario, year, status, error, requested_at, updated_at)
     VALUES ($1, $2, 'error', $3, $4, $4)
     ON CONFLICT (scenario, year) DO UPDATE SET status = 'error', error = EXCLUDED.error, result = NULL, updated_at = EXCLUDED.updated_at`,
    [req.scenario, req.year, code, now.toISOString()],
  );
}

function codeOf(e: unknown): string {
  if (e instanceof PolicyEngineError || e instanceof TransformError) return e.code;
  return "internal";
}
