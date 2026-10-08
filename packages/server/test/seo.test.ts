import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Headline, PolicyArea, type CardView, type PromiseFile } from "@ledger/schema";
import { loadSeed } from "@ledger/schema/seed";
import {
  AREA_SLUG,
  DESCRIPTION_MAX,
  TITLE_MAX,
  actorJsonLd,
  actorSameAs,
  areaBySlug,
  areaPath,
  canSubmit,
  cardDescription,
  cardHeadline,
  cardJsonLd,
  cardLastUpdated,
  cardMarkdownFile,
  cardTitle,
  changedCard,
  clip,
  collectionJsonLd,
  indexNowKey,
  indexNowPayload,
  llmsFull,
  pagesForCards,
  relatedCards,
  servesCard,
  submitIndexNow,
  waitForDeploy,
  type FetchLike,
  type JsonLdObject,
  type SeoContext,
} from "../src/seo";
import { statusLabel } from "../src/alerts/labels";

const ctx: SeoContext = { siteUrl: "https://ledger.test", today: "2026-10-08" };
const root = join(import.meta.dirname, "../../..");
const seed = loadSeed();
const cards = seed.cards;

// ---------------------------------------------------------------- a small schema.org shape checker

/** The properties we use, per type. Anything else is a typo or an invented property. */
const ALLOWED: Record<string, string[]> = {
  WebPage: ["@id", "url", "name", "headline", "description", "inLanguage", "isPartOf", "dateModified", "about", "license", "mainEntity"],
  CollectionPage: ["@id", "url", "name", "description", "inLanguage", "isPartOf", "dateModified", "about", "mainEntity"],
  ProfilePage: ["@id", "url", "name", "inLanguage", "isPartOf", "dateModified", "mainEntity"],
  WebSite: ["@id", "name", "url"],
  Quotation: ["text", "spokenByCharacter", "dateCreated", "about", "isBasedOn", "citation"],
  Person: ["@id", "name", "alternateName", "url", "sameAs", "jobTitle", "affiliation"],
  Organization: ["@id", "name", "alternateName", "url", "sameAs"],
  GovernmentOrganization: ["@id", "name", "alternateName", "url", "sameAs"],
  Thing: ["name", "url"],
  ItemList: ["numberOfItems", "itemListElement"],
  ListItem: ["position", "url", "name", "item"],
  BreadcrumbList: ["itemListElement"],
};
const URL_KEYS = new Set(["@id", "url", "item", "isBasedOn", "license"]);
const DATE_KEYS = new Set(["dateModified", "dateCreated"]);

function shapeIssues(node: unknown, where = "$", top = true): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => shapeIssues(n, `${where}[${i}]`, top));
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const issues: string[] = [];
  const type = o["@type"];
  if (top && o["@context"] !== "https://schema.org") issues.push(`${where}: @context must be https://schema.org`);
  if (typeof type !== "string" || !ALLOWED[type]) return [...issues, `${where}: unknown @type ${String(type)}`];
  for (const [k, v] of Object.entries(o)) {
    if (k === "@context" || k === "@type") continue;
    if (!ALLOWED[type].includes(k)) issues.push(`${where}: ${type} has no property ${k}`);
    if (v === undefined || v === null || v === "") issues.push(`${where}.${k} is empty`);
    if (URL_KEYS.has(k) && (typeof v !== "string" || !/^https:\/\/[^\s]+$/.test(v))) issues.push(`${where}.${k} is not an absolute https URL`);
    if (k === "sameAs" || k === "citation") {
      if (!Array.isArray(v) || !v.length || v.some((u) => typeof u !== "string" || !/^https:\/\//.test(u))) issues.push(`${where}.${k} must be a list of https URLs`);
    }
    if (DATE_KEYS.has(k) && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))) issues.push(`${where}.${k} is not a YYYY-MM-DD date`);
    issues.push(...shapeIssues(v, `${where}.${k}`, false));
  }
  if (type === "ItemList" || type === "BreadcrumbList") {
    const items = o.itemListElement as { position: number }[];
    if (!Array.isArray(items)) issues.push(`${where}: ${type} needs itemListElement`);
    else items.forEach((it, i) => it.position !== i + 1 && issues.push(`${where}: position ${it.position} should be ${i + 1}`));
    if (type === "ItemList" && o.numberOfItems !== items.length) issues.push(`${where}: numberOfItems does not match the list`);
  }
  return issues;
}

// ---------------------------------------------------------------- headlines, titles and descriptions

