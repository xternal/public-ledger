// Contribute (PRD F8): receiving reader submissions, automatic checks, delete-my-email.
export {
  receiveSubmission,
  allocateReference,
  referencePrefix,
  findDuplicate,
  lookupDeleteToken,
  deleteSubmitterEmail,
  countFormOpened,
  pruneSubmitterEmails,
  SUBMIT_DAILY_LIMIT,
  SUBMITTER_EMAIL_RETENTION_DAYS,
  TURNED_DOWN_RETENTION_MONTHS,
  pruneTurnedDownSubmissions,
  DUPLICATE_WINDOW_DAYS,
  DUPLICATE_TIME_SECONDS,
  type ReceiveResult,
  type ReceiveDeps,
  type DeleteResult,
  type DeleteTokenInfo,
} from "./submissions";
export { runAutoChecks, type AutoCheckDeps, type SubmissionChecks } from "./checks";
export { validateSubmission, FIELD_MESSAGES, LIMITS, type FieldErrors, type IntakeRules, type ValidSubmission } from "./validate";
export { normaliseUrl, parseVideoTime, formatVideoTime, type NormalisedUrl } from "./normalise";
export { intakeContent, loadIntakeContent, type IntakeContent } from "./content";
export { prefillSubmission, DEFAULT_PREFILL_MODEL, type PrefillClient, type PrefillSuggestion, type PrefillOutcome } from "./prefill";
export { archiveUrl, type ArchiveResult } from "./archive";
export { safeFetch, assertPublicUrl, isPublicAddress, BlockedUrlError, type Fetch, type Lookup } from "./ssrf";
export { matchQuote, normaliseForMatch, htmlToText, transcriptFromJson3, type QuoteMatch, type SourceText } from "./text";
