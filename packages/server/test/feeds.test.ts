import { describe, expect, it } from "vitest";
import { ActorFile, PromiseFile, cardViews, type CardView } from "@ledger/schema";
import { loadSeed } from "@ledger/schema/seed";
import { atomFeed, buildFeed, cardEntries, cardsForFeed, tagUri, xmlEscape } from "../src/alerts";

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