describe("card headlines, titles and descriptions", () => {
  it("headlines are 3–8 words (pnpm validate warns about a card without one)", () => {
    for (const c of cards.filter((x) => x.file.headline)) {
      const words = c.file.headline!.split(/\s+/).length;
      expect(words, c.id).toBeGreaterThanOrEqual(3);
      expect(words, c.id).toBeLessThanOrEqual(8);
    }
    expect(Headline.safeParse("Cap bus fares at £2.").success).toBe(false);
    expect(Headline.safeParse("Fares").success).toBe(false);
    expect(Headline.safeParse("Cap bus fares at £2").success).toBe(true);
  });

  it("titles follow the pattern, name who and where it stands, and are unique", () => {
    const great = cards.find((c) => c.id === "uk-great-british-energy-2024")!;
    expect(cardTitle(great).title).toBe("Create Great British Energy – Labour promise, Delivering | Public Ledger");
    for (const c of cards) {
      const { title, social } = cardTitle(c);
      expect(title.startsWith(`${cardHeadline(c)} – `), c.id).toBe(true);
      // The site name goes only when it fits; who and the status always stay.
      if (title.endsWith("| Public Ledger")) expect(title.length, c.id).toBeLessThanOrEqual(TITLE_MAX);
      else expect(title, c.id).toBe(social);
    }
    expect(new Set(cards.map((c) => cardTitle(c).title)).size).toBe(cards.length);
    // A long headline and a long name can pass about 70 characters; they still stay readable.
    for (const c of cards) expect(cardTitle(c).title.length, c.id).toBeLessThanOrEqual(90);
  });

  it("descriptions put the facts first and fit in 160 characters", () => {
    for (const c of cards) {
      const d = cardDescription(c);
      expect(d.length, `${c.id}: ${d}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(d.length, `${c.id}: ${d}`).toBeGreaterThanOrEqual(110);
      expect(d.startsWith(`${statusLabel(c.file.status)}`), c.id).toBe(true);
      expect(d, c.id).toContain(`Promised by ${c.actor.name} on `);
    }
    const bus = cards.find((c) => c.id === "uk-bus-cap-2-2026")!;
    expect(cardDescription(bus)).toMatch(/^In plan\. Costs £0\.36bn to £0\.44bn a year\. Paid for by: /);
    expect(new Set(cards.map(cardDescription)).size).toBe(cards.length);
  });

  it("falls back to the quote cut at a word boundary when a card has no headline", () => {
    const c = cards[0]!;
    const bare = { ...c, file: { ...c.file, headline: undefined } };
    const h = cardHeadline(bare);
    expect(h.length).toBeLessThanOrEqual(60);
    expect(c.current.text.replace(/\s+/g, " ").startsWith(h.replace(/…$/, ""))).toBe(true);
    expect(clip("one two three four", 12)).toBe("one two…");
    expect(clip("short", 12)).toBe("short");
  });
});

describe("last updated", () => {
  const file = {
    versions: [{ recorded_on: "2024-06-13" }],
    events: [
      { date: "2024-06-13" },
      { date: "2029-07-01" }, // a deadline still to come is not a change
    ],
    corrections: [{ date: "2026-10-06" }],
    reviews: [{ on: "2026-10-07" }],
  } as unknown as PromiseFile;
  it("is the newest event, version, correction or review up to today", () => {
    expect(cardLastUpdated(file, "2026-10-08")).toBe("2026-10-07");
    expect(cardLastUpdated(file, "2026-10-06")).toBe("2026-10-06");
    expect(cardLastUpdated({ ...file, corrections: [], reviews: [] }, "2026-10-08")).toBe("2024-06-13");
  });
});

describe("related promises", () => {
  it("lists up to three: same area first, then the same party, never the card itself", () => {
    for (const c of cards) {
      const r = relatedCards(c, cards);
      expect(r.length).toBeLessThanOrEqual(3);
      expect(r.map((x) => x.id)).not.toContain(c.id);
      const owner = (x: CardView) => (x.party ?? x.actor).id;
      let left = false;
      for (const x of r) {
        if (x.file.policy_area !== c.file.policy_area) left = true;
        else expect(left, `${c.id}: same-area cards come first`).toBe(false);
        expect(x.file.policy_area === c.file.policy_area || owner(x) === owner(c)).toBe(true);
      }
    }
  });
});

describe("policy-area pages", () => {
  it("every area has a unique slug that maps back", () => {
    const slugs = Object.values(AREA_SLUG);
    expect(new Set(slugs).size).toBe(PolicyArea.options.length);
    for (const a of PolicyArea.options) {
      expect(AREA_SLUG[a]).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(areaBySlug(AREA_SLUG[a])).toBe(a);
    }
    expect(areaBySlug("nope")).toBeNull();
  });
});

// ---------------------------------------------------------------- structured data

describe("JSON-LD", () => {
  it("every card's structured data has valid shapes and the expected facts", () => {
    for (const c of cards) {
      const data = cardJsonLd(c, ctx);
      expect(shapeIssues(data), c.id).toEqual([]);
      const page = data[0] as JsonLdObject & { mainEntity: { spokenByCharacter: JsonLdObject }; about: JsonLdObject };
      expect(page.dateModified).toBe(cardLastUpdated(c.file, ctx.today));
      expect(page.about.url).toBe(`${ctx.siteUrl}${areaPath(c.file.policy_area)}`);
      expect(page.mainEntity.spokenByCharacter["@type"]).toBe(c.actor.kind === "person" ? "Person" : c.actor.kind === "party" ? "Organization" : "GovernmentOrganization");
    }
  });

  it("speakers link to official pages they can be verified by, and nothing invented", () => {
    const starmer = seed.actors.find((a) => a.id === "keir-starmer")!;
    expect(actorSameAs(starmer)).toEqual(["https://members.parliament.uk/member/4514", "https://www.gov.uk/government/people/keir-starmer"]);
    for (const a of seed.actors) {
      const urls = actorSameAs(a);
      expect(urls.length, `${a.id} needs at least one official page`).toBeGreaterThan(0);
      if (a.parliament_member_id) expect(urls[0]).toBe(`https://members.parliament.uk/member/${a.parliament_member_id}`);
    }
    const bus = cards.find((c) => c.id === "uk-bus-cap-2-2026")!;
    const speaker = (cardJsonLd(bus, ctx)[0] as { mainEntity: { spokenByCharacter: Record<string, unknown> } }).mainEntity.spokenByCharacter;
    expect(speaker).toMatchObject({
      "@type": "Person",
      name: "Andy Burnham",
      sameAs: ["https://members.parliament.uk/member/1427", "https://www.gov.uk/government/people/andy-burnham"],
      affiliation: { "@type": "Organization", name: "Labour Party", sameAs: ["https://labour.org.uk/"] },
    });
  });

  it("actor pages are ProfilePages with current job titles only", () => {
    for (const a of seed.actors) {
      const party = a.party_id ? (seed.actors.find((x) => x.id === a.party_id) ?? null) : null;
      const own = cards.filter((c) => c.actor.id === a.id || c.party?.id === a.id);
      expect(shapeIssues(actorJsonLd(a, party, own, ctx)), a.id).toEqual([]);
    }
    // Keir Starmer's role ended on 20 July 2026: it is history, not his job title today.
    const starmer = seed.actors.find((a) => a.id === "keir-starmer")!;
    const entity = (actorJsonLd(starmer, null, [], ctx)[0] as { mainEntity: Record<string, unknown> }).mainEntity;
    expect(entity.jobTitle).toBeUndefined();
  });

  it("collection pages list cards by headline", () => {
    const data = collectionJsonLd(
      { path: "/promises/area/health", name: "Health promises", description: "…", cards, breadcrumb: [{ name: "Promise ledger", path: "/promises" }] },
      ctx,
    );
    expect(shapeIssues(data)).toEqual([]);
    const list = (data[0] as { mainEntity: { itemListElement: { name: string }[] } }).mainEntity.itemListElement;
    expect(list[0]!.name).toBe(`${cards[0]!.file.headline} (${cards[0]!.actor.short_name ?? cards[0]!.actor.name})`);
  });

  it("the checker catches a bad shape", () => {
    expect(shapeIssues({ "@context": "https://schema.org", "@type": "WebPage", url: "/relative", rating: 5 })).toEqual([
      "$.url is not an absolute https URL",
      "$: WebPage has no property rating",
    ]);
  });
});

// ---------------------------------------------------------------- Markdown

describe("Markdown for AI assistants", () => {
  it("a card's Markdown has its headline, quote, facts, timeline with evidence, sources and licence", () => {
    const c = cards.find((x) => x.id === "uk-great-british-energy-2024")!;
    const md = cardMarkdownFile(c, ctx);
    expect(md.startsWith("# Create Great British Energy\n")).toBe(true);
    expect(md).toContain("> “To drive forward investment in clean, home-grown energy production,");
    expect(md).toContain("- **Status:** Delivering");
    expect(md).toContain("- **Cost a year:** Costs £1.5bn to £1.9bn a year (central £1.7bn)");
    expect(md).toContain("- **Paid for by:** A windfall tax on oil and gas giants");
    expect(md).toContain("- **Card:** https://ledger.test/promise/uk-great-british-energy-2024");
    expect(md).toContain("- **Policy area:** [Transport & economy](https://ledger.test/promises/area/transport-and-economy)");
    expect(md).toContain("15 May 2025, Legislated: Great British Energy Act 2025 receives Royal Assent ([evidence](https://www.legislation.gov.uk/ukpga/2025/16))");
    expect(md).toContain("## Contracts behind delivery");
    expect(md).toContain("## Corrections");
    expect(md).toContain("Creative Commons Attribution 4.0");
    expect(md).toContain("Open Government Licence v3.0");
    expect(md).toContain("Checked by AI Journalist (automated)");
    expect(md).not.toContain("undefined");
  });

  it("llms-full.txt has every card once, the method and the licences", () => {
    const txt = llmsFull(cards, ctx, { description: "An open P&L of the UK state." });
    for (const c of cards) {
      expect(txt).toContain(`\n## ${cardHeadline(c)}\n`);
      expect(txt).toContain(`- **Card:** https://ledger.test/promise/${c.id}\n`);
    }
    expect(txt).toContain("## How a card works");
    expect(txt).toContain("## Licences");
    expect(txt).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------- IndexNow

describe("IndexNow", () => {
  it("the key file is served from the web app's public folder", () => {
    const key = indexNowKey(join(root, "apps/web/public"));
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(readFileSync(join(root, "apps/web/public", `${key}.txt`), "utf8").trim()).toBe(key);
  });

  it("builds a payload for the site's own host only, without duplicates", () => {
    const p = indexNowPayload("https://ledgergov.uk", "a".repeat(32), [
      "https://ledgergov.uk/promise/x",
      "https://ledgergov.uk/promise/x",
      "https://elsewhere.example/promise/x",
      "not a url",
    ]);
    expect(p).toEqual({ host: "ledgergov.uk", key: "a".repeat(32), keyLocation: `https://ledgergov.uk/${"a".repeat(32)}.txt`, urlList: ["https://ledgergov.uk/promise/x"] });
    expect(canSubmit("https://ledgergov.uk")).toBe(true);
    expect(canSubmit("http://localhost:3000")).toBe(false);
    expect(canSubmit("https://localhost")).toBe(false);
  });

  it("submits in one POST and fails loudly on a refusal", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init!.body!) });
      return { ok: true, status: 202, text: async () => "" };
    };
    const p = indexNowPayload("https://ledgergov.uk", "b".repeat(32), ["https://ledgergov.uk/a", "https://ledgergov.uk/b"]);
    await expect(submitIndexNow(p, ok)).resolves.toEqual({ submitted: 2, statuses: [202] });
    expect(calls).toEqual([{ url: "https://api.indexnow.org/indexnow", body: p }]);
    const refused: FetchLike = async () => ({ ok: false, status: 403, text: async () => "key not valid" });
    await expect(submitIndexNow(p, refused)).rejects.toThrow("IndexNow answered 403: key not valid");
  });

  it("names the pages a card change touches", () => {
    const text = readFileSync(join(root, "content/promises/uk-bus-cap-2-2026.yaml"), "utf8");
    const card = changedCard(text)!;
    expect(pagesForCards([card], "https://ledgergov.uk", (id) => (id === "andy-burnham" ? "labour" : undefined))).toEqual([
      "https://ledgergov.uk/promise/uk-bus-cap-2-2026",
      "https://ledgergov.uk/promise/uk-bus-cap-2-2026.md",
      "https://ledgergov.uk/promises/area/transport-and-economy",
      "https://ledgergov.uk/actor/andy-burnham",
      "https://ledgergov.uk/actor/labour",
      "https://ledgergov.uk/promises",
      "https://ledgergov.uk/llms-full.txt",
    ]);
    expect(pagesForCards([], "https://ledgergov.uk")).toEqual([]);
  });

  it("waits until the live Markdown shows the new version of each card", async () => {
    const c = cards.find((x) => x.id === "uk-bus-cap-2-2026")!;
    const card = changedCard(readFileSync(join(root, "content/promises/uk-bus-cap-2-2026.yaml"), "utf8"))!;
    const now = cardMarkdownFile(c, ctx);
    // The deploy before: the newest timeline entry is not there yet.
    const before = now.replace(card.events.at(-1)!.replace(/\s+/g, " ").trim(), "");
    expect(servesCard(now, card)).toBe(true);
    expect(servesCard(before, card)).toBe(false);
    let round = 0;
    let clock = 0;
    const fetchFn: FetchLike = async () => ({ ok: true, status: 200, text: async () => (round >= 2 ? now : before) });
    const live = await waitForDeploy([card], ctx.siteUrl, fetchFn, {
      intervalMs: 10,
      sleep: async () => {
        round++;
        clock += 10;
      },
      now: () => clock,
    });
    expect(live.map((x) => x.id)).toEqual(["uk-bus-cap-2-2026"]);
    expect(round).toBe(2);
    const never: FetchLike = async () => ({ ok: false, status: 404, text: async () => "" });
    clock = 0;
    expect(await waitForDeploy([card], ctx.siteUrl, never, { timeoutMs: 30, intervalMs: 10, sleep: async () => void (clock += 10), now: () => clock })).toEqual([]);
  });
});
