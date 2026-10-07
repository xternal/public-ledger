import { createModel, decodeScenario, encodeScenario, type Model } from "@ledger/engine";
import type { T1Response } from "@ledger/schema";
import { clientKeyFrom, errorText, migrate, type Db } from "@ledger/server";
import { getT1, policyEngineProvider, RETRY_AFTER_S } from "@ledger/server/model";
import { getSeed } from "@/lib/data";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One round of PolicyEngine calls at most (each times out by 20 s). */
export const maxDuration = 30;

const provider = policyEngineProvider();
let model: Model | null = null;
/**
 * getServer() migrates once per process. A dev server started before migration
 * 003 (the t1_result table) would not have it, so apply pending migrations once
 * here too; it is a no-op once they are in.
 */
let migrated: Promise<unknown> | null = null;
function ensureMigrated(db: Db): Promise<unknown> {
  migrated ??= migrate(db).catch((e) => {
    migrated = null; // try again on the next request
    throw e;
  });
  return migrated;
}

const NO_STORE = { "cache-control": "no-store" };
const CACHED = { "cache-control": "public, max-age=3600" };

function answer(body: T1Response, status: number): Response {
  const headers: Record<string, string> =
    body.status === "ok" || body.status === "not_applicable"
      ? CACHED
      : body.status === "pending"
        ? { ...NO_STORE, "retry-after": String(RETRY_AFTER_S) }
        : NO_STORE;
  return Response.json(body, { status, headers });
}

/**
 * T1 for a scenario (docs/MODEL.md T1): PolicyEngine UK's microsimulation of
 * its tax and benefit levers. Answers at once from the cache, or "pending"
 * while PolicyEngine computes (about a minute for a new scenario); the browser
 * asks again after retry_after_s. The scenario code is public lever settings;
 * nothing about the reader is sent to PolicyEngine.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("s") ?? "";
  try {
    const seed = getSeed();
    model ??= createModel(seed.statement, seed.levers);
    const decoded = code ? decodeScenario(model, code) : null;
    if (!decoded) return answer({ status: "error", message: "That scenario link could not be read." }, 400);
    const { db } = await getServer();
    await ensureMigrated(db);
    const { response, httpStatus } = await getT1(
      db,
      // The canonical code, so equivalent links share one cache row. T1 runs on the year T0 shows.
      { scenario: encodeScenario(model, decoded.settings, decoded.baseYear), year: seed.baseYear, model, settings: decoded.settings },
      { provider, clientKey: clientKeyFrom(req.headers) },
    );
    return answer(response, httpStatus);
  } catch (e) {
    console.error("t1 failed:", errorText(e));
    return answer({ status: "error", message: "Something went wrong on our side. Try again in a few minutes." }, 500);
  }
}
