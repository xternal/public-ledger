import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { loadConfig } from "../src/config";
import { decrypt, encrypt, lookupHash } from "../src/crypto";
import { type Db, testDb } from "../src/db";
import { outboxMailer, type Mailer } from "../src/mail";
import { telegramSender } from "../src/telegram-api";
import {
  actorsFrom,
  dataSnapshotsFor,
  diffData,
  fanOut,
  partyOf,
  readCursor,
  runDataAlerts,
  runDigest,
  type AlertContext,
  type DataSide,
  type GitRunner,
} from "../src/alerts";

/**
 * Data alerts (PRE_SHIP_REVIEW F8): contract and edition events from
 * data/build, from fixtures only (no network, no repository).
 */

const SITE = "https://ledger.test";
const config = loadConfig({ SITE_URL: SITE });
const T0 = new Date("2026-10-06T09:00:00Z");

// ---------------------------------------------------------------- fixtures

const ACTORS = [
  { id: "keir-starmer", name: "Keir Starmer", kind: "person", party_id: "labour", roles: [] },
  { id: "labour", name: "Labour Party", kind: "party", roles: [] },
];
const actorFiles = new Map(ACTORS.map((a) => [`content/actors/${a.id}.yaml`, stringify(a)]));
const actors = actorsFrom(actorFiles);

const KEY = "ocds-h6vhtk-058e4b";
function contract(snapshots: object[], over: Record<string, unknown> = {}) {
  return JSON.stringify({
    key: KEY,
    ocid: KEY,
    source: "find_a_tender",
    title: "Photo Voltaic Solar Panels",
    buyer: "SOUTH WESTERN AMBULANCE SERVICE NHS FOUNDATION TRUST",
    notice_url: "https://www.find-tender.service.gov.uk/Notice/063921-2025",
    record_url: "https://www.find-tender.service.gov.uk/api/1.0/ocdsRecordPackages/ocds-h6vhtk-058e4b",
    supplier: { name: "BRIGHT SPARK ENERGY SOLUTIONS LIMITED", companies_house_number: "15029600" },
    awarded_on: "2025-10-03",
    snapshots,
    ...over,
  });
}
const S1 = { fetched_at: "2026-10-01", value: { amount: 117502, currency: "GBP" }, end_date_planned: "2026-03-31" };
const S2 = { fetched_at: "2026-10-07", value: { amount: 125000, currency: "GBP" }, end_date_planned: "2026-06-30" };

function card(over: Record<string, unknown> = {}) {
  return stringify({
    id: "uk-great-british-energy-2024",
    actor_id: "keir-starmer",
    made_on: "2024-06-13",
    policy_area: "housing_env",
    status: "delivering",
    versions: [{ version: 1, text: "Great British Energy will be a publicly owned company.", recorded_on: "2024-06-13" }],
    events: [],
    replies: [],
    contracts: [KEY],
    ...over,
  });
}
const PATH = "content/promises/uk-great-british-energy-2024.yaml";

function statement(year: string, vintage: string, label: string, borrowing: number, receipts = 1300, kind = "forecast") {
  return JSON.stringify({
    meta: {
      fiscal_year: year,
      vintage,
      vintage_label: label,
      kind,
      sources: [{ id: "obr_efo", title: "OBR Economic and fiscal outlook", url: "https://obr.uk/efo/", published_on: "2026-03-03" }],
    },
    receipts: [{ id: "income_tax", bn: receipts, quality: "sourced", source_id: "obr_efo" }],
    spending: [{ id: "health", bn: receipts + borrowing, quality: "approx", source_id: "hmt_pesa" }],
    borrowing_bn: borrowing,
    borrowing_provenance: { quality: "sourced", source_id: "obr_efo" },
  });
}

const side = (o: Partial<DataSide> = {}): DataSide => ({ promises: new Map([[PATH, card()]]), contracts: new Map(), statements: new Map(), ...o });
const diff = (before: DataSide, after: DataSide, commit = "c0ffee1") => diffData(before, after, { commit, siteUrl: SITE, actors });

// ---------------------------------------------------------------- contract events

