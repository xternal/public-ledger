import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import { testDb } from "../src/db";
import { loadConfig } from "../src/config";
import { decrypt } from "../src/crypto";
import { outboxMailer, type Mailer } from "../src/mail";
import { createSpamChallenge } from "../src/spam";
import {
  allocateReference,
  countFormOpened,
  deleteSubmitterEmail,
  lookupDeleteToken,
  pruneSubmitterEmails,
  pruneTurnedDownSubmissions,
  receiveSubmission,
  referencePrefix,
  runAutoChecks,
  SUBMITTER_EMAIL_RETENTION_DAYS,
  validateSubmission,
  type PrefillClient,
} from "../src/intake";
import { prefillSubmission } from "../src/intake/prefill";
import { CONTENT, fakeFetch, fakeLookup, JSON3, json, PUBLIC_DNS, RULES, watchPage } from "./intake-helpers";

const config = loadConfig({});
const NOW = new Date("2026-10-06T14:00:00Z");
const pass = async () => true;

let db: Db;
let mail: Mailer;
beforeEach(async () => {
  db = await testDb();
  mail = outboxMailer(db, config);
});
afterEach(async () => {
  await db.close();
});

const send = (body: Record<string, unknown>, extra: { now?: Date; clientKey?: string; dailyLimit?: number; mail?: Mailer } = {}) =>
  receiveSubmission(body, {
    db,
    config,
    mail: extra.mail ?? mail,
    rules: RULES,
    clientKey: extra.clientKey ?? "198.51.100.7",
    now: extra.now ?? NOW,
    verifySpam: pass,
    dailyLimit: extra.dailyLimit,
  });

const usage = async (event: string, key = "", value = "") =>
  Number((await db.query<{ count: string }>("SELECT count FROM usage_daily WHERE event = $1 AND prop_key = $2 AND prop_value = $3", [event, key, value]))[0]?.count ?? 0);

describe("validation", () => {
  const ok = { kind: "new_promise", url: "https://www.gov.uk/x", altcha: "p" };

  it("accepts a minimal submission and trims blanks to nothing", () => {
    const r = validateSubmission({ ...ok, claimed_actor: "  ", video_time: "", contact_email: "" }, RULES);
    expect(r.ok && r.data).toMatchObject({ kind: "new_promise", claimed_actor: null, video_time: null, contact_email: null, promise_id: null });
  });

  it("gives one plain message per bad field", () => {
    const r = validateSubmission(
      {
        kind: "evidence",
        promise_id: "no-such-card",
        evidence_type: "vibes",
        url: "javascript:alert(1)",
        video_time: "about ten minutes in",
        claimed_date: "2099-01-01",
        contact_email: "not-an-email",
        credit_handle: "see https://spam.example",
        altcha: "p",
      },
      RULES,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.fields).sort()).toEqual(["claimed_date", "contact_email", "credit_handle", "evidence_type", "promise_id", "url", "video_time"]);
  });

  it("caps lengths and refuses links with credentials", () => {
    const long = validateSubmission({ ...ok, claimed_quote: "x".repeat(2001), credit_handle: "y".repeat(41) }, RULES);
    expect(!long.ok && Object.keys(long.fields).sort()).toEqual(["claimed_quote", "credit_handle"]);
    const creds = validateSubmission({ ...ok, url: "https://me:pw@www.gov.uk/" }, RULES);
    expect(!creds.ok && creds.fields.url).toMatch(/user name or password/);
  });

  it("takes the video time from the link when the reader left it blank", () => {
    const r = validateSubmission({ ...ok, url: "https://youtu.be/dQw4w9WgXcQ?t=754" }, RULES);
    expect(r.ok && [r.data.url_normalised, r.data.video_time]).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ", 754]);
    const own = validateSubmission({ ...ok, url: "https://youtu.be/dQw4w9WgXcQ?t=754", video_time: "1:00" }, RULES);
    expect(own.ok && own.data.video_time).toBe(60);
  });
});

