import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  billIdFromUrl,
  billIndex,
  billKey,
  BILLS_API,
  cardsForDivision,
  citedBills,
  constituencies,
  constituencyById,
  constituencyByName,
  constituencyBySlug,
  constituencyForPostcode,
  fetchBillTitle,
  fetchRecentVotes,
  fetchSeat,
  foldName,
  groupTally,
  groupVotes,
  howTheyVoted,
  lookup,
  MEMBERS_API,
  memberVotingUrl,
  outcome,
  plainQuestion,
  POSTCODES_URL,
  queryKind,
  searchConstituencies,
  searchMps,
  slugify,
  splitTitle,
  tidyPostcode,
  UpstreamError,
  type BillTitle,
} from "../src/mp";
import { constituencyPageUrl, fetchConstituencyList } from "../src/mp/refresh";

/** Real responses recorded on 2026-10-08 (see test/fixtures/mp). No test touches the network. */
const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/mp/${name}`, import.meta.url), "utf8"));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  url: string;
  method: string;
  body: string | null;
}

/** Answers only the URLs it is given; anything else fails the test. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch in test: ${url}`);
    return route();
  };
  return { fetch: f, calls };
}

const CITIES = constituencyBySlug("cities-of-london-and-westminster")!;
const HOLBORN = constituencyBySlug("holborn-and-st-pancras")!;
const memberSearch = (name: string) =>
  `${MEMBERS_API}/Members/Search?${new URLSearchParams({ Name: name, House: "1", IsCurrentMember: "true", skip: "0", take: "10" })}`;

describe("the stored constituency list", () => {
  it("has the 650 current constituencies, each with a unique slug made from its name", () => {
    const all = constituencies();
    expect(all).toHaveLength(650);
    expect(new Set(all.map((c) => c.slug)).size).toBe(650);
    expect(new Set(all.map((c) => c.id)).size).toBe(650);
    for (const c of all) expect(c.slug).toBe(slugify(c.name));
  });

  it("makes plain slugs from names with accents, commas and apostrophes", () => {
    expect(slugify("Ynys Môn")).toBe("ynys-mon");
    expect(slugify("Montgomeryshire and Glyndŵr")).toBe("montgomeryshire-and-glyndwr");
    expect(slugify("Argyll, Bute and South Lochaber")).toBe("argyll-bute-and-south-lochaber");
    expect(slugify("Queen's Park and Maida Vale")).toBe("queens-park-and-maida-vale");
    expect(slugify("Inverness, Skye and West Ross-shire")).toBe("inverness-skye-and-west-ross-shire");
  });

  it("finds a constituency by slug, id or name, whatever the case, accents or punctuation", () => {
    expect(CITIES).toMatchObject({ id: 3987, name: "Cities of London and Westminster" });
    expect(constituencyById(4105)?.name).toBe("Holborn and St Pancras");
    expect(constituencyByName("ynys mon")?.slug).toBe("ynys-mon");
    expect(constituencyByName("QUEENS PARK & MAIDA VALE")?.slug).toBe("queens-park-and-maida-vale");
    expect(constituencyBySlug("nowhere")).toBeNull();
  });

  it("searches by the start of each word", () => {
    const leeds = searchConstituencies("leeds").map((c) => c.name);
    expect(leeds.length).toBeGreaterThan(3);
    expect(leeds.every((n) => n.includes("Leeds"))).toBe(true);
    expect(searchConstituencies("manchester cen").map((c) => c.name)).toEqual(["Manchester Central"]);
    expect(searchConstituencies("eds")).toEqual([]);
    expect(searchConstituencies("  ")).toEqual([]);
  });

  it("folds names the same way on both sides", () => {
    expect(foldName("St Helens North")).toBe(foldName("St. Helens  North"));
    expect(foldName("Ynys Môn")).toBe("ynys mon");
  });
});

