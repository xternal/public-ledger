// M3b alerts: change detection on content, fan-out to email and Telegram,
// weekly digest, maintenance, and Atom feeds (PRD F7).
export { diffContent, changeId, type ChangeEvent, type ChangeType, type DiffOptions } from "./diff";
export { parseCard, parseActor, actorsFrom, partyOf, cardTitle, type LooseActor, type LooseCard } from "./content";
export { gitRunner, resolveCommit, changedPromiseFiles, filesAt, dirAt, snapshotsFor, PROMISES_DIR, ACTORS_DIR, type GitRunner, type Snapshots } from "./git";
export {
  fanOut,
  processChanges,
  notifySubmitters,
  storeEvents,
  matchingSubscriptions,
  deliver,
  type AlertContext,
  type FanOutReport,
  type MatchedSubscription,
} from "./fanout";
export { runDigest, runMaintenance, DELIVERY_RETENTION_DAYS, type DigestReport, type MaintenanceReport } from "./digest";
export { alertEmail, digestEmail, telegramText, submitterEmail, manageLinks, groupByCard, type MessageEvent, type ManageLinks } from "./messages";
export {
  atomFeed,
  buildFeed,
  cardEntries,
  cardsForFeed,
  feedEntries,
  feedPath,
  tagUri,
  xmlEscape,
  FEED_CONTENT_TYPE,
  type AtomEntry,
  type FeedKind,
  type FeedMeta,
} from "./feed";
export { STATUS_LABEL, EVENT_LABEL, AREA_LABEL, ukDate, ukToday, costRangeText } from "./labels";
export { errorText } from "./log";