describe("references", () => {
  it("count up within a month and restart in the next, by the UK calendar", async () => {
    const insert = async (now: Date) =>
      db.transaction(async (tx) => {
        const id = await allocateReference(tx, now);
        await tx.query("INSERT INTO submission (id, kind, url, url_normalised) VALUES ($1, 'new_promise', 'u', 'u')", [id]);
        return id;
      });
    expect(await insert(new Date("2026-09-30T12:00:00Z"))).toBe("S-2026-09-0001");
    expect(await insert(new Date("2026-09-30T13:00:00Z"))).toBe("S-2026-09-0002");
    // 23:30 UTC on 30 September is 00:30 BST on 1 October.
    expect(await insert(new Date("2026-09-30T23:30:00Z"))).toBe("S-2026-10-0001");
    expect(await insert(new Date("2026-10-31T12:00:00Z"))).toBe("S-2026-10-0002");
    expect(await insert(new Date("2026-11-01T00:00:00Z"))).toBe("S-2026-11-0001");
    expect(referencePrefix(new Date("2026-12-31T23:59:00Z"))).toBe("S-2026-12-");
  });

  it("stay unique when submissions arrive together", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => send({ kind: "new_promise", url: `https://www.gov.uk/n${i}`, altcha: "p" })));
    const refs = results.map((r) => (r.ok ? r.reference : "")).sort();
    expect(refs).toEqual(["S-2026-10-0001", "S-2026-10-0002", "S-2026-10-0003", "S-2026-10-0004", "S-2026-10-0005"]);
  });
});

