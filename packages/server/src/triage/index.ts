// M3b triage: the editors' queue for reader submissions (PROMISE_STANDARD §8).
export { adminGate, adminCredentials, checkAdminAuth, isSameOrigin, ADMIN_HEADERS, type AdminAuth, type AdminCredentials } from "./auth";
export {
  listSubmissions,
  getSubmission,
  countByStatus,
  isStatusFilter,
  SUBMISSION_STATUSES,
  OPEN_STATUSES,
  REJECT_REASONS,
  REJECT_REASON_LABEL,
  STATUS_FILTERS,
  type SubmissionView,
  type SubmissionStatus,
  type RejectReason,
  type StatusFilter,
} from "./submissions";
export { draftNewPromise, draftEvidence, suggestPromiseId, localCardReader, prefillSuggestion, type DraftFile } from "./draft";
export { openDraftPr, readRepoFile, GitHubError, type GitHubOptions, type DraftPrRequest } from "./github";
export {
  acceptSubmission,
  rejectSubmission,
  markDuplicate,
  isRejectReason,
  draftFor,
  prBody,
  prTitle,
  TRIAGE_ERRORS,
  type TriageContext,
  type TriageError,
  type TriageResult,
} from "./actions";