describe("refreshing the constituency list", () => {
  const page0 = fx("members-constituency-search-0.json") as { totalResults: number; items: { value: { id: number; name: string; endDate: string | null } }[] };

  it("pages through the Members API and keeps current constituencies, A to Z", async () => {
    const first = page0.items.slice(0, 20);
    const rest = page0.items.slice(0, 5).map((i) => ({ value: { ...i.value, id: i.value.id + 100_000, name: `${i.value.name} Extra` } }));
    const { fetch, calls } = fakeFetch({
      [constituencyPageUrl(0)]: () => json({ ...page0, totalResults: 25, items: first }),
      [constituencyPageUrl(20)]: () => json({ ...page0, totalResults: 25, items: rest }),
    });
    const list = await fetchConstituencyList(fetch, "2026-10-08");
    expect(calls).toHaveLength(2);
    expect(list.constituencies).toHaveLength(25);
    expect(list.constituencies[0]).toEqual({ id: 4496, name: "Aberafan Maesteg", slug: "aberafan-maesteg" });
    expect(list).toMatchObject({ licence: "Open Parliament Licence v3.0", fetched_on: "2026-10-08" });
  });

  it("refuses a list that falls short of the API's total or repeats a slug", async () => {
    const short = fakeFetch({ [constituencyPageUrl(0)]: () => json({ ...page0, totalResults: 21 }), [constituencyPageUrl(20)]: () => json({ ...page0, totalResults: 21, items: [] }) });
    await expect(fetchConstituencyList(short.fetch, "2026-10-08")).rejects.toThrow(/expected 21/);
    const twice = [...page0.items.slice(0, 19), { value: { ...page0.items[0]!.value, id: 1, name: "Aberafan, Maesteg" } }];
    const clash = fakeFetch({ [constituencyPageUrl(0)]: () => json({ ...page0, totalResults: 20, items: twice }) });
    await expect(fetchConstituencyList(clash.fetch, "2026-10-08")).rejects.toThrow(/both make the slug aberafan-maesteg/);
  });
});

describe("postcodes", () => {
  it("tells a postcode from half a postcode, a mistyped one and a name", () => {
    expect(queryKind("SW1A 1AA")).toBe("postcode");
    expect(queryKind("sw1a1aa")).toBe("postcode");
    expect(queryKind(" m1 1ae ")).toBe("postcode");
    expect(queryKind("SW1A")).toBe("outcode");
    expect(queryKind("SW1A 1")).toBe("partial_postcode");
    expect(queryKind("Manchester Central")).toBe("text");
    expect(queryKind("   ")).toBe("empty");
    expect(tidyPostcode("sw1a1aa")).toBe("SW1A 1AA");
  });

  it("sends the postcode in a POST body, never in the address", async () => {
    const { fetch, calls } = fakeFetch({ [POSTCODES_URL]: () => json(fx("postcodes-sw1a-1aa.json")) });
    expect(await constituencyForPostcode(fetch, "sw1a1aa")).toBe("Cities of London and Westminster");
    expect(calls).toEqual([{ url: POSTCODES_URL, method: "POST", body: JSON.stringify({ postcodes: ["SW1A 1AA"] }) }]);
    expect(calls[0]!.url).not.toMatch(/SW1A|sw1a/i);
  });

  it("returns null for a postcode postcodes.io does not know", async () => {
    const { fetch } = fakeFetch({ [POSTCODES_URL]: () => json(fx("postcodes-unknown.json")) });
    expect(await constituencyForPostcode(fetch, "ZZ9 9ZZ")).toBeNull();
  });

  it("names the service, never the postcode, when it fails", async () => {
    const { fetch } = fakeFetch({ [POSTCODES_URL]: () => new Response("busy", { status: 503 }) });
    const err = await constituencyForPostcode(fetch, "SW1A 1AA").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(String(err)).toContain("postcodes.io");
    expect(String(err)).not.toMatch(/SW1A/i);
  });
});

