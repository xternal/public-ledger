import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PolicyArea, type ActorFile } from "@ledger/schema";
import { normaliseForMatch, wordCount } from "../intake/text";
import type { Candidate, CandidateSpeaker, HarvestReport, SourceDoc, SpeakerSegment } from "./types";

/**
 * Claude reads one source at a time and proposes candidate promises. The model
 * only proposes: every quote is then located in the source by us, and kept
 * only if it is there word for word (we store the source's own characters and
 * their offsets). Who said it comes from Hansard's own speaker data where the
 * source has it, not from the model. Nothing here publishes anything: the
 * result becomes drafts in a pull request that two editors review (invariant 8).
 */

export const DEFAULT_INTAKE_MODEL = "claude-opus-5-5";
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`) on the Claude API. */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Below this the model itself doubts an editor would accept it. Set from the first
 * live run (9 Sep 2026: 46 candidates; the 6 under 0.5 were procedural, such as
 * chairing a summit or "will perhaps talk to the Treasury").
 */
export const MIN_CONFIDENCE = 0.5;
export const MIN_QUOTE_WORDS = 6;
const MAX_CANDIDATES_PER_CALL = 8;
/** Longer sources are read in parts split at paragraph breaks (a long debate day). */
const CHUNK_CHARS = 300_000;
/** For press releases and uploads: how far before (and after) a quote the speaker's name may appear. */
const NEARBY_BEFORE = 600;
const NEARBY_AFTER = 300;

/** The one SDK method extraction uses, so tests can pass a stand-in client. */
export interface ExtractClient {
  beta: {
    messages: {
      create(
        body: Anthropic.Beta.MessageCreateParamsNonStreaming,
        options?: { timeout?: number; maxRetries?: number },
      ): PromiseLike<Anthropic.Beta.BetaMessage>;
    };
  };
}

export interface ExtractOptions {
  /** null = no API key: nothing is extracted and the report says so. */
  client: ExtractClient | null;
  model?: string;
  actors: ActorFile[];
  /** Quotes already on cards or in drafts, to skip duplicates. */
  known: string[];
}

export async function createExtractClient(apiKey: string): Promise<ExtractClient> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  return new AnthropicClient({ apiKey });
}

// ---------------------------------------------------------------- prompt

const SYSTEM = `You find political promises in UK public sources for Public Ledger, a neutral record of what politicians and parties promise and whether it happens. Editors check everything you propose; precision matters more than recall.

A promise (Public Ledger standard §1) is a statement by a person or organisation with power or seeking it that commits to a future, checkable change. In: "We will cap bus fares at £2 from January." Out: descriptions of the past or of what is already happening, opinions, values and aspirations with nothing checkable ("we want a fairer country"), predictions about other people's behaviour, questions, and promises the speaker attributes to someone else.

Who can make one here: ministers and the government (including a department speaking in its own press release), shadow ministers, party leaders and party spokespeople. A backbench MP counts only when committing their party or government. The Speaker and Deputy Speakers never make promises.

