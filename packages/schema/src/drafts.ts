import { z } from "zod";
import { IsoDate } from "./provenance";

/**
 * Drafts from automatic promise intake (M4): `content/drafts/<date>/<draft-id>.yaml`,
 * one per candidate promise the language model proposed and we found word for
 * word in a source. A draft is not a card: the site and `loadSeed` never read
 * drafts. Editors turn each one into a card in content/promises/ or delete it,
 * in the intake pull request (PROMISE_STANDARD §6, two editors).
 *
 * The source text the quote comes from is stored beside the drafts as
 * `content/drafts/<date>/sources/<source.id>.txt`, and `source_span` indexes
 * into it (JavaScript string offsets, i.e. UTF-16 code units), so CI can
 * re-check every quote offline with `draftViolations`.
 */

export const DraftSourceKind = z.enum(["hansard_statement", "hansard_pmqs", "hansard_wms", "govuk_press_release", "upload"]);
export type DraftSourceKind = z.infer<typeof DraftSourceKind>;

/** Filesystem-safe source id ("hansard-19e8c247", "wms-hcws353", "govuk-…", "upload-…"): it names the stored source file. */
export const DRAFT_SOURCE_ID = /^[a-z0-9][a-z0-9_-]{0,99}$/;
export const DRAFT_MIN_QUOTE_WORDS = 6;

const nullableText = z.string().min(1).nullable();

export const DraftFile = z.strictObject({
  draft: z.literal("llm_intake"),
  /** The day the drafts are filed under: the day of the sources harvested. */
  intake_date: IsoDate,
  source: z.strictObject({
    id: z.string().regex(DRAFT_SOURCE_ID, "a source id is lower-case letters, digits, - and _"),
    kind: DraftSourceKind,
    url: z.url(),
    title: z.string().min(1),
    date: IsoDate,
    venue_label: z.string().min(1),
  }),
  /** The speaker's words, exactly sourceText.slice(source_span[0], source_span[1]). */
  quote: z.string().min(1),
  source_span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  speaker: z.strictObject({
    name: z.string().min(1),
    role: nullableText,
    party: nullableText,
    member_id: z.number().int().positive().nullable(),
    actor_id: z.string().regex(/^[a-z0-9-]+$/).nullable(),
    /** segment = the source's own data says this person spoke these words; nearby = the name is printed just before; unverified = only the model says so. */
    check: z.enum(["segment", "nearby", "unverified"]),
  }),
  /** The model's suggestions from the source. All unverified: editors confirm each one. */
  suggested: z.strictObject({
    policy_area: nullableText,
    who: nullableText,
    how_much: nullableText,
    when: nullableText,
    funded_by: nullableText,
    deadline: nullableText,
  }),
  /** One sentence: why this is a future, checkable commitment. */
  why: z.string().min(1),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1),
  status: z.literal("to_review"),
});
export type DraftFile = z.infer<typeof DraftFile>;

/** Words as the exact-match check counts them: runs of letters, digits and £$€%, ignoring apostrophes and accents. */
export function quoteWords(s: string): number {
  const folded = s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['‘’ʼ`´]/gu, "");
  return folded.match(/[\p{L}\p{N}£$€%]+/gu)?.length ?? 0;
}

const show = (s: string) => JSON.stringify(s);

/**
 * Why a draft's quote cannot be trusted, or [] when it can: the span must lie
 * inside the source text, the text there must equal the quote character for
 * character, and the quote must be at least six words. This is the CI
 * guarantee of zero invented quotes (pnpm validate runs it on every draft).
 */
export function draftViolations(draft: Pick<DraftFile, "quote" | "source_span">, sourceText: string): string[] {
  const out: string[] = [];
  const [start, end] = draft.source_span;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > sourceText.length || start >= end) {
    out.push(`source_span [${start}, ${end}] is not inside the source text (${sourceText.length} characters)`);
  } else {
    const there = sourceText.slice(start, end);
    if (there !== draft.quote) {
      let i = 0;
      while (i < there.length && i < draft.quote.length && there[i] === draft.quote[i]) i++;
      out.push(
        `quote does not match the source text at [${start}, ${end}]: first difference at character ${i}, quote has ${show(draft.quote.slice(i, i + 20))}, source has ${show(there.slice(i, i + 20))}`,
      );
    }
  }
  const words = quoteWords(draft.quote);
  if (words < DRAFT_MIN_QUOTE_WORDS) out.push(`quote has ${words} word(s); a promise quote needs at least ${DRAFT_MIN_QUOTE_WORDS}`);
  return out;
}