describe("who holds a seat", () => {
  it("reads the sitting MP: name, party, since when, and their portrait", async () => {
    const { fetch } = fakeFetch({ [`${MEMBERS_API}/Location/Constituency/3987`]: () => json(fx("members-constituency-3987.json")) });
    const seat = await fetchSeat(fetch, CITIES);
    expect(seat.lastMp).toBeNull();
    expect(seat.mp).toEqual({
      memberId: 5257,
      name: "Rachel Blake",
      party: { id: 15, name: "Labour (Co-op)" },
      since: "2024-07-04",
      photoUrl: "https://members-api.parliament.uk/api/Members/5257/Thumbnail",
    });
  });

  it("says a seat is vacant, and who held it last", async () => {
    const { fetch } = fakeFetch({
      [`${MEMBERS_API}/Location/Constituency/4105`]: () => json(fx("members-constituency-4105.json")),
      [`${MEMBERS_API}/Location/Constituency/4105/Representations`]: () => json(fx("members-representations-4105.json")),
    });
    const seat = await fetchSeat(fetch, HOLBORN);
    expect(seat.mp).toBeNull();
    expect(seat.lastMp).toEqual({ memberId: 4514, name: "Sir Keir Starmer", party: { id: 15, name: "Labour" }, from: "2024-07-04", to: "2026-09-01" });
  });

  it("fails loudly when the API is down or answers in a shape we do not know", async () => {
    const down = fakeFetch({ [`${MEMBERS_API}/Location/Constituency/3987`]: () => new Response("", { status: 500 }) });
    await expect(fetchSeat(down.fetch, CITIES)).rejects.toThrow(UpstreamError);
    const odd = fakeFetch({ [`${MEMBERS_API}/Location/Constituency/3987`]: () => json({ value: { id: 3987 } }) });
    await expect(fetchSeat(odd.fetch, CITIES)).rejects.toThrow(/unexpected answer/);
    const unreachable = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchSeat(unreachable, CITIES)).rejects.toThrow(/members: unreachable/);
  });

  it("finds sitting MPs by name, with their constituency", async () => {
    const { fetch } = fakeFetch({ [memberSearch("powell")]: () => json(fx("members-search-powell.json")) });
    expect(await searchMps(fetch, "powell")).toEqual([
      { memberId: 5229, name: "Joe Powell", party: "Labour", constituencyId: 4125 },
      { memberId: 4263, name: "Lucy Powell", party: "Labour (Co-op)", constituencyId: 4167 },
    ]);
  });
});

describe("the one search box", () => {
  const routes = {
    [POSTCODES_URL]: () => json(fx("postcodes-sw1a-1aa.json")),
    [memberSearch("powell")]: () => json(fx("members-search-powell.json")),
    [memberSearch("Lucy Powell")]: () => json(fx("members-search-lucy-powell.json")),
    [memberSearch("Leeds")]: () => json({ items: [] }),
    [memberSearch("Nobody Atall")]: () => json({ items: [] }),
  };

  it("goes straight to the constituency for a postcode", async () => {
    const { fetch } = fakeFetch(routes);
    expect(await lookup("sw1a 1aa", fetch)).toEqual({ result: { kind: "found", slug: "cities-of-london-and-westminster" }, by: "postcode" });
  });

  it("goes straight to the constituency for its exact name, without asking anyone", async () => {
    const { fetch, calls } = fakeFetch(routes);
    expect((await lookup("manchester central", fetch)).result).toEqual({ kind: "found", slug: "manchester-central" });
    expect(calls).toEqual([]);
  });

  it("goes straight to an MP's constituency when only one MP matches", async () => {
    const { fetch } = fakeFetch(routes);
    expect(await lookup("Lucy Powell", fetch)).toEqual({ result: { kind: "found", slug: "manchester-central" }, by: "name" });
  });

  it("offers a short list when several MPs or constituencies match", async () => {
    const { fetch } = fakeFetch(routes);
    const powell = (await lookup("powell", fetch)).result;
    expect(powell).toEqual({
      kind: "choices",
      choices: [
        { slug: "kensington-and-bayswater", constituency: "Kensington and Bayswater", mp: "Joe Powell", party: "Labour" },
        { slug: "manchester-central", constituency: "Manchester Central", mp: "Lucy Powell", party: "Labour (Co-op)" },
      ],
    });
    const leeds = (await lookup("Leeds", fetch)).result;
    expect(leeds.kind).toBe("choices");
    if (leeds.kind === "choices") expect(leeds.choices.every((c) => c.constituency.startsWith("Leeds") && c.mp === null)).toBe(true);
  });

  it("explains, without sending anything anywhere, half a postcode or a mistyped one", async () => {
    const { fetch, calls } = fakeFetch(routes);
    expect(await lookup("SW1A", fetch)).toEqual({ result: { kind: "not_found", reason: "outcode" }, by: "postcode" });
    expect(await lookup("SW1A 1", fetch)).toEqual({ result: { kind: "not_found", reason: "postcode" }, by: "postcode" });
    expect(await lookup("", fetch)).toEqual({ result: { kind: "empty" }, by: "none" });
    expect(await lookup("x", fetch)).toEqual({ result: { kind: "not_found", reason: "short" }, by: "name" });
    expect(calls).toEqual([]);
  });

  it("says when nothing matches, and when a service is down", async () => {
    const { fetch } = fakeFetch(routes);
    expect((await lookup("Nobody Atall", fetch)).result).toEqual({ kind: "not_found", reason: "name" });
    const unknown = fakeFetch({ [POSTCODES_URL]: () => json(fx("postcodes-unknown.json")) });
    expect((await lookup("ZZ9 9ZZ", unknown.fetch)).result).toEqual({ kind: "not_found", reason: "postcode" });
    const down = fakeFetch({ [POSTCODES_URL]: () => new Response("", { status: 502 }), [memberSearch("Nobody Atall")]: () => new Response("", { status: 503 }) });
    expect((await lookup("SW1A 1AA", down.fetch)).result).toEqual({ kind: "unavailable" });
    expect((await lookup("Nobody Atall", down.fetch)).result).toEqual({ kind: "unavailable" });
  });

  it("still offers constituencies by name when the MP search is down", async () => {
    const { fetch } = fakeFetch({ [memberSearch("Leeds")]: () => new Response("", { status: 503 }) });
    expect((await lookup("Leeds", fetch)).result.kind).toBe("choices");
  });
});

