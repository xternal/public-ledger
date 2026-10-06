import type { Config } from "../config";
import type { Db } from "../db";
import { countUsage } from "../usage";
import { archiveUrl } from "./archive";
import { loadIntakeContent, type IntakeContent } from "./content";
import { normaliseUrl } from "./normalise";
import { createPrefillClient, DEFAULT_PREFILL_MODEL, prefillSubmission, type PrefillClient } from "./prefill";
import { assertPublicUrl, BlockedUrlError, safeFetch, systemLookup, type Fetch, type Lookup, type SafeResponse } from "./ssrf";
import {
  captionTracksFrom,
  excerpt,
  htmlToText,
  matchQuote,
  pickCaptionTrack,
  playerResponseFrom,
  transcriptFromJson3,
  wordCount,
  type QuoteMatch,
  type SourceText,
} from "./text";

/**
 * Automatic checks on a submission (PROMISE_STANDARD §8.2), run after the
 * reader has had their reference. Each step records its result; none can fail
 * the submission or reject it. Editors decide.
 */

export interface SubmissionChecks {
  duplicate_of?: string;
  claimed_date?: string;
  /** Why the link was not fetched (private address, port, scheme…). */
  blocked?: string;
  reachable?: boolean;
  http_status?: number;
  final_url?: string;
  reachable_error?: string;
  archived?: boolean;
  archive_method?: "save" | "availability";
  archive_error?: string;
  /** Where the text to match came from, or why there was none. */
  text?: "transcript" | "page" | "no_captions" | "unsupported_type" | "unreadable" | "none";
  /** true/false when a quote was checked against text; absent when there was nothing to check. */
  quote_matched?: boolean;
  quote_check?: "matched" | "not_found" | "no_quote" | "too_short" | "no_text";
  quote_near_video_time?: boolean;
  prefill?: "done" | "not_configured" | "refused" | "incomplete" | "invalid_output" | "failed";
  checked_at?: string;
}

export interface AutoCheckDeps {
  fetch?: Fetch;
  lookup?: Lookup;
  /** Claude client; null means no pre-fill. Defaults to one built from config.anthropicApiKey. */
  anthropic?: PrefillClient | null;
  /** Defaults to env PREFILL_MODEL, else claude-sonnet-5-5. */
  prefillModel?: string;
  content?: IntakeContent;
  now?: Date;
}

interface Row {
  id: string;
  kind: "new_promise" | "evidence";
  promise_id: string | null;
  evidence_type: string | null;
  url_normalised: string;
  video_time: string | null;
  claimed_actor: string | null;
  claimed_quote: string | null;
  status: string;
  checks: SubmissionChecks | null;
}

const MIN_QUOTE_WORDS = 3;
const EXCERPT_CHARS = 8_000;

async function readSourceText(page: SafeResponse, youtube: boolean, get: (url: string) => Promise<SafeResponse>): Promise<SourceText | NonNullable<SubmissionChecks["text"]>> {
  if (youtube) {
    const player = playerResponseFrom(page.body);
    const track = player ? pickCaptionTrack(captionTracksFrom(player)) : null;
    if (!track) return "no_captions";
    const captionsUrl = new URL(track.baseUrl, "https://www.youtube.com");
    if (!/(^|\.)youtube\.com$/.test(captionsUrl.hostname)) return "no_captions";
    captionsUrl.searchParams.set("fmt", "json3");
    const res = await get(captionsUrl.href);
    if (res.status !== 200 || !res.body.trim()) return "no_captions";
    const transcript = transcriptFromJson3(JSON.parse(res.body));
    return transcript.text ? transcript : "no_captions";
  }
  const type = page.contentType.toLowerCase();
  if (type.includes("html")) {
    const text = htmlToText(page.body);
    return text ? { source: "page", text } : "unreadable";
  }
  if (type.startsWith("text/plain")) return page.body.trim() ? { source: "page", text: page.body } : "unreadable";
  return "unsupported_type";
}

/**
 * Run (or re-run) the checks for one submission and store the results.
 * Moves status received → auto_checked; any other status is left alone.
 * Returns the stored checks, or null if there is no such submission.
 */