describe("contract events", () => {
  it("announce a new snapshot, numbers first: value and planned end, old → new", () => {
    const [e, ...rest] = diff(side({ contracts: new Map([[KEY, contract([S1])]]) }), side({ contracts: new Map([[KEY, contract([S1, S2])]]) }));
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      change_type: "contract",
      promise_id: "uk-great-british-energy-2024",
      actor_id: "keir-starmer",
      policy_area: "housing_env",
      url: `${SITE}/promise/uk-great-british-energy-2024#contracts-uk-great-british-energy-2024`,
      title: "Keir Starmer: “Great British Energy will be a publicly owned company.”",
    });
    expect(e!.summary).toBe(
      "Contract changed: value £125,000, was £117,502 (+£7,498, +6.4%); planned end 30 June 2026, was 31 March 2026. “Photo Voltaic Solar Panels”, South Western Ambulance Service NHS Foundation Trust.",
    );
  });

  it("announce a contract when readers first see it on the card: newly fetched, newly linked, or the card just funded", () => {
    const linked =
      "Contract linked: £117,502, “Photo Voltaic Solar Panels”, awarded 3 October 2025 by South Western Ambulance Service NHS Foundation Trust to Bright Spark Energy Solutions Limited. Planned end 31 March 2026.";
    // The nightly fetch found it for the first time.
    expect(diff(side(), side({ contracts: new Map([[KEY, contract([S1])]]) })).map((e) => e.summary)).toEqual([linked]);
    // An editor linked a contract that was already fetched.
    const fetched = new Map([[KEY, contract([S1])]]);
    expect(diff(side({ promises: new Map([[PATH, card({ contracts: [] })]]), contracts: fetched }), side({ contracts: fetched })).map((e) => e.summary)).toEqual([linked]);
    // The card reached "funded": its contracts appear on the page.
    expect(diff(side({ promises: new Map([[PATH, card({ status: "in_plan" })]]), contracts: fetched }), side({ contracts: fetched })).map((e) => e.change_type)).toEqual(["contract"]);
  });

  it("say nothing for contracts the card does not show, unfetched links, or no change", () => {
    const fetched = new Map([[KEY, contract([S1])]]);
    const early = side({ promises: new Map([[PATH, card({ status: "in_plan" })]]) });
    expect(diff(early, { ...early, contracts: new Map([[KEY, contract([S1, S2])]]) })).toEqual([]);
    expect(diff(side(), side())).toEqual([]);
    expect(diff(side({ contracts: fetched }), side({ contracts: fetched }))).toEqual([]);
    // A card that drops the link: nothing to announce.
    expect(diff(side({ contracts: fetched }), side({ promises: new Map([[PATH, card({ contracts: [] })]]), contracts: new Map([[KEY, contract([S1, S2])]]) }))).toEqual([]);
  });

  it("describe an actual end, and accept the object form of a link", () => {
    const ended = { ...S2, value: S1.value, end_date_actual: "2026-07-15", end_date_planned: "2026-03-31" };
    const ref = side({ promises: new Map([[PATH, card({ contracts: [{ ocid: KEY }] })]]) });
    const [e] = diff({ ...ref, contracts: new Map([[KEY, contract([S1])]]) }, { ...ref, contracts: new Map([[KEY, contract([S1, ended])]]) });
    expect(e!.summary).toMatch(/^Contract changed: ended 15 July 2026 \(planned end 31 March 2026\)\./);
  });

  it("keep ids stable across commits, so an overlapping run never announces one twice", () => {
    const before = side({ contracts: new Map([[KEY, contract([S1])]]) });
    const after = side({ contracts: new Map([[KEY, contract([S1, S2])]]) });
    expect(diff(before, after, "aaa")[0]!.id).toBe(diff(before, after, "bbb")[0]!.id);
  });
});

// ---------------------------------------------------------------- edition events