Rules for each candidate:
- quote: copy the speaker's words exactly as they appear in the source, character for character: one to three complete sentences that contain the commitment. No ellipses, no paraphrase, no added or changed words, no speaker names or headings. If you cannot copy it exactly, leave it out.
- speaker_name: the person (or "HM Government" for a department's own words in a press release) as named in the source.
- why: one plain sentence saying what future, checkable change is promised.
- policy_area: one of ${PolicyArea.options.join(", ")}; null if none fits.
- who, how_much, when, funded_by: only what the source itself says about who is affected, the money (as words, e.g. "£400 million a year"), timing and how it is paid for. Null when the source does not say. Never estimate.
- deadline: an ISO date only when the source names a specific date or month (use the last day of the month); otherwise null.
- confidence: 0 to 1, how likely an editor applying the standard above accepts this as a promise.

Propose each distinct commitment once, at most ${MAX_CANDIDATES_PER_CALL}, most specific and checkable first. Return an empty list when there are none; that is a common and correct answer.`;

/** Structured outputs accept `anyOf` (not type arrays) for nullable fields. */
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "speaker_name", "why", "policy_area", "who", "how_much", "when", "funded_by", "deadline", "confidence"],
        properties: {
          quote: { type: "string" },
          speaker_name: { type: "string" },
          why: { type: "string" },
          policy_area: nullable({ type: "string", enum: [...PolicyArea.options] }),
          who: nullable({ type: "string" }),
          how_much: nullable({ type: "string" }),
          when: nullable({ type: "string" }),
          funded_by: nullable({ type: "string" }),
          deadline: nullable({ type: "string" }),
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const shortText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim().slice(0, max) : null));

const ModelCandidate = z.object({
  quote: z.string(),
  speaker_name: z.string().transform((v) => v.trim().slice(0, 120)),
  why: z.string().transform((v) => v.trim().slice(0, 400)),
  policy_area: z
    .string()
    .nullable()
    .transform((v) => (v && (PolicyArea.options as readonly string[]).includes(v) ? (v as PolicyArea) : null)),
  who: shortText(400),
  how_much: shortText(300),
  when: shortText(200),
  funded_by: shortText(400),
  deadline: z
    .string()
    .nullable()
    .transform((v) => (v && isoDate.test(v) ? v : null)),
  confidence: z.number().transform((v) => Math.min(1, Math.max(0, v))),
});
const ModelOutput = z.object({ candidates: z.array(ModelCandidate) });
type ModelCandidate = z.infer<typeof ModelCandidate>;

function userMessage(doc: SourceDoc, part: string, partNo: number, parts: number): string {
  return [
    `Source: ${doc.title}`,
    `Kind: ${doc.venueLabel}`,
    `Date: ${doc.date}`,
    `URL: ${doc.url}`,
    parts > 1 ? `Part ${partNo} of ${parts}.` : "",
    doc.segments.length ? "Each contribution starts with a line naming the speaker." : "",
    "",
    "<source>",
    part,
    "</source>",
  ]
    .filter((l, i) => l !== "" || i > 5)
    .join("\n");
}

/** Split long text at paragraph breaks into parts of at most CHUNK_CHARS. */
export function chunks(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    if (end < text.length) {
      const brk = text.lastIndexOf("\n\n", end);
      if (brk > at) end = brk;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

// ---------------------------------------------------------------- locating quotes

/**
 * Every place the quote occurs in the text, as spans of the source's own
 * characters. Comparison ignores case, accents, punctuation and spacing, and
 * must start and end on word boundaries; anything else (a changed, added or
 * dropped word) is no match.
 */
export function locate(quote: string, text: string): [number, number][] {
  const q = normaliseForMatch(quote).text;
  if (!q) return [];
  const hay = normaliseForMatch(text);
  const spans: [number, number][] = [];
  for (let at = hay.text.indexOf(q); at !== -1; at = hay.text.indexOf(q, at + 1)) {
    const before = at === 0 || hay.text[at - 1] === " ";
    const after = at + q.length === hay.text.length || hay.text[at + q.length] === " ";
    if (!before || !after) continue;
    const start = hay.map[at]!;
    const last = hay.map[at + q.length - 1]!;
    let end = last + String.fromCodePoint(text.codePointAt(last)!).length;
    // Keep the sentence's closing punctuation (and a closing quote mark) when the model's copy ends a sentence.
    if (/[.!?]["”’')\]]*$/.test(quote.trimEnd())) {
      for (let k = 0; k < 3 && end < text.length && /[.!?”’"')\]]/.test(text[end]!); k++) end++;
    }
    spans.push([start, end]);
  }
  return spans;
}

const segmentAt = (segments: SpeakerSegment[], [start, end]: [number, number]) => segments.find((s) => s.start <= start && end <= s.end) ?? null;

/** The Speaker, Deputy Speakers and chairs keep order; they never make promises. */
const isChair = (s: Pick<SpeakerSegment, "name" | "role">) => /\b(deputy )?speaker\b|^(the )?chair\b|chair(man|woman)? of ways and means/i.test(s.role ?? "") || /^(mr|madam) (deputy )?speaker$/i.test(s.name);

const plain = (s: string) => normaliseForMatch(s).text;

/** The speaker's surname, or the whole name for organisations. */
function surname(name: string): string {
  const words = plain(name).split(" ");
  return words.length > 1 && !/government|department|ministry|office|treasury/.test(plain(name)) ? words.at(-1)! : plain(name);
}

function nameNearby(text: string, span: [number, number], name: string): boolean {
  const s = surname(name);
  if (!s || s.length < 3) return false;
  const window = plain(text.slice(Math.max(0, span[0] - NEARBY_BEFORE), Math.min(text.length, span[1] + NEARBY_AFTER)));
  return new RegExp(`(^| )${s}( |$)`).test(window);
}

/** A known actor for the speaker: the person first, then their party. Same rule for everyone. */
export function actorFor(actors: ActorFile[], name: string, party: string | null): string | null {
  const n = plain(name);
  const person = actors.find((a) => a.kind !== "party" && plain(a.name) === n);
  if (person) return person.id;
  if (/^(hm government|the government|government)$/.test(n)) return actors.find((a) => a.id === "hm-government")?.id ?? null;
  if (party) {
    const p = plain(party);
    const match = actors.find((a) => a.kind === "party" && (plain(a.name) === p || plain(a.name).startsWith(`${p} `) || plain(a.name) === `${p} party`));
    if (match) return match.id;
  }
  return null;
}

// ---------------------------------------------------------------- one source

type Report = Pick<HarvestReport, "candidates" | "dropped" | "errors">;

function speakerFor(doc: SourceDoc, span: [number, number], m: ModelCandidate, actors: ActorFile[]): CandidateSpeaker | { drop: string } {
  if (doc.segments.length) {
    const seg = segmentAt(doc.segments, span);
    if (!seg) return { drop: "quote crosses speakers or sits outside a contribution" };
    if (isChair(seg)) return { drop: "the chair does not make promises" };
    return { name: seg.name, role: seg.role, party: seg.party, memberId: seg.memberId, actorId: actorFor(actors, seg.name, seg.party), check: "segment" };
  }
  const name = m.speaker_name || "unknown";
  // A department's own words in its own GOV.UK press release: the publisher is the speaker.
  if (doc.kind === "govuk_press_release" && /^(hm government|the government|government)$/i.test(name.trim())) {
    return { name: "HM Government", role: doc.venueLabel.replace(/^Press release \((.*)\)$/, "$1"), party: null, memberId: null, actorId: actorFor(actors, "HM Government", null), check: "segment" };
  }
  const check = nameNearby(doc.text, span, name) ? "nearby" : "unverified";
  return { name, role: null, party: null, memberId: null, actorId: actorFor(actors, name, null), check };
}

async function askModel(client: ExtractClient, model: string, doc: SourceDoc, part: string, partNo: number, parts: number): Promise<ModelCandidate[] | { error: string }> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create(
      {
        model,
        max_tokens: 32_000,
        // The instructions are the same for every source, so they are cached across the day's calls.
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage(doc, part, partNo, parts) }],
        output_config: { effort: "high", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      },
      { timeout: 600_000, maxRetries: 2 },
    );
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { error: status ? `Claude API HTTP ${status}` : `Claude API ${(e as Error).name}` };
  }
  if (response.stop_reason === "refusal") return { error: `model declined (${response.stop_details?.category ?? "no category"})` };
  if (response.stop_reason === "max_tokens") return { error: "model output cut off (max_tokens)" };
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "model output was not JSON" };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { error: `model output did not match the schema (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})` };
  return parsed.data.candidates;
}

/** Decide, for one proposed candidate, whether it survives; never trusts the model's copy of the words. */
export function vet(
  doc: SourceDoc,
  m: ModelCandidate,
  ctx: { actors: ActorFile[]; known: string[]; model: string },
): { candidate: Candidate } | { reason: string } {
  if (m.confidence < MIN_CONFIDENCE) return { reason: "low confidence" };
  const spans = locate(m.quote, doc.text);
  if (!spans.length) return { reason: "quote not found verbatim in the source" };
  // Prefer an occurrence inside a contribution by the named speaker, then the first one.
  const own = doc.segments.length ? spans.find((sp) => segmentAt(doc.segments, sp) && plain(segmentAt(doc.segments, sp)!.name) === plain(m.speaker_name)) : undefined;
  const span = own ?? spans[0]!;
  const quote = doc.text.slice(span[0], span[1]);
  if (wordCount(quote) < MIN_QUOTE_WORDS) return { reason: "quote too short" };
  const q = plain(quote);
  if (ctx.known.some((k) => k.length >= 30 && (k.includes(q) || q.includes(k)))) return { reason: "already on a card or in a draft" };
  const speaker = speakerFor(doc, span, m, ctx.actors);
  if ("drop" in speaker) return { reason: speaker.drop };
  return {
    candidate: {
      sourceId: doc.id,
      quote,
      span,
      speaker,
      suggested: { policy_area: m.policy_area, who: m.who, how_much: m.how_much, when: m.when, funded_by: m.funded_by, deadline: m.deadline },
      why: m.why,
      confidence: Math.round(m.confidence * 100) / 100,
      model: ctx.model,
    },
  };
}

// ---------------------------------------------------------------- all sources

/** Claude proposes candidate promises per source; only verbatim quotes with exact spans survive. */
export async function extractFromSources(docs: SourceDoc[], opts: ExtractOptions): Promise<Report> {
  const report: Report = { candidates: [], dropped: [], errors: [] };
  if (!opts.client) {
    for (const d of docs) report.errors.push({ sourceId: d.id, message: "extraction skipped: ANTHROPIC_API_KEY not set" });
    return report;
  }
  const model = opts.model || DEFAULT_INTAKE_MODEL;
  // Duplicates are judged on normalised text: against cards, earlier drafts, and this run.
  const known = opts.known.map(plain).filter(Boolean);
  for (const doc of docs) {
    const parts = chunks(doc.text);
    for (let i = 0; i < parts.length; i++) {
      const out = await askModel(opts.client, model, doc, parts[i]!, i + 1, parts.length);
      if ("error" in out) {
        report.errors.push({ sourceId: doc.id, message: out.error });
        continue;
      }
      for (const m of out) {
        const r = vet(doc, m, { actors: opts.actors, known, model });
        if ("reason" in r) report.dropped.push({ sourceId: doc.id, reason: r.reason, quote: m.quote.slice(0, 300) });
        else {
          report.candidates.push(r.candidate);
          known.push(plain(r.candidate.quote));
        }
      }
    }
  }
  return report;
}