export async function runAutoChecks(db: Db, config: Config, reference: string, deps: AutoCheckDeps = {}): Promise<SubmissionChecks | null> {
  const [row] = await db.query<Row>(
    `SELECT id, kind, promise_id, evidence_type, url_normalised, video_time, claimed_actor, claimed_quote, status, checks
       FROM submission WHERE id = $1`,
    [reference],
  );
  if (!row) return null;
  const now = deps.now ?? new Date();
  const doFetch = deps.fetch ?? fetch;
  const userAgent = `Mozilla/5.0 (compatible; PublicLedgerBot/1.0; +${config.siteUrl})`;
  const headers = { "user-agent": userAgent, "accept-language": "en-GB,en;q=0.8" };
  // Reader-supplied links go through safeFetch, which pins each connection to the checked address.
  const get = (url: string) => safeFetch(url, { fetch: deps.fetch, lookup: deps.lookup, headers });
  const videoTime = row.video_time === null ? null : Number(row.video_time);
  const youtube = normaliseUrl(row.url_normalised).youtubeId !== null;

  const checks: SubmissionChecks = {};
  let archivedUrl: string | null = null;
  let source: SourceText | null = null;

  // SSRF guard first. A link to a private address is neither fetched nor sent to the archive.
  let blocked: string | null = null;
  try {
    await assertPublicUrl(new URL(row.url_normalised), deps.lookup ?? systemLookup);
  } catch (e) {
    blocked = e instanceof BlockedUrlError ? e.reason : "invalid";
  }
  // Reachable (and the page itself, for text) and the archive copy, in parallel.
  const archiveP = blocked ? null : archiveUrl(row.url_normalised, doFetch, { userAgent });
  const first: { page: SafeResponse } | { error: unknown } = blocked
    ? { error: new BlockedUrlError(blocked) }
    : await get(row.url_normalised).then(
        (page) => ({ page }),
        (error: unknown) => ({ error }),
      );
  if ("error" in first && first.error instanceof BlockedUrlError) blocked = first.error.reason; // e.g. a redirect to a private address

  if ("page" in first) {
    checks.reachable = first.page.status >= 200 && first.page.status < 400;
    checks.http_status = first.page.status;
    checks.final_url = first.page.finalUrl;
    if (checks.reachable) {
      try {
        const text = await readSourceText(first.page, youtube, get);
        if (typeof text === "string") checks.text = text;
        else {
          source = text;
          checks.text = text.source;
        }
      } catch {
        checks.text = youtube ? "no_captions" : "unreadable";
      }
    } else checks.text = "none";
  } else {
    checks.reachable = false;
    if (blocked) checks.blocked = blocked;
    else checks.reachable_error = (first.error as Error)?.name === "TimeoutError" ? "timed out" : "could not connect";
    checks.text = "none";
  }

  if (archiveP) {
    const archive = await archiveP;
    archivedUrl = archive.archivedUrl;
    checks.archived = archivedUrl !== null;
    if (archive.method) checks.archive_method = archive.method;
    if (archive.error && !archivedUrl) checks.archive_error = archive.error;
  } else checks.archived = false;

  // Exact match of the claimed words.
  let matched: QuoteMatch | null = null;
  if (!row.claimed_quote) checks.quote_check = "no_quote";
  else if (wordCount(row.claimed_quote) < MIN_QUOTE_WORDS) checks.quote_check = "too_short";
  else if (!source) checks.quote_check = "no_text";
  else {
    matched = matchQuote(row.claimed_quote, source, videoTime);
    checks.quote_matched = matched !== null;
    checks.quote_check = matched ? "matched" : "not_found";
    if (matched?.near_video_time !== undefined) checks.quote_near_video_time = matched.near_video_time;
  }

  // Claude pre-fill: suggestions for the editor, stored as unverified.
  let llmPrefill: Record<string, unknown> | null = null;
  try {
    let client = deps.anthropic;
    if (client === undefined) client = config.anthropicApiKey ? await createPrefillClient(config.anthropicApiKey) : null;
    const content = deps.content ?? (client ? await loadIntakeContent() : { cards: [], actors: [], policyAreas: [], venues: [] });
    const prefill = await prefillSubmission(
      {
        kind: row.kind,
        promise_id: row.promise_id,
        evidence_type: row.evidence_type,
        url: row.url_normalised,
        video_time: videoTime,
        claimed_actor: row.claimed_actor,
        claimed_quote: row.claimed_quote,
        claimed_date: row.checks?.claimed_date ?? null,
        source_excerpt: source ? excerpt(source, EXCERPT_CHARS, matched?.source_span, videoTime) : null,
        source_kind: source?.source ?? null,
        quote_matched: checks.quote_matched ?? null,
      },
      content,
      client,
      deps.prefillModel ?? process.env.PREFILL_MODEL ?? DEFAULT_PREFILL_MODEL,
    );
    checks.prefill = prefill.status;
    if (prefill.status === "done") llmPrefill = { unverified: true, model: prefill.model, generated_at: now.toISOString(), suggestion: prefill.suggestion };
  } catch {
    checks.prefill = "failed"; // e.g. the SDK or the content could not be loaded; the other checks still count
  }
  checks.checked_at = now.toISOString();

  // Keep what intake recorded (duplicate_of, claimed_date); replace earlier check results.
  const kept: SubmissionChecks = {};
  if (row.checks?.duplicate_of) kept.duplicate_of = row.checks.duplicate_of;
  if (row.checks?.claimed_date) kept.claimed_date = row.checks.claimed_date;
  await db.query(
    `UPDATE submission
        SET checks = $2, matched_quote = $3, archived_url = COALESCE($4, archived_url),
            llm_prefill = COALESCE($5, llm_prefill),
            status = CASE WHEN status = 'received' THEN 'auto_checked' ELSE status END
      WHERE id = $1`,
    [row.id, JSON.stringify({ ...kept, ...checks }), matched ? JSON.stringify(matched) : null, archivedUrl, llmPrefill ? JSON.stringify(llmPrefill) : null],
  );
  await countUsage(
    db,
    {
      event: "submission_auto_checked",
      props: {
        archived: checks.archived ? "yes" : "no",
        quote_matched: checks.quote_matched === undefined ? "na" : checks.quote_matched ? "yes" : "no",
        duplicate: row.checks?.duplicate_of ? "yes" : "no",
      },
    },
    1,
    now,
  );
  return { ...kept, ...checks };
}