describe("edition events", () => {
  const year = (y: string, text: string) => new Map([[y, text]]);

  it("announce a new edition that changes the Statement, borrowing first, with what it was", () => {
    const [e, ...rest] = diff(
      side({ statements: year("2026-27", statement("2026-27", "EFO-2026-03", "OBR forecast, March 2026", 115.462, 1303.8)) }),
      side({ statements: year("2026-27", statement("2026-27", "EFO-2026-11", "OBR forecast, November 2026", 120.1, 1310.2)) }),
    );
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ change_type: "edition", promise_id: null, actor_id: null, policy_area: null, url: `${SITE}/#statement`, title: "The Statement: new official figures" });
    expect(e!.summary).toBe("2026-27 borrowing: £120bn, was £115bn. Income £1,310bn, was £1,304bn. Spending £1,430bn, was £1,419bn. OBR forecast, November 2026.");
  });

  it("stay quiet for corrections within an edition, and for a new edition the Statement shows no differently", () => {
    const march = statement("2026-27", "EFO-2026-03", "OBR forecast, March 2026", 115.4);
    expect(diff(side({ statements: year("2026-27", march) }), side({ statements: year("2026-27", statement("2026-27", "EFO-2026-03", "OBR forecast, March 2026", 130)) }))).toEqual([]);
    // £115.4bn and £115.2bn both show as £115bn.
    expect(diff(side({ statements: year("2026-27", march) }), side({ statements: year("2026-27", statement("2026-27", "EFO-2026-11", "OBR forecast, November 2026", 115.2)) }))).toEqual([]);
  });

  it("give the first figures for a new year, and keep ids per year and edition", () => {
    const after = side({ statements: year("2031-32", statement("2031-32", "EFO-2026-11", "OBR forecast, November 2026", 55)) });
    const [e] = diff(side(), after);
    expect(e!.summary).toBe("2031-32 borrowing: £55bn. Income £1,300bn, spending £1,355bn. First figures for this year: OBR forecast, November 2026.");
    expect(diff(side(), after, "other")[0]!.id).toBe(e!.id);
  });
});

// ---------------------------------------------------------------- reading data at two commits