describe("recent votes", () => {
  const votingUrl = memberVotingUrl(4456);
  const load = async () => fetchRecentVotes(fakeFetch({ [votingUrl]: () => json(fx("votes-membervoting-4456.json")) }).fetch, 4456);

  it("reads how the MP voted in each division, newest first", async () => {
    const votes = await load();
    expect(votes).toHaveLength(10);
    expect(votes[0]).toEqual({
      divisionId: 2425,
      date: "2026-09-10",
      title: "Social Housing Bill [Lords]: Reasoned Amendment to Second Reading",
      ayes: 77,
      noes: 292,
      side: "no",
      teller: false,
    });
    // Parliament's title had a double space; titles are tidied.
    expect(votes[1]!.title).toBe("Draft Plant Health, Seeds, Seed Potatoes and Plant Propagating Material (Amendment) (Northern Ireland) Regulations 2026");
    expect(votes.map((v) => v.date)).toEqual([...votes.map((v) => v.date)].sort().reverse());
  });

  it("knows a teller's side from the teller lists", async () => {
    const one = (fx("votes-membervoting-4456.json") as { PublishedDivision: Record<string, unknown> }[])[0]!;
    const asTeller = [{ ...one, MemberVotedAye: false, MemberVotedNo: false, MemberWasTeller: true, PublishedDivision: { ...one.PublishedDivision, NoTellers: [{ MemberId: 4456 }] } }];
    const votes = await fetchRecentVotes(fakeFetch({ [votingUrl]: () => json(asTeller) }).fetch, 4456);
    expect(votes[0]).toMatchObject({ side: "no", teller: true });
    expect(howTheyVoted(votes[0]!)).toBe("Counted the votes against (a teller)");
  });

  it("groups neighbouring votes on one bill, and tallies them", async () => {
    const groups = groupVotes(await load());
    expect(groups.map((g) => [g.subject, g.votes.length])).toEqual([
      ["Social Housing Bill [Lords]", 1],
      ["Draft Plant Health, Seeds, Seed Potatoes and Plant Propagating Material (Amendment) (Northern Ireland) Regulations 2026", 1],
      ["Health Bill", 6],
      ["Representation of the People Bill", 2],
    ]);
    const health = groups[2]!;
    expect(health).toMatchObject({ bill: "health bill", first: "2026-09-07", last: "2026-09-08", forCount: 0, againstCount: 6 });
    expect(groupTally(health)).toBe("Voted against all 6");
    expect(groupTally(groups[3]!)).toBe("For 1, against 1");
    expect(groupTally(groups[0]!)).toBe("Voted against");
    expect(groups[1]!.bill).toBeNull();
  });

  it("puts each familiar stage as a plain question", () => {
    expect(plainQuestion("Social Housing Bill [Lords]: Reasoned Amendment to Second Reading")).toBe("Should the bill be stopped at its second reading?");
    expect(plainQuestion("Terminally Ill Adults (End of Life) Bill: Second Reading")).toBe("Second reading: should the bill go ahead?");
    expect(plainQuestion("Representation of the People Bill: Third Reading")).toBe("Third reading: should the Commons pass the bill?");
    expect(plainQuestion("Health Bill: Report Stage: New Clause 143")).toBe("Should new clause 143 be added to the bill?");
    expect(plainQuestion("Health Bill: Report Stage: Amendment 1")).toBe("Should amendment 1 be made to the bill?");
    expect(plainQuestion("Draft Plant Health Regulations 2026")).toBeNull();
    expect(plainQuestion("Opposition Day: Something Unfamiliar")).toBeNull();
  });

  it("says who won, by the numbers", () => {
    expect(outcome({ ayes: 411, noes: 102 })).toBe("passed");
    expect(outcome({ ayes: 77, noes: 292 })).toBe("not_passed");
    expect(outcome({ ayes: 300, noes: 300 })).toBe("tied");
  });
});

