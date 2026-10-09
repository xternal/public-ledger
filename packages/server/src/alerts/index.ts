// M3b alerts: change detection on content and data, fan-out to email and Telegram,
// weekly digest, the monthly "coming due" list, maintenance, and Atom feeds (PRD F7).
export { diffContent, changeId, type ChangeEvent, type ChangeType, type DiffOptions } from "./diff";
export {
  diffData,
  parseContract,
  parseStatement,
  headlineOf,
  headlineChanged,
  contractChangeText,
  contractLinkedText,
  editionText,
  EDITION_TITLE,
  type DataSide,
  type DataDiffOptions,
  type Headline,
  type LooseContract,
} from "./data";
export { runDataAlerts, readCursor, writeCursor, DATA_CURSOR, type DataRunReport } from "./catchup";
export { runComingDue, comingDueEmail, comingDueTelegram, comingDueEvent, isFirstWeek, type ComingDueReport, type DueCard } from "./deadlines";
export { parseCard, parseActor, actorsFrom, partyOf, cardTitle, type LooseActor, type LooseCard } from "./content";
export {
  gitRunner,
  resolveCommit,
  isAncestor,
  changedPromiseFiles,
  filesAt,
  dirAt,
  snapshotsFor,
  dataSnapshotsFor,
  PROMISES_DIR,
  ACTORS_DIR,
  CONTRACTS_DIR,
  STATEMENTS_DIR,
  type GitRunner,
  type Snapshots,
  type DataSnapshots,
} from "./git";
export {
  fanOut,
  processChanges,
  notifySubmitters,
  storeEvents,
  matchingSubscriptions,
  windowsFor,
  deliver,
  deliverText,
  type AlertContext,
  type FanOutReport,
  type MatchedSubscription,
  type Render,
} from "./fanout";
export { runDigest, runMaintenance, DELIVERY_RETENTION_DAYS, type DigestReport, type MaintenanceReport } from "./digest";
export { alertEmail, digestEmail, telegramText, submitterEmail, manageLinks, groupByCard, type MessageEvent, type ManageLinks } from "./messages";
export {
  atomFeed,
  buildFeed,
  cardEntries,
  contractEntries,
  costEntries,
  deadlineEntries,
  editionEntries,
  windowFeedTitle,
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
