import { CONFIRM_TTL_DAYS } from "@ledger/server/follow";
import { DELIVERY_RETENTION_DAYS } from "@ledger/server/alerts";
import { SUBMITTER_EMAIL_RETENTION_DAYS } from "@ledger/server/intake";
import { loadConfig } from "@ledger/server";
import { ALPHA_COOKIE_MAX_AGE } from "@ledger/server/alpha";

/**
 * Words for the privacy notice (/privacy), shared by the page, its structured
 * data and llms.txt. Facts come from the code and the draft DPIA (8 October
 * 2026); the retention periods are the constants the code enforces, so the
 * page cannot drift from what actually happens. Anything the code cannot show
 * (provider log and backup retention, transfer safeguards) is marked
 * "to confirm" on the page until the owner confirms it.
 */

export const PRIVACY_TITLE = "Privacy notice";
export const PRIVACY_DESCRIPTION =
  "What Public Ledger keeps about you and why: alerts by email or Telegram, submissions and the Your MP postcode search. Who runs it, which services handle your data, how long we keep it, and how to have it deleted.";
/** The date this notice last changed in substance. */
export const PRIVACY_UPDATED = "2026-10-08";
/** Where readers write about their data (set up and forwarding, 8 October 2026). */
export const PRIVACY_EMAIL = "privacy@ledgergov.uk";
/** The controller: the company that runs Public Ledger and holds readers' data. */
export const CONTROLLER = {
  name: "Empatiq Limited",
  companyNumber: "13746700",
  office: { street: "66 Paul Street", locality: "London", postcode: "EC2A 4NA" },
} as const;
/** Declared by the owner on 8 October 2026; if it ever changes, say so here and in the README. */
export const CONTROLLER_INTERESTS =
  "Empatiq Limited has no clients or contracts with government, political parties or any body this site tracks. If that ever changes, it will be declared here.";
export const CONTROLLER_OFFICE = `${CONTROLLER.office.street}, ${CONTROLLER.office.locality} ${CONTROLLER.office.postcode}`;
/**
 * The ICO registration number (ZB…), once the ICO issues it. The fee is paid
 * (tier 1; application C2054431, 8 October 2026). Until then the page says
 * "registration number to follow". One-line change: set the number here.
 */
export const ICO_REGISTRATION_NUMBER: string | null = null;
/** Applications to be an editor are deleted this long after we decide, if the applicant does not join. */
export const EDITOR_APPLICATION_RETENTION_MONTHS = 6;

export const ICO_COMPLAINTS_URL = "https://ico.org.uk/make-a-complaint/";
export const ICO_PHONE = "0303 123 1113";

/** Follower counts appear only at or above this; the page says the number the site actually uses. */
export function followerThreshold(): number {
  try {
    return Math.max(1, loadConfig().followerCountThreshold);
  } catch {
    return 50; // the default in config.ts
  }
}

export interface RetentionRow {
  what: string;
  howLong: string;
  /** True where the code cannot show it and the owner still has to confirm. */
  toConfirm?: boolean;
}

/** How long each thing is kept, from the code. */
export function retention(): RetentionRow[] {
  const alphaDays = Math.round(ALPHA_COOKIE_MAX_AGE / 86_400);
  return [
    { what: "Your alerts: your address and what you follow", howLong: "Until you stop your alerts or delete your data" },
    { what: "A sign-up or an addition nobody confirmed", howLong: `${CONFIRM_TTL_DAYS} days` },
    { what: "Which alert went to which subscriber", howLong: `${DELIVERY_RETENTION_DAYS} days` },
    { what: "Your email with a submission", howLong: `Until the editors decide, ${SUBMITTER_EMAIL_RETENTION_DAYS} days at most. Not kept at all if someone sent it first` },
    { what: "Your credit name", howLong: "On the card for good if it is published. Deleted if the editors turn it down" },
    { what: "What you sent in a submission", howLong: "Kept as the editors' record. We have not set an end date yet", toConfirm: true },
    {
      what: "An application to be an editor",
      howLong: `Deleted within ${EDITOR_APPLICATION_RETENTION_MONTHS} months if you do not join. If you do, kept while you are an editor and deleted ${EDITOR_APPLICATION_RETENTION_MONTHS} months after you stop`,
    },
    { what: "Scrambled codes made from your IP address, for rate limits", howLong: "Deleted at the next daily clean-up after the day ends: within about 28 hours" },
    { what: "Your postcode", howLong: "Not kept at all" },
    { what: "Daily usage counts", howLong: "Kept. They hold no personal data" },
    { what: "The testers' password cookie, if the site asks for one", howLong: `${alphaDays} days, in your browser` },
    { what: "Copies in database backups and our providers' logs", howLong: "A short time after you delete, until they expire", toConfirm: true },
  ];
}

export const PRIVACY_FAQ = (threshold: number): { q: string; a: string }[] => [
  {
    q: "Can anyone see what I follow?",
    a: `No. We never show who follows what. A count of followers appears only once ${threshold} or more people follow something, and nothing at all is shown below that.`,
  },
  {
    q: "Do you sell or share your lists?",
    a: "No, never. There are no ads. The services named on this page handle data only to run Public Ledger for us.",
  },
  {
    q: "Do you use cookies or tracking?",
    a: "No tracking cookies, no analytics scripts and no tracking in emails. The spam check runs in your browser and sets no cookies. Your share keeps your choices in your own browser, and the salary you type never leaves it.",
  },
];

/** One paragraph for llms.txt. */
export const PRIVACY_SUMMARY = `Public Ledger is run by ${CONTROLLER.name}, Pavel Guzhikov's company, independently of any party; ${CONTROLLER.name} is the controller and is registered with the ICO. Reading stores nothing. Alerts keep only an encrypted email address or Telegram chat and what is followed, on explicit consent; follows are never shown individually. Submitters' emails are deleted once editors decide, or after ${SUBMITTER_EMAIL_RETENTION_DAYS} days. Postcodes are never kept. Applications to be an editor are deleted within ${EDITOR_APPLICATION_RETENTION_MONTHS} months if the applicant does not join. Contact: ${PRIVACY_EMAIL}.`;
