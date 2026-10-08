import { describe, expect, it } from "vitest";
import { ActorFile, PromiseFile, cardViews, type CardView } from "@ledger/schema";
import { loadSeed } from "@ledger/schema/seed";
import { atomFeed, buildFeed, cardEntries, cardsForFeed, headlineOf, tagUri, xmlEscape, type Headline } from "../src/alerts";

const SITE = "https://ledger.test";

// ---------------------------------------------------------------- a strict little XML reader, to parse feeds back

interface El {
  name: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function parseXml(src: string): El {
  let i = 0;
  const fail = (msg: string): never => {
    throw new Error(`${msg} at ${i}: ${JSON.stringify(src.slice(i, i + 40))}`);
  };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(src)) fail("control character");
  const decode = (raw: string) => {
    if (raw.includes("<")) fail("raw < in text");
    return raw.replace(/&([^;&]*)(;?)/g, (_m, body: string, semi: string) => {
      if (!semi) return fail("bare &");
      if (body in ENTITIES) return ENTITIES[body]!;
      if (/^#x[0-9a-fA-F]+$/.test(body)) return String.fromCodePoint(parseInt(body.slice(2), 16));
      if (/^#\d+$/.test(body)) return String.fromCodePoint(parseInt(body.slice(1), 10));
      return fail(`unknown entity &${body};`);
    });
  };
  const ws = () => {
    while (/\s/.test(src[i] ?? "")) i++;
  };
  const name = () => {
    const m = /^[A-Za-z_][\w.:-]*/.exec(src.slice(i)) ?? fail("expected a name");
    i += m[0].length;
    return m[0];
  };
  const element = (): El => {
    if (src[i] !== "<") fail("expected <");
    i++;
    const tag = name();
    const attrs: Record<string, string> = {};
    for (;;) {
      ws();
      if (src.startsWith("/>", i)) {
        i += 2;
        return { name: tag, attrs, children: [] };
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      const a = name();
      ws();
      if (src[i] !== "=") fail("expected =");
      i++;
      ws();
      const q = src[i];
      if (q !== '"' && q !== "'") fail("unquoted attribute");
      const end = src.indexOf(q!, i + 1);
      if (end < 0) fail("unclosed attribute");
      if (a in attrs) fail("duplicate attribute");
      attrs[a] = decode(src.slice(i + 1, end));
      i = end + 1;
    }
    const children: (El | string)[] = [];
    for (;;) {
      if (src.startsWith("</", i)) {
        i += 2;
        const close = name();
        if (close !== tag) fail(`</${close}> closes <${tag}>`);
        ws();
        if (src[i] !== ">") fail("expected >");
        i++;
        return { name: tag, attrs, children };
      }
      if (src[i] === "<") {
        children.push(element());
        continue;
      }
      const next = src.indexOf("<", i);
      if (next < 0) fail("unclosed element");
      children.push(decode(src.slice(i, next)));
      i = next;
    }
  };
  const decl = /^<\?xml version="1\.0" encoding="utf-8"\?>\s*/.exec(src) ?? fail("missing XML declaration");
  i = decl[0].length;
  const root = element();
  ws();
  if (i !== src.length) fail("content after the root element");
  return root;
}
const kids = (el: El, n: string) => el.children.filter((c): c is El => typeof c !== "string" && c.name === n);
const kid = (el: El, n: string) => kids(el, n)[0]!;
const text = (el: El): string => el.children.map((c) => (typeof c === "string" ? c : text(c))).join("");

// ---------------------------------------------------------------- fixtures

const actors = [
  { id: "andy-burnham", name: "Andy Burnham", kind: "person", party_id: "labour", roles: [{ title: "Prime Minister" }] },
  { id: "labour", name: "Labour Party", kind: "party", roles: [] },
  { id: "reform-uk", name: "Reform UK", kind: "party", roles: [] },
].map((a) => ActorFile.parse(a));

const NASTY = `Tom & Jerry's "<b>bold</b>" plan ]]> \u0001 ✓`;

function promise(id: string, actor_id: string, over: Record<string, unknown> = {}) {
  return PromiseFile.parse({
    id,
    actor_id,
    made_on: "2026-07-22",
    policy_area: "economic_affairs",
    sources: [{ title: "Source", url: "https://example.org/a?x=1&y=2" }],
    versions: [{ version: 1, text: "A £2 cap on bus fares.", recorded_on: "2026-07-22", source_url: "https://example.org/a?x=1&y=2", parameters: null }],
    events: [
      { date: "2026-07-22", type: "promised", text: "Announced" },
      { date: "2026-08-01", type: "in_plan", text: NASTY, evidence_url: "https://example.org/b?x=1&y=2" },
      { date: "2027-01-01", type: "deadline", text: "Due to start" },
    ],
    replies: [{ from_actor_id: actor_id, date: "2026-09-01", text: "We stand by it." }],
    ...over,
    // parameters are null in these fixtures, which the standard allows only for unscoreable cards
    status: "unscoreable",
  });
}

function fixtureCards(): CardView[] {
  const v2 = { version: 2, text: "A £2.50 cap on bus fares.", recorded_on: "2026-09-15", source_url: "https://example.org/c", parameters: null };
  return cardViews(
    [
      promise("uk-bus-2026", "andy-burnham", { versions: [{ version: 1, text: "A £2 cap on bus fares.", recorded_on: "2026-07-22", source_url: "https://example.org/a", parameters: null }, v2] }),
      promise("uk-party-2026", "labour", { policy_area: "health" }),
      promise("uk-reform-2026", "reform-uk", { policy_area: "health", made_on: "2026-06-01" }),
    ],
    actors,
  );
}

const opts = { siteUrl: SITE, today: "2026-10-06" };

describe("Atom feeds", () => {
  it("escapes everything and parses back as well-formed XML", () => {
    const xml = buildFeed(fixtureCards(), "all", "*", { ...opts, title: `Public Ledger: "all" & <everything>`, alternatePath: "/promises" });
    const feed = parseXml(xml);
    expect(feed.name).toBe("feed");
    expect(feed.attrs.xmlns).toBe("http://www.w3.org/2005/Atom");
    expect(text(kid(feed, "title"))).toBe(`Public Ledger: "all" & <everything>`);
    const nasty = kids(feed, "entry").find((e) => text(kid(e, "title")).includes("Tom") && text(kid(e, "title")).endsWith("(Andy Burnham)"))!;
    expect(text(kid(nasty, "title"))).toBe(`In plan: Tom & Jerry's "<b>bold</b>" plan ]]>  ✓ (Andy Burnham)`);
    expect(text(kid(nasty, "content"))).toContain("Evidence: https://example.org/b?x=1&y=2");
    expect(kid(feed, "link").attrs.href).toBe("https://ledger.test/feeds/all.xml");
    expect(kid(feed, "author")).toBeTruthy();
    expect(xml).not.toContain("\u0001");
    expect(xmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });

  it("has one entry per dated event, rewording and reply, newest first, and leaves out future and scheduled entries", () => {
    const feed = parseXml(buildFeed(fixtureCards(), "promise", "uk-bus-2026", { ...opts, title: "Bus cap", alternatePath: "/promise/uk-bus-2026" }));
    const entries = kids(feed, "entry");
    expect(entries.map((e) => text(kid(e, "updated")))).toEqual(["2026-09-15T00:00:00Z", "2026-09-01T00:00:00Z", "2026-08-01T00:00:00Z", "2026-07-22T00:00:00Z"]);
    expect(text(kid(entries[0]!, "title"))).toBe("Reworded: “A £2.50 cap on bus fares.” (Andy Burnham)");
    expect(text(kid(entries[0]!, "content"))).toContain("Was: “A £2 cap on bus fares.”\nNow: “A £2.50 cap on bus fares.”");
    expect(text(kid(entries[1]!, "title"))).toMatch(/^Reply from Andy Burnham/);
    expect(text(kid(feed, "updated"))).toBe("2026-09-15T00:00:00Z");
    expect(entries.every((e) => kid(e, "link").attrs.href === "https://ledger.test/promise/uk-bus-2026")).toBe(true);
    expect(kid(entries[0]!, "category").attrs).toEqual({ term: "economic_affairs", label: "Transport & economy" });
    expect(text(kid(feed, "id"))).toBe("tag:ledger.test,2026:feed/promise/uk-bus-2026");
  });

  it("keeps entry ids stable when the card's history grows", () => {
    const [card] = fixtureCards();
    const before = cardEntries(card!, opts).map((e) => e.id);
    const grown = { ...card!, file: { ...card!.file, events: [...card!.file.events, { date: "2026-10-01", type: "funded" as const, text: "Funded", evidence_url: "https://example.org/d" }] } };
    const after = cardEntries(grown, opts).map((e) => e.id);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2)); // events 0 and 1 unchanged
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toContain(tagUri(SITE, "promise/uk-bus-2026/event/3"));
    expect(before[0]).toBe("tag:ledger.test,2026:promise/uk-bus-2026/event/0");
  });

  it("covers an actor's own cards and, for a party, its people's cards; and areas", () => {
    const cards = fixtureCards();
    expect(cardsForFeed(cards, "actor", "labour").map((c) => c.id).sort()).toEqual(["uk-bus-2026", "uk-party-2026"]);
    expect(cardsForFeed(cards, "actor", "andy-burnham").map((c) => c.id)).toEqual(["uk-bus-2026"]);
    expect(cardsForFeed(cards, "area", "health").map((c) => c.id).sort()).toEqual(["uk-party-2026", "uk-reform-2026"]);
    expect(cardsForFeed(cards, "area", "defence")).toEqual([]);
  });

  it("is still valid and stable with no entries", () => {
    const xml = atomFeed({ id: "tag:ledger.test,2026:feed/area/defence", title: "Defence", selfUrl: `${SITE}/feeds/area/defence.xml`, alternateUrl: `${SITE}/promises`, siteUrl: SITE, updatedFallback: "2026-01-01T00:00:00Z" }, []);
    const feed = parseXml(xml);
    expect(kids(feed, "entry")).toEqual([]);
    expect(text(kid(feed, "updated"))).toBe("2026-01-01T00:00:00Z");
  });

  it("builds a valid feed from every real card", () => {
    const seed = loadSeed();
    const feed = parseXml(buildFeed(seed.cards, "all", "*", { siteUrl: SITE, title: "Public Ledger", alternatePath: "/promises" }));
    const entries = kids(feed, "entry");
    expect(entries.length).toBeGreaterThan(seed.cards.length);
    const ids = entries.map((e) => text(kid(e, "id")));
    expect(new Set(ids).size).toBe(ids.length);
    const dates = entries.map((e) => text(kid(e, "updated")));
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

// ---------------------------------------------------------------- data and deadline feeds (PRE_SHIP_REVIEW F8, F9)

const CONTRACT = {
  key: "ocds-h6vhtk-058e4b",
  ocid: "ocds-h6vhtk-058e4b",
  source: "find_a_tender" as const,
  title: "Photo Voltaic Solar Panels",
  buyer: "SOUTH WESTERN AMBULANCE SERVICE NHS FOUNDATION TRUST",
  notice_url: "https://www.find-tender.service.gov.uk/Notice/063921-2025",
  record_url: "https://www.find-tender.service.gov.uk/api/1.0/ocdsRecordPackages/ocds-h6vhtk-058e4b",
  supplier: { name: "BRIGHT SPARK ENERGY SOLUTIONS LIMITED" },
  awarded_on: "2025-10-03",
  snapshots: [
    { fetched_at: "2026-09-01", value: { amount: 117502, currency: "GBP" }, end_date_planned: "2026-03-31" },
    { fetched_at: "2026-10-01", value: { amount: 125000, currency: "GBP" }, end_date_planned: "2026-06-30" },
  ],
};

function dataCards(): CardView[] {
  const scored = (id: string, over: Record<string, unknown>) =>
    PromiseFile.parse({
      id,
      actor_id: "andy-burnham",
      made_on: "2026-07-22",
      policy_area: "economic_affairs",
      sources: [{ title: "Source", url: "https://example.org/a" }],
      versions: [
        {
          version: 1,
          text: `Promise ${id}.`,
          recorded_on: "2026-07-22",
          source_url: "https://example.org/a",
          parameters: { who: "Everyone", how_much_bn_per_year: [0.36, 0.4, 0.44], when: "2027", funded_by: null },
        },
      ],
      events: [{ date: "2026-07-22", type: "promised", text: "Announced" }],
      replies: [],
      status: "promised",
      ...over,
    });
  return cardViews(
    [
      scored("uk-solar-2026", { status: "delivering", contracts: [CONTRACT.key], events: [{ date: "2026-07-22", type: "promised", text: "Announced" }, { date: "2026-08-01", type: "delivering", text: "Started", evidence_url: "https://example.org/s" }] }),
      scored("uk-unfunded-2026", { contracts: [CONTRACT.key] }),
      scored("uk-due-dec-2026", { deadline: "2026-12-24" }),
      scored("uk-due-oct-2026", {
        deadline: "2026-10-31",
        status: "delivered",
        events: [
          { date: "2026-07-22", type: "promised", text: "Announced" },
          { date: "2026-10-20", type: "delivered", text: "In force", evidence_url: "https://example.org/d" },
        ],
      }),
      scored("uk-missed-2026", {
        deadline: "2026-09-30",
        events: [
          { date: "2026-07-22", type: "promised", text: "Announced" },
          { date: "2026-10-01", type: "deadline_missed", text: "The deadline passed with no evidence of delivery recorded.", auto: true },
        ],
      }),
      scored("uk-due-2029", { deadline: "2029-07-01" }),
    ],
    actors,
    [CONTRACT],
  );
}

const HEADLINES: Headline[] = [
  { year: "2025-26", vintage: "PESA-2026 + PSF-2026-09", vintage_label: "ONS outturn, September 2026 release", kind: "outturn", borrowing: 134.286, income: 1231.3, spending: 1365.6, source: { id: "ons_psf", title: "ONS Public sector finances", url: "https://www.ons.gov.uk/psf", published_on: "2026-09-22" }, quality: "sourced" },
  { year: "2024-25", vintage: "PESA-2026 + PSF-2026-09", vintage_label: "ONS outturn, September 2026 release", kind: "outturn", borrowing: 149.8, income: 1140.6, spending: 1290.3, source: { id: "ons_psf", title: "ONS Public sector finances", url: "https://www.ons.gov.uk/psf", published_on: "2026-09-22" }, quality: "sourced" },
  { year: "2026-27", vintage: "EFO-2026-03", vintage_label: "OBR forecast, March 2026", kind: "forecast", borrowing: 115.462, income: 1303.8, spending: 1419.3, source: { id: "obr_efo", title: "OBR Economic and fiscal outlook – March 2026", url: "https://obr.uk/efo/", published_on: "2026-03-03" }, quality: "sourced" },
];

describe("data and deadline feeds", () => {
  it("put a card's contracts in its feeds once the card shows them: linked, then each change", () => {
    const feed = parseXml(buildFeed(dataCards(), "promise", "uk-solar-2026", { ...opts, title: "Solar", alternatePath: "/promise/uk-solar-2026" }));
    const titles = kids(feed, "entry").map((e) => text(kid(e, "title")));
    expect(titles.slice(0, 2)).toEqual([
      "Contract changed: value £125,000, was £117,502 (+£7,498, +6.4%); planned end 30 June 2026, was 31 March 2026. “Photo Voltaic Solar Panels”,… (Andy Burnham)",
      "Contract linked: £117,502, “Photo Voltaic Solar Panels”, awarded 3 October 2025 by South Western Ambulance Service NHS Foundation Trust to… (Andy Burnham)",
    ]);
    const first = kids(feed, "entry")[0]!;
    expect(text(kid(first, "id"))).toBe("tag:ledger.test,2026:promise/uk-solar-2026/contract/ocds-h6vhtk-058e4b/1");
    expect(text(kid(first, "updated"))).toBe("2026-10-01T00:00:00Z");
    expect(kid(first, "link").attrs.href).toBe("https://ledger.test/promise/uk-solar-2026#contracts-uk-solar-2026");
    expect(text(kid(first, "content"))).toContain("Source: Find a Tender notice, https://www.find-tender.service.gov.uk/Notice/063921-2025 (sourced).");
    // A card that is not funded yet does not show its contracts, so neither does its feed.
    const early = parseXml(buildFeed(dataCards(), "promise", "uk-unfunded-2026", { ...opts, title: "x", alternatePath: "/" }));
    expect(kids(early, "entry").map((e) => text(kid(e, "title"))).some((t) => t.startsWith("Contract"))).toBe(false);
  });

  it("has an updates feed of data changes: contracts and one entry per edition of the headline figures, numbers first", () => {
    const feed = parseXml(buildFeed(dataCards(), "updates", "*", { ...opts, title: "Updates", alternatePath: "/", headlines: HEADLINES }));
    expect(kid(feed, "link").attrs.href).toBe("https://ledger.test/feeds/updates.xml");
    expect(text(kid(feed, "id"))).toBe("tag:ledger.test,2026:feed/updates");
    const entries = kids(feed, "entry");
    expect(entries.map((e) => text(kid(e, "title")))).toEqual([
      expect.stringMatching(/^Contract changed/),
      "Borrowing £134bn in 2025-26: ONS outturn, September 2026 release",
      expect.stringMatching(/^Contract linked/),
      "Borrowing £115bn in 2026-27: OBR forecast, March 2026",
    ]);
    const ons = entries[1]!;
    expect(text(kid(ons, "updated"))).toBe("2026-09-22T00:00:00Z");
    expect(text(kid(ons, "id"))).toBe("tag:ledger.test,2026:edition/PESA-2026_PSF-2026-09");
    expect(text(kid(ons, "content"))).toBe(
      [
        "ONS outturn, September 2026 release: what the Statement shows, year by year.",
        "",
        "2024-25: borrowing £150bn, income £1,141bn, spending £1,290bn.",
        "2025-26: borrowing £134bn, income £1,231bn, spending £1,366bn.",
        "",
        "Source: ONS Public sector finances, https://www.ons.gov.uk/psf (sourced).",
      ].join("\n"),
    );
    // "Every change" includes the data changes too, as following everything by email does.
    const all = kids(parseXml(buildFeed(dataCards(), "all", "*", { ...opts, title: "All", alternatePath: "/", headlines: HEADLINES })), "entry").map((e) => text(kid(e, "title")));
    expect(all).toEqual(expect.arrayContaining(["Borrowing £115bn in 2026-27: OBR forecast, March 2026", expect.stringMatching(/^Contract linked/)]));
  });

  it("has a feed per deadline window: outcomes judged on their own day, and this month's list of what is coming due", () => {
    const build = (w: string, today: string) =>
      parseXml(buildFeed(dataCards(), "deadlines", w, { siteUrl: SITE, today, title: `Due ${w}`, alternatePath: "/promises#coming-up" }));
    const month = build("this-month", "2026-10-25");
    expect(kid(month, "link").attrs.href).toBe("https://ledger.test/feeds/deadlines/this-month.xml");
    const entries = kids(month, "entry");
    // Nothing open is due in October (the October promise was delivered), so there is no list; the
    // September deadline that passed on 1 October is in the grace month, so its followers hear of it.
    expect(entries.map((e) => text(kid(e, "title")))).toEqual([
      "Delivered: Promise uk-due-oct-2026. (Andy Burnham, due 31 October 2026)",
      "Deadline passed: Promise uk-missed-2026. (Andy Burnham, due 30 September 2026)",
    ]);
    // The same delivery appears under the same id as in the card's own feed.
    expect(text(kid(entries[0]!, "id"))).toBe("tag:ledger.test,2026:promise/uk-due-oct-2026/event/1");
    // Three months: the December deadline is coming due; 2029 is not.
    const list = (feed: El) => kids(feed, "entry").find((e) => text(kid(e, "title")).startsWith("Coming due"))!;
    const quarter = list(build("next-3-months", "2026-10-25"));
    expect(text(kid(quarter, "title"))).toBe("Coming due: 1 promise between October and December 2026");
    expect(text(kid(quarter, "id"))).toBe("tag:ledger.test,2026:deadlines/next-3-months/2026-10");
    expect(text(kid(quarter, "updated"))).toBe("2026-10-01T00:00:00Z");
    expect(text(kid(quarter, "content"))).toContain("24 December 2026: Andy Burnham, “Promise uk-due-dec-2026.” (Promised). https://ledger.test/promise/uk-due-dec-2026");
    expect(text(kid(quarter, "content"))).not.toContain("2029");
    // In December the same promise is past its deadline and still open.
    expect(text(kid(list(build("this-month", "2026-12-28")), "content"))).toContain("(Promised, deadline passed)");
    // An unknown window is an empty, valid feed.
    expect(kids(build("next-5-years", "2026-10-25"), "entry")).toEqual([]);
  });

  it("builds valid updates and deadline feeds from the real data", () => {
    const seed = loadSeed();
    const headlines = Object.values(seed.statements).map((s) => headlineOf(s)!);
    expect(headlines.every(Boolean)).toBe(true);
    for (const [kind, key] of [["updates", "*"], ["deadlines", "next-12-months"], ["all", "*"]] as const) {
      const feed = parseXml(buildFeed(seed.cards, kind, key, { siteUrl: SITE, title: "Public Ledger", alternatePath: "/", headlines }));
      const ids = kids(feed, "entry").map((e) => text(kid(e, "id")));
      expect(new Set(ids).size).toBe(ids.length);
      const dates = kids(feed, "entry").map((e) => text(kid(e, "updated")));
      expect([...dates].sort().reverse()).toEqual(dates);
    }
  });
});