/** A fake read-only git over two trees, as in alerts.test.ts. */
function fakeGit(tree: Record<string, Map<string, string>>, log: string[][] = [], history = ["aaa", "bbb"]): GitRunner {
  return (args) => {
    log.push(args);
    const [cmd, ...rest] = args;
    if (cmd === "rev-parse") {
      const ref = rest.at(-1)!.replace("^{commit}", "");
      if (ref === "HEAD") return "bbb\n";
      if (ref in tree) return `${ref}\n`;
      throw new Error("unknown revision");
    }
    if (cmd === "merge-base") {
      const [, a, b] = rest;
      if (history.includes(a!) && history.includes(b!) && history.indexOf(a!) <= history.indexOf(b!)) return "";
      throw new Error("not an ancestor");
    }
    if (cmd === "diff") {
      const [, , a, b, , dir] = rest;
      const paths = new Set([...tree[a!]!.keys(), ...tree[b!]!.keys()]);
      return [...paths].filter((p) => p.startsWith(`${dir}/`) && tree[a!]!.get(p) !== tree[b!]!.get(p)).join("\n");
    }
    if (cmd === "ls-tree") return [...tree[rest[2]!]!.keys()].filter((p) => p.startsWith(`${rest.at(-1)!}/`)).join("\n");
    if (cmd === "show") {
      const [sha, path] = rest[0]!.split(":");
      const t = tree[sha!]?.get(path!);
      if (t === undefined) throw new Error("missing");
      return t;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const tree = (o: { card?: string; contract?: string; statements?: Record<string, string> }) =>
  new Map<string, string>([
    ...actorFiles,
    ...(o.card ? ([[PATH, o.card]] as [string, string][]) : []),
    ["content/promises/uk-other-2026.yaml", card({ id: "uk-other-2026", contracts: [] })],
    ...(o.contract ? ([[`data/build/contracts/${KEY}.json`, o.contract]] as [string, string][]) : []),
    ...Object.entries(o.statements ?? {}).map(([y, t]) => [`data/build/statements/${y}.json`, t] as [string, string]),
    ["data/build/statements/index.json", "{}"],
    ["data/build/manifest.json", "{}"],
  ]);

describe("reading data at two commits", () => {
  it("reads only what changed, plus every card, and diffs it", () => {
    const log: string[][] = [];
    const git = fakeGit(
      {
        aaa: tree({ card: card(), contract: contract([S1]), statements: { "2026-27": statement("2026-27", "EFO-2026-03", "OBR forecast, March 2026", 115.4) } }),
        bbb: tree({ card: card(), contract: contract([S1, S2]), statements: { "2026-27": statement("2026-27", "EFO-2026-11", "OBR forecast, November 2026", 120.1) } }),
      },
      log,
    );
    const snap = dataSnapshotsFor(git, "aaa", "bbb");
    expect([...snap.after.contracts.keys()]).toEqual([KEY]);
    expect([...snap.after.statements.keys()]).toEqual(["2026-27"]);
    expect(snap.after.promises.size).toBe(2);
    const events = diffData(snap.before, snap.after, { commit: "bbb", siteUrl: SITE, actors: snap.actors });
    expect(events.map((e) => e.change_type)).toEqual(["contract", "edition"]);
    expect(log.every((c) => ["rev-parse", "diff", "ls-tree", "show", "merge-base"].includes(c[0]!))).toBe(true); // read-only git only
    expect(log.some((c) => c[0] === "show" && c[1]!.endsWith("manifest.json"))).toBe(false);
  });

  it("reads a contract a changed card newly links, even though the contract file did not change", () => {
    const git = fakeGit({ aaa: tree({ card: card({ contracts: [] }), contract: contract([S1]) }), bbb: tree({ card: card(), contract: contract([S1]) }) });
    const snap = dataSnapshotsFor(git, "aaa", "bbb");
    expect(diffData(snap.before, snap.after, { commit: "bbb", siteUrl: SITE }).map((e) => e.change_type)).toEqual(["contract"]);
  });
});

// ---------------------------------------------------------------- fan-out and the cursor

let db: Db;
let telegrams: { chatId: string; text: string }[];

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return { db, config, mailer: outboxMailer(db, config), telegram: telegramSender(config, telegrams), partyOf: (id) => partyOf(actors, id), now: T0, ...over };
}

async function subscribe(address: string, targets: [string, string][], o: { channel?: "email" | "telegram"; cadence?: "instant" | "weekly" } = {}) {
  const id = randomUUID();
  const channel = o.channel ?? "email";
  await db.query(
    `INSERT INTO subscription (id, channel, address_enc, address_hash, cadence, consent_text_version, consent_at, confirmed_at, manage_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'test', $6, $6, 'not-a-real-hash', $6)`,
    [id, channel, encrypt(config.encryptionKey, address), lookupHash(config.lookupPepper, channel, address), o.cadence ?? "instant", T0.toISOString()],
  );
  for (const [kind, target] of targets) await db.query("INSERT INTO subscription_target (subscription_id, kind, target_id) VALUES ($1, $2, $3)", [id, kind, target]);
  return id;
}

async function outbox() {
  const rows = await db.query<{ to_enc: string; subject: string; body_text: string }>("SELECT to_enc, subject, body_text FROM mail_outbox ORDER BY id");
  return rows.map((r) => ({ to: decrypt(config.encryptionKey, r.to_enc), subject: r.subject, text: r.body_text }));
}

beforeEach(async () => {
  db = await testDb();
  telegrams = [];
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe("data alerts fan-out", () => {
  const contractEvents = () => diff(side({ contracts: new Map([[KEY, contract([S1])]]) }), side({ contracts: new Map([[KEY, contract([S1, S2])]]) }));
  const editionEvents = () =>
    diff(
      side({ statements: new Map([["2026-27", statement("2026-27", "EFO-2026-03", "OBR forecast, March 2026", 115.4)]]) }),
      side({ statements: new Map([["2026-27", statement("2026-27", "EFO-2026-11", "OBR forecast, November 2026", 120.1)]]) }),
    );

  it("tells followers of the promise, its actor, party and area about a contract change", async () => {
    await subscribe("promise@example.org", [["promise", "uk-great-british-energy-2024"]]);
    await subscribe("actor@example.org", [["actor", "keir-starmer"]]);
    await subscribe("party@example.org", [["actor", "labour"]]);
    await subscribe("area@example.org", [["area", "housing_env"]]);
    await subscribe("other@example.org", [["area", "health"], ["deadline_window", "next-12-months"]]);
    const report = await fanOut(contractEvents(), ctx());
    expect(report).toMatchObject({ newChanges: 1, emails: 4, failed: 0 });
    const mail = await outbox();
    expect(mail.map((m) => m.to).sort()).toEqual(["actor@example.org", "area@example.org", "party@example.org", "promise@example.org"]);
    expect(mail[0]!.text).toContain("A promise you follow on Public Ledger has changed.");
    expect(mail[0]!.text).toContain("  - Contract changed: value £125,000, was £117,502");
  });

  it("sends a new edition of the headline figures only to people who follow everything, in plain words", async () => {
    await subscribe("all@example.org", [["all", "*"]]);
    await subscribe("promise@example.org", [["promise", "uk-great-british-energy-2024"]]);
    await subscribe("777", [["all", "*"]], { channel: "telegram" });
    const report = await fanOut(editionEvents(), ctx());
    expect(report).toMatchObject({ emails: 1, telegrams: 1 });
    const [m, ...more] = await outbox();
    expect(more).toEqual([]);
    expect(m!.to).toBe("all@example.org");
    expect(m!.subject).toBe("2026-27 borrowing: £120bn, was £115bn. Spending £1,420bn, was £1,415bn. OBR forecast, November 2026. | The Statement: new official figures");
    expect(m!.text).toContain("Something you follow on Public Ledger has changed.\n\nThe Statement: new official figures\n  - 2026-27 borrowing: £120bn, was £115bn.");
    expect(m!.text).toContain("  https://ledger.test/#statement");
    expect(telegrams[0]!.text).toContain("The Statement: new official figures\n• 2026-27 borrowing");
    const [row] = await db.query<Record<string, unknown>>("SELECT promise_id, actor_id, policy_area, change_type FROM change_event");
    expect(row).toEqual({ promise_id: null, actor_id: null, policy_area: null, change_type: "edition" });
  });

  it("puts data changes in the weekly digest under their own heading", async () => {
    await subscribe("weekly@example.org", [["all", "*"]], { cadence: "weekly" });
    await fanOut([...contractEvents(), ...editionEvents()], ctx());
    const report = await runDigest(ctx({ now: new Date("2026-10-12T07:00:00Z") }));
    expect(report).toMatchObject({ emails: 1, changes: 2 });
    const [m] = await outbox();
    expect(m!.text).toContain("Changes to what you follow, in the week to 12 October 2026.");
    expect(m!.text).toContain("uk-great-british-energy-2024\n  - Contract changed:");
    expect(m!.text).toContain("The Statement: new official figures\n  - 2026-27 borrowing: £120bn, was £115bn.");
  });
});

describe("the data cursor", () => {
  const trees = {
    aaa: tree({ card: card(), contract: contract([S1]) }),
    bbb: tree({ card: card(), contract: contract([S1, S2]) }),
  };

  it("starts quietly, then announces each data change once and moves on", async () => {
    await subscribe("promise@example.org", [["promise", "uk-great-british-energy-2024"]]);
    const git = fakeGit(trees);
    // First run: no cursor yet. Nothing is sent; the cursor starts at the commit it ran on.
    expect(await runDataAlerts(ctx(), git, { target: "aaa" })).toMatchObject({ outcome: "started", events: [] });
    expect(await readCursor(db, "data")).toBe("aaa");
    // The data refresh lands: the next run (content push or daily maintenance) announces it.
    const run = await runDataAlerts(ctx(), git);
    expect(run).toMatchObject({ outcome: "diffed", range: { before: "aaa", after: "bbb" } });
    expect(run.fanOut).toMatchObject({ emails: 1 });
    expect(await readCursor(db, "data")).toBe("bbb");
    // Again on the same commit, or on an older one: nothing to do.
    expect((await runDataAlerts(ctx(), git)).outcome).toBe("behind");
    expect((await runDataAlerts(ctx(), git, { target: "aaa" })).outcome).toBe("behind");
    expect(await outbox()).toHaveLength(1);
  });

  it("keeps the cursor when a send fails, so the next run retries it", async () => {
    await subscribe("promise@example.org", [["promise", "uk-great-british-energy-2024"]]);
    const git = fakeGit(trees);
    await runDataAlerts(ctx(), git, { target: "aaa" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Mailer = { send: () => Promise.reject(new Error("SES throttled")) };
    expect((await runDataAlerts(ctx({ mailer: broken }), git)).fanOut).toMatchObject({ failed: 1 });
    expect(await readCursor(db, "data")).toBe("aaa");
    expect((await runDataAlerts(ctx(), git)).fanOut).toMatchObject({ emails: 1, failed: 0 });
    expect(await readCursor(db, "data")).toBe("bbb");
  });

  it("starts again from the current commit when history was rewritten under it", async () => {
    const git = fakeGit({ ...trees, zzz: tree({}) });
    await db.query("INSERT INTO alert_cursor (stream, commit_sha) VALUES ('data', 'zzz')");
    // zzz is not in main's history (a force push replaced it).
    expect((await runDataAlerts(ctx(), git)).outcome).toBe("reset");
    expect(await readCursor(db, "data")).toBe("bbb");
  });
});