describe("receiving", () => {
  it("stores the submission, counts it, and emails a receipt with the delete link", async () => {
    const r = await send({
      kind: "evidence",
      promise_id: "bus-fare-cap",
      evidence_type: "funded",
      url: "https://www.gov.uk/budget?utm_source=tw",
      claimed_actor: "Chancellor",
      contact_email: " Reader@Example.org ",
      credit_handle: "busfan",
      altcha: "p",
    });
    expect(r).toEqual({ ok: true, reference: "S-2026-10-0001", status: "received", duplicateOf: null, receiptSent: true });
    const [row] = await db.query<Record<string, unknown>>("SELECT * FROM submission");
    expect(row).toMatchObject({ kind: "evidence", promise_id: "bus-fare-cap", evidence_type: "funded", url_normalised: "https://www.gov.uk/budget", status: "received", credit_handle: "busfan" });
    expect(decrypt(config.encryptionKey, row!.contact_email_enc as string)).toBe("reader@example.org");
    const [mailRow] = await db.query<{ body_text: string; subject: string; to_enc: string }>("SELECT * FROM mail_outbox");
    expect(mailRow!.subject).toBe("Your submission S-2026-10-0001");
    expect(mailRow!.body_text).toMatch(/Your reference: S-2026-10-0001/);
    const token = /\/submission\/delete\?t=([A-Za-z0-9_-]+)/.exec(mailRow!.body_text)![1]!;
    expect(row!.delete_token_hash).not.toBe(token); // only the hash is stored
    expect(mailRow!.body_text).toContain("We delete it once the editors decide, and after 90 days at the latest.");
    expect(await usage("submission_sent", "kind", "evidence")).toBe(1);
  });

  it("keeps no plaintext email, token or IP anywhere in the database", async () => {
    await send({ kind: "new_promise", url: "https://www.gov.uk/a", contact_email: "secret.reader@example.org", altcha: "p" }, { clientKey: "203.0.113.77" });
    await countFormOpened(db, "new", NOW);
    const [mailRow] = await db.query<{ body_text: string }>("SELECT body_text FROM mail_outbox");
    const token = /\?t=([A-Za-z0-9_-]+)/.exec(mailRow!.body_text)![1]!;
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((t) => t.table_name);
    let dump = "";
    for (const t of tables) {
      const rows = await db.query(`SELECT * FROM ${t}`);
      dump += JSON.stringify(t === "mail_outbox" ? rows.map((r) => ({ ...r, body_text: "" })) : rows); // the outbox body is the email itself
    }
    expect(dump).not.toContain("secret.reader");
    expect(dump).not.toContain("example.org\"");
    expect(dump).not.toContain(token);
    expect(dump).not.toContain("203.0.113.77");
  });

  it("says honestly when the receipt could not be sent", async () => {
    const broken: Mailer = { send: () => Promise.reject(Object.assign(new Error("reader@example.org rejected"), { name: "MessageRejected" })) };
    const r = await send({ kind: "new_promise", url: "https://www.gov.uk/a", contact_email: "reader@example.org", altcha: "p" }, { mail: broken });
    expect(r.ok && r.receiptSent).toBe(false);
    const none = await send({ kind: "new_promise", url: "https://www.gov.uk/b", altcha: "p" });
    expect(none.ok && none.receiptSent).toBeNull();
  });

  it("marks the same video moment (±30 s) within 180 days as a duplicate, and stores it anyway", async () => {
    const yt = (t: string) => ({ kind: "new_promise", url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=${t}`, altcha: "p" });
    const a = await send(yt("100"));
    const b = await send({ ...yt("x"), url: "https://youtu.be/dQw4w9WgXcQ", video_time: "2:05" }); // 125 s
    const c = await send(yt("200"));
    const d = await send({ ...yt("0"), url: "https://youtu.be/dQw4w9WgXcQ?t=110" }, { now: new Date("2027-04-10T12:00:00Z") }); // 186 days later
    expect([a, b, c, d].map((r) => r.ok && [r.status, r.duplicateOf])).toEqual([
      ["received", null],
      ["duplicate", "S-2026-10-0001"],
      ["received", null],
      ["received", null],
    ]);
    const [row] = await db.query<{ checks: { duplicate_of: string } }>("SELECT checks FROM submission WHERE id = 'S-2026-10-0002'");
    expect(row!.checks.duplicate_of).toBe("S-2026-10-0001");
    // Different words from the same page are not duplicates; the same card evidence is.
    const p1 = await send({ kind: "new_promise", url: "https://news.example.org/manifesto", claimed_quote: "We will cut fuel duty", altcha: "p" });
    const p2 = await send({ kind: "new_promise", url: "https://news.example.org/manifesto/", claimed_quote: "We will build homes", altcha: "p" });
    expect([p1, p2].map((r) => r.ok && r.status)).toEqual(["received", "received"]);
  });

  it("blocks after the daily limit and counts it, without a reason that names anyone", async () => {
    const body = { kind: "new_promise", url: "https://www.gov.uk/x", altcha: "p" };
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await send({ ...body, url: `${body.url}${i}` }, { dailyLimit: 2 }));
    expect(results.map((r) => (r.ok ? 201 : r.httpStatus))).toEqual([201, 201, 429]);
    expect(await usage("submission_blocked", "reason", "rate_limited")).toBe(1);
    expect((await send({ ...body, url: `${body.url}9` }, { dailyLimit: 2, clientKey: "192.0.2.1" })).ok).toBe(true);
  });

  it("checks the spam proof once and counts failures", async () => {
    const { solveChallenge } = await import("altcha-lib");
    const { deriveKey } = await import("altcha-lib/algorithms/pbkdf2");
    const challenge = await createSpamChallenge(config, { cost: 10, counter: [1, 20] });
    const solution = await solveChallenge({ challenge, deriveKey } as never);
    const altcha = Buffer.from(JSON.stringify({ challenge, solution })).toString("base64");
    const real = (body: Record<string, unknown>) => receiveSubmission(body, { db, config, mail, rules: RULES, clientKey: "x", now: NOW });
    // A validation error does not use up the solved check…
    const bad = await real({ kind: "new_promise", url: "nope", altcha });
    expect(!bad.ok && bad.error).toBe("invalid");
    expect(await usage("submission_blocked", "reason", "invalid_url")).toBe(1);
    // …so the corrected submission goes through with the same proof, once.
    expect((await real({ kind: "new_promise", url: "https://www.gov.uk/x", altcha })).ok).toBe(true);
    const replay = await real({ kind: "new_promise", url: "https://www.gov.uk/y", altcha });
    expect(!replay.ok && [replay.httpStatus, replay.error]).toEqual([400, "spam_check"]);
    expect(await usage("submission_blocked", "reason", "spam_check")).toBe(1);
  });
});

describe("submitter emails are kept only as long as needed", () => {
  it("keeps no email, delete link or credit name for a duplicate on arrival, and says so in its only email", async () => {
    await send({ kind: "new_promise", url: "https://www.gov.uk/a", contact_email: "first@example.org", altcha: "p" });
    const r = await send({ kind: "new_promise", url: "https://www.gov.uk/a/", contact_email: "second@example.org", credit_handle: "busfan", altcha: "p" });
    expect(r).toMatchObject({ ok: true, status: "duplicate", duplicateOf: "S-2026-10-0001", receiptSent: true });
    const [row] = await db.query<Record<string, unknown>>("SELECT contact_email_enc, delete_token_hash, credit_handle FROM submission WHERE id = 'S-2026-10-0002'");
    expect(row).toEqual({ contact_email_enc: null, delete_token_hash: null, credit_handle: null });
    const [m] = await db.query<{ to_enc: string; body_text: string }>("SELECT to_enc, body_text FROM mail_outbox ORDER BY id DESC LIMIT 1");
    expect(decrypt(config.encryptionKey, m!.to_enc)).toBe("second@example.org");
    expect(m!.body_text).toContain("Another reader sent this first, so the editors already have it.");
    expect(m!.body_text).toContain("We have not kept your email address");
    expect(m!.body_text).not.toContain("/submission/delete");
  });

  it("deletes turned-down submissions 12 months after the decision, and nothing else", async () => {
    const decided = new Date("2025-10-01T09:00:00Z");
    for (const [url, status] of [["rejected", "rejected"], ["dup", "duplicate"], ["accepted", "accepted"], ["open", "in_review"]] as const)
      await send({ kind: "new_promise", url: `https://www.gov.uk/${url}`, altcha: "p" }).then(() =>
        db.query("UPDATE submission SET status = $1, triaged_at = $2 WHERE url = $3", [status, status === "in_review" ? null : decided.toISOString(), `https://www.gov.uk/${url}`]),
      );
    const monthsAfter = (m: number, extraDays = 0) => {
      const d = new Date(decided);
      d.setUTCMonth(d.getUTCMonth() + m);
      return new Date(d.getTime() + extraDays * 86_400_000);
    };
    expect(await pruneTurnedDownSubmissions(db, monthsAfter(12, -1))).toBe(0);
    expect(await pruneTurnedDownSubmissions(db, monthsAfter(12, 1))).toBe(2);
    const left = await db.query<{ url: string }>("SELECT url FROM submission ORDER BY url");
    expect(left.map((r) => r.url)).toEqual(["https://www.gov.uk/accepted", "https://www.gov.uk/open"]);
  });

  it("deletes every email and delete link after 90 days, whatever the status", async () => {
    const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
    await send({ kind: "new_promise", url: "https://www.gov.uk/old", contact_email: "old@example.org", altcha: "p" }); // never triaged
    await send({ kind: "new_promise", url: "https://www.gov.uk/accepted", contact_email: "acc@example.org", credit_handle: "busfan", altcha: "p" });
    await send({ kind: "new_promise", url: "https://www.gov.uk/new", contact_email: "new@example.org", altcha: "p" }, { now: at(30) });
    await db.query("UPDATE submission SET status = 'accepted' WHERE url = 'https://www.gov.uk/accepted'"); // accepted, never merged

    expect(await pruneSubmitterEmails(db, at(SUBMITTER_EMAIL_RETENTION_DAYS))).toBe(0);
    expect(await pruneSubmitterEmails(db, at(SUBMITTER_EMAIL_RETENTION_DAYS + 1))).toBe(2);
    const rows = await db.query<{ url: string; has_email: boolean; has_link: boolean; credit_handle: string | null }>(
      "SELECT url, contact_email_enc IS NOT NULL AS has_email, delete_token_hash IS NOT NULL AS has_link, credit_handle FROM submission ORDER BY id",
    );
    expect(rows).toEqual([
      { url: "https://www.gov.uk/old", has_email: false, has_link: false, credit_handle: null },
      { url: "https://www.gov.uk/accepted", has_email: false, has_link: false, credit_handle: "busfan" }, // the credit is for the card
      { url: "https://www.gov.uk/new", has_email: true, has_link: true, credit_handle: null },
    ]);
    expect(await pruneSubmitterEmails(db, at(SUBMITTER_EMAIL_RETENTION_DAYS + 1))).toBe(0);
  });
});

describe("delete my email", () => {
  async function submitWithEmail(credit?: string) {
    const r = await send({ kind: "new_promise", url: "https://www.gov.uk/a", contact_email: "reader@example.org", credit_handle: credit, altcha: "p" });
    const [m] = await db.query<{ body_text: string }>("SELECT body_text FROM mail_outbox ORDER BY id DESC LIMIT 1");
    return { reference: r.ok ? r.reference : "", token: /\?t=([A-Za-z0-9_-]+)/.exec(m!.body_text)![1]! };
  }

  it("looking at the link changes nothing; pressing the button deletes the email and the handle", async () => {
    const { reference, token } = await submitWithEmail("busfan");
    expect(await lookupDeleteToken(db, token)).toEqual({ reference, creditPublished: false, hasCredit: true });
    const [before] = await db.query<{ contact_email_enc: string | null }>("SELECT contact_email_enc FROM submission");
    expect(before!.contact_email_enc).not.toBeNull();

    expect(await deleteSubmitterEmail(db, token, NOW)).toEqual({ reference, credit: "removed" });
    const [after] = await db.query<Record<string, unknown>>("SELECT contact_email_enc, delete_token_hash, credit_handle, url FROM submission");
    expect(after).toEqual({ contact_email_enc: null, delete_token_hash: null, credit_handle: null, url: "https://www.gov.uk/a" });
    expect(await usage("data_deleted", "kind", "submitter")).toBe(1);
    // The link works once.
    expect(await deleteSubmitterEmail(db, token, NOW)).toBeNull();
    expect(await lookupDeleteToken(db, token)).toBeNull();
  });

  it("keeps the handle that is already on a published card, and says so", async () => {
    const { reference, token } = await submitWithEmail("busfan");
    await db.query("UPDATE submission SET status = 'accepted' WHERE id = $1", [reference]);
    expect(await lookupDeleteToken(db, token)).toMatchObject({ creditPublished: true });
    expect(await deleteSubmitterEmail(db, token, NOW)).toEqual({ reference, credit: "kept" });
    const [row] = await db.query<{ contact_email_enc: string | null; credit_handle: string }>("SELECT contact_email_enc, credit_handle FROM submission");
    expect(row).toEqual({ contact_email_enc: null, credit_handle: "busfan" });
  });

  it("ignores malformed and unknown tokens", async () => {
    expect(await deleteSubmitterEmail(db, "' OR 1=1 --", NOW)).toBeNull();
    expect(await deleteSubmitterEmail(db, "A".repeat(32), NOW)).toBeNull();
    expect(await lookupDeleteToken(db, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------- pre-fill

function stubClient(reply: { text?: string; stop_reason?: string; fail?: unknown }): PrefillClient & { bodies: unknown[] } {
  const bodies: unknown[] = [];
  return {
    bodies,
    beta: {
      messages: {
        create: async (body) => {
          bodies.push(body);
          if (reply.fail) throw reply.fail;
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: reply.text === undefined ? [] : [{ type: "text", text: reply.text, citations: null }],
            stop_reason: reply.stop_reason ?? "end_turn",
            stop_sequence: null,
            stop_details: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as never;
        },
      },
    },
  };
}

const suggestion = {
  actor_id: "keir-starmer",
  made_on: "2026-10-01",
  venue: "speech",
  policy_area: "housing_env",
  verbatim_text: "we will build one and a half million homes in this Parliament",
  deadline: null,
  cost_mentioned: null,
  possible_duplicate_of: ["bus-fare-cap", "made-up-card"],
  notes: "Deadline is 'this Parliament'.",
};

const prefillInput = {
  kind: "new_promise" as const,
  promise_id: null,
  evidence_type: null,
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  video_time: 754,
  claimed_actor: "Keir Starmer",
  claimed_quote: "we will build 1.5 million homes",
  claimed_date: null,
  source_excerpt: "And let me be clear: we will build one and a half million homes in this Parliament.",
  source_kind: "transcript" as const,
  quote_matched: false,
};

describe("Claude pre-fill", () => {
  it("is skipped, visibly, without an API key", async () => {
    expect(await prefillSubmission(prefillInput, CONTENT, null)).toEqual({ status: "not_configured" });
  });

  it("validates the structured output and keeps only known ids", async () => {
    const client = stubClient({ text: JSON.stringify(suggestion) });
    const out = await prefillSubmission(prefillInput, CONTENT, client);
    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.suggestion).toMatchObject({ actor_id: "keir-starmer", policy_area: "housing_env", possible_duplicate_of: ["bus-fare-cap"], verbatim_found_in_source: true });
    const body = client.bodies[0] as Record<string, unknown> & { output_config: { format: { type: string } }; messages: { content: string }[] };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.fallbacks).toBe("default");
    expect(body.messages[0]!.content).toContain("<source_text kind=\"transcript\">");
  });

  it("drops suggestions outside the lists and reports bad output without throwing", async () => {
    const odd = await prefillSubmission(prefillInput, CONTENT, stubClient({ text: JSON.stringify({ ...suggestion, actor_id: "someone-else", venue: "pub", made_on: "last week" }) }));
    expect(odd.status === "done" && [odd.suggestion.actor_id, odd.suggestion.venue, odd.suggestion.made_on]).toEqual([null, null, null]);
    expect((await prefillSubmission(prefillInput, CONTENT, stubClient({ text: "not json" }))).status).toBe("invalid_output");
    expect((await prefillSubmission(prefillInput, CONTENT, stubClient({ text: JSON.stringify({ notes: 1 }) }))).status).toBe("invalid_output");
    expect((await prefillSubmission(prefillInput, CONTENT, stubClient({ stop_reason: "refusal" }))).status).toBe("refused");
    expect((await prefillSubmission(prefillInput, CONTENT, stubClient({ fail: Object.assign(new Error("x"), { status: 529 }) })))).toEqual({ status: "failed", detail: "HTTP 529" });
  });
});

// ---------------------------------------------------------------- end to end

describe("acceptance: a YouTube link with a timestamp arrives with an archived URL and a matched quote", () => {
  const VIDEO = "dQw4w9WgXcQ";
  const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;

  function youtubeAndArchive() {
    return fakeFetch({
      [WATCH]: watchPage(VIDEO),
      "https://www.youtube.com/api/timedtext?*": (url) => {
        expect(new URL(url).searchParams.get("fmt")).toBe("json3");
        expect(new URL(url).searchParams.get("lang")).toBe("en-GB"); // the manual English track
        return json(JSON3);
      },
      [`https://web.archive.org/save/${WATCH}`]: new Response("", { status: 200, headers: { "content-location": `/web/20261006140005/${WATCH}` } }),
    });
  }

  it("runs the whole pipeline with every fetch mocked", async () => {
    const r = await send({
      kind: "new_promise",
      url: `https://youtu.be/${VIDEO}?si=AbCdEf&t=754`,
      claimed_actor: "Keir Starmer, Prime Minister",
      claimed_quote: "“We will build one and a half million homes in this Parliament.”",
      claimed_date: "2026-10-01",
      altcha: "p",
    });
    expect(r.ok && r.status).toBe("received");
    const reference = r.ok ? r.reference : "";

    const f = youtubeAndArchive();
    const client = stubClient({ text: JSON.stringify(suggestion) });
    const checks = await runAutoChecks(db, config, reference, { fetch: f, lookup: fakeLookup(PUBLIC_DNS), anthropic: client, content: CONTENT, now: NOW });

    expect(checks).toMatchObject({
      claimed_date: "2026-10-01",
      reachable: true,
      http_status: 200,
      archived: true,
      archive_method: "save",
      text: "transcript",
      quote_matched: true,
      quote_check: "matched",
      quote_near_video_time: true,
      prefill: "done",
    });
    const [row] = await db.query<{ status: string; archived_url: string; matched_quote: Record<string, unknown>; llm_prefill: Record<string, unknown>; video_time: string }>(
      "SELECT status, archived_url, matched_quote, llm_prefill, video_time FROM submission WHERE id = $1",
      [reference],
    );
    expect(row!.status).toBe("auto_checked");
    expect(row!.video_time).toBe("754");
    expect(row!.archived_url).toBe(`https://web.archive.org/web/20261006140005/${WATCH}`);
    expect(row!.matched_quote).toMatchObject({ source: "transcript", at_seconds: 751, near_video_time: true, text: "we will build one and a half million homes in this Parliament" });
    expect(row!.llm_prefill).toMatchObject({ unverified: true, suggestion: { actor_id: "keir-starmer" } });
    expect(await usage("submission_auto_checked", "quote_matched", "yes")).toBe(1);
    expect(await usage("submission_auto_checked", "archived", "yes")).toBe(1);
    // The prompt carried the excerpt around the match, the actors and the existing cards.
    const prompt = (client.bodies[0] as { messages: { content: string }[] }).messages[0]!.content;
    expect(prompt).toContain("one and a half million homes");
    expect(prompt).toContain("keir-starmer: Keir Starmer");
    expect(prompt).toContain("bus-fare-cap (keir-starmer)");
  });

  it("records each failure and carries on: no captions, archive down, no key", async () => {
    const r = await send({ kind: "new_promise", url: WATCH, claimed_quote: "we will build homes for all", altcha: "p" });
    const reference = r.ok ? r.reference : "";
    const f = fakeFetch({
      [WATCH]: "<html><body>Before you continue to YouTube</body></html>",
      [`https://web.archive.org/save/${WATCH}`]: new Response("busy", { status: 503 }),
      "https://archive.org/wayback/available?url=*": json({ archived_snapshots: {} }),
    });
    const checks = await runAutoChecks(db, config, reference, { fetch: f, lookup: fakeLookup(PUBLIC_DNS), anthropic: undefined, content: CONTENT, now: NOW });
    expect(checks).toMatchObject({ reachable: true, archived: false, text: "no_captions", quote_check: "no_text", prefill: "not_configured" });
    expect(checks!.quote_matched).toBeUndefined();
    const [row] = await db.query<{ status: string; llm_prefill: unknown }>("SELECT status, llm_prefill FROM submission");
    expect(row).toEqual({ status: "auto_checked", llm_prefill: null });
    expect(await usage("submission_auto_checked", "quote_matched", "na")).toBe(1);
  });

  it("never fetches or archives a link to a private address, and leaves a duplicate's status alone", async () => {
    await send({ kind: "new_promise", url: "https://intranet.example.org/a", altcha: "p" });
    const dup = await send({ kind: "new_promise", url: "https://intranet.example.org/a/", altcha: "p" });
    const f = fakeFetch({});
    const checks = await runAutoChecks(db, config, dup.ok ? dup.reference : "", {
      fetch: f,
      lookup: fakeLookup({ "intranet.example.org": ["192.168.0.10"] }),
      anthropic: null,
      content: CONTENT,
      now: NOW,
    });
    expect(f.calls).toEqual([]);
    expect(checks).toMatchObject({ blocked: "private_address", reachable: false, archived: false, duplicate_of: "S-2026-10-0001" });
    const [row] = await db.query<{ status: string }>("SELECT status FROM submission WHERE id = 'S-2026-10-0002'");
    expect(row!.status).toBe("duplicate");
    expect(await usage("submission_auto_checked", "duplicate", "yes")).toBe(1);
  });

  it("matches on an ordinary page and records a non-match as false, not a rejection", async () => {
    const page = "https://www.gov.uk/government/speeches/pm-speech";
    const html = "<html><body><main><p>The Prime Minister said we will keep the bus fare cap at £3.</p></main></body></html>";
    const f = fakeFetch({
      [page]: html,
      [`https://web.archive.org/save/${page}`]: new Response(null, { status: 302, headers: { location: `https://web.archive.org/web/20261006140100/${page}` } }),
    });
    const a = await send({ kind: "new_promise", url: page, claimed_quote: "We will keep the bus fare cap at £3", altcha: "p" });
    const b = await send({ kind: "new_promise", url: page, claimed_quote: "We will keep the bus fare cap at £2", altcha: "p" });
    const deps = { fetch: f, lookup: fakeLookup(PUBLIC_DNS), anthropic: null, content: CONTENT, now: NOW };
    expect(await runAutoChecks(db, config, a.ok ? a.reference : "", deps)).toMatchObject({ text: "page", quote_matched: true, archived: true });
    expect(await runAutoChecks(db, config, b.ok ? b.reference : "", deps)).toMatchObject({ text: "page", quote_matched: false, quote_check: "not_found" });
    const rows = await db.query<{ status: string; matched_quote: { source: string } | null }>("SELECT status, matched_quote FROM submission ORDER BY id");
    expect(rows).toEqual([
      { status: "auto_checked", matched_quote: { text: "we will keep the bus fare cap at £3", source: "page", source_span: [24, 59] } },
      { status: "auto_checked", matched_quote: null },
    ]);
  });
});