describe("votes on bills our cards cite", () => {
  const card = (id: string, sources: string[], evidence: string[] = []) => ({
    id,
    file: { sources: sources.map((url) => ({ url })), events: [{}, ...evidence.map((evidence_url) => ({ evidence_url }))] },
  });
  const socialHousing = fx("bills-4126.json") as BillTitle;
  const gbEnergy = fx("bills-3738.json") as BillTitle;

  it("reads bill ids from bills.parliament.uk links only", () => {
    expect(billIdFromUrl("https://bills.parliament.uk/bills/4126")).toBe(4126);
    expect(billIdFromUrl("https://bills.parliament.uk/bills/4126/stages")).toBe(4126);
    expect(billIdFromUrl("https://bills.parliament.uk/bills/4126?tab=news")).toBe(4126);
    expect(billIdFromUrl("https://bills.parliament.uk/bills/41260")).toBe(41260);
    expect(billIdFromUrl("https://bills.parliament.uk/bills/4126x")).toBeNull();
    expect(billIdFromUrl("https://www.legislation.gov.uk/ukpga/2025/16")).toBeNull();
    expect(billIdFromUrl("https://evil.example/bills.parliament.uk/bills/4126")).toBeNull();
  });

  it("collects cited bills from sources and evidence, once per card", () => {
    const cited = citedBills([
      card("social-homes", ["https://bills.parliament.uk/bills/4126", "https://www.gov.uk/x"], ["https://bills.parliament.uk/bills/4126/stages"]),
      card("energy", ["https://www.gov.uk/y"], ["https://bills.parliament.uk/bills/3738"]),
      card("no-bill", ["https://www.legislation.gov.uk/ukpga/2025/16"]),
    ]);
    expect([...cited]).toEqual([
      [4126, ["social-homes"]],
      [3738, ["energy"]],
    ]);
  });

  it("names a bill the same way in the Bills API and in division titles", () => {
    expect(billKey(socialHousing.shortTitle)).toBe("social housing bill");
    expect(billKey(splitTitle("Social Housing Bill [Lords]: Reasoned Amendment to Second Reading").subject)).toBe("social housing bill");
    expect(billKey(gbEnergy.shortTitle)).toBe("great british energy bill");
    expect(billKey("Finance (No. 2) Bill")).toBe("finance no 2 bill");
    expect(billKey("Finance Bill")).not.toBe(billKey("Finance (No. 2) Bill"));
    expect(billKey("Draft Plant Health Regulations 2026")).toBeNull();
  });

  it("links a vote to the cards citing its bill, and leaves other votes alone", async () => {
    const cited = citedBills([card("social-homes", ["https://bills.parliament.uk/bills/4126"]), card("energy", ["https://bills.parliament.uk/bills/3738"])]);
    const titles = await Promise.all(
      [...cited.keys()].map((id) => fetchBillTitle(fakeFetch({ [`${BILLS_API}/Bills/${id}`]: () => json(fx(`bills-${id}.json`)) }).fetch, id)),
    );
    const index = billIndex(titles.filter((t): t is BillTitle => !!t), cited);
    const votes = fx("votes-membervoting-4456.json") as { PublishedDivision: { Title: string } }[];
    const linked = votes.map((v) => ({ title: v.PublishedDivision.Title, cards: cardsForDivision(v.PublishedDivision.Title, index) })).filter((x) => x.cards.length);
    expect(linked).toEqual([{ title: "Social Housing Bill [Lords]: Reasoned Amendment to Second Reading", cards: ["social-homes"] }]);
    // An Act is matched by its bill's name.
    expect(cardsForDivision("Great British Energy Bill: Third Reading", index)).toEqual(["energy"]);
    expect(cardsForDivision("Health Bill: Report Stage: New Clause 143", index)).toEqual([]);
  });

  it("treats an unknown bill id as no bill", async () => {
    const { fetch } = fakeFetch({ [`${BILLS_API}/Bills/99999999`]: () => new Response("The resource Bill ID: 99999999 was not found", { status: 404 }) });
    expect(await fetchBillTitle(fetch, 99999999)).toBeNull();
  });
});
