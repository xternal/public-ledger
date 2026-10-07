import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchDay, sourceFromUpload } from "../src/harvest/sources";
import { govukId, govukSearchUrl, peopleNames, quotesSomeone } from "../src/harvest/sources/govuk";
import {
  debateText,
  flatten,
  HANSARD_API,
  hansardId,
  hansardUrl,
  isStatementDebate,
  memberDirectory,
  parseAttribution,
  partyFromAbbreviation,
  titleSlug,
  type HansardDebate,
} from "../src/harvest/sources/hansard";
import { cleanPersonName, prose, ukDate } from "../src/harvest/sources/util";
import { isOralPointer, wmsId, wmsListUrl, wmsUrl, WMS_API } from "../src/harvest/sources/wms";
import { htmlToText } from "../src/intake/text";
import { fakeFetch, JSON3, json, watchPage, type Route } from "./intake-helpers";

// YouTube links go through safeFetch, which resolves host names: answer with a public address, never the network.
const dns = vi.hoisted(() => ({ lookup: vi.fn(async (_host: string, _opts?: unknown) => [{ address: "142.250.187.206", family: 4 }]) }));
vi.mock("node:dns/promises", () => dns);

/** Real responses recorded on 2026-10-07 (see test/fixtures/harvest). */
function fx<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/harvest/${name}`, import.meta.url), "utf8")) as T;
}

const THIRLWALL = "19E8C247-E4AF-45DC-851C-BF9EFD4BCC23";
const TRIAL_BY_JURY = "760C4895-2912-4E6F-9A2D-45980CD651C7";
const TOURISM_UQ = "646780F0-2705-44B3-B614-C62476DA461E";
const ENGAGEMENTS = "C226C460-61AA-49F3-BBE8-1219B334BEDC";

const thirlwall = fx<HansardDebate>("hansard-debate-19E8C247.json");
const trialByJury = fx<HansardDebate>("hansard-debate-760C4895.json");
const tourismUq = fx<HansardDebate>("hansard-debate-646780F0.json");
const engagements = fx<HansardDebate>("hansard-debate-C226C460.json");

/** A debate that is not a statement, for the debates of the day we did not record. */
function otherDebate(url: string): Response {
  const extId = /debate\/([^/.]+)\.json$/.exec(url)![1]!;
  return json({
    Overview: { ExtId: extId, Title: "Some Debate", HRSTag: "hs_2DebatedMotion" },
    Items: [{ ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 9999, AttributedTo: "A Member (Somewhere) (Lab)", Value: "I beg to move, That this House has considered the matter." }],
    ChildDebates: [],
  });
}

/** GOV.UK content for releases we did not record: a body with no quotes, except one release that quotes someone. */
function otherRelease(url: string): Response {
  const quoted = url.endsWith("/update-on-bright-horizons-regulatory-action");
  const body = quoted
    ? "<p>Ofsted has taken further action.</p><p>“We will keep inspecting every setting,” said the chief inspector.</p>"
    : "<p>The report was published today. It sets out findings.</p>";
  return json({ title: "Release", details: { body } });
}

/** Routes for one day; `overrides` win over the recorded answers. Fixtures are read only when asked for. */
function dayRoutes(date: string, overrides: Record<string, Route | Response | string> = {}): Record<string, Route | Response | string> {
  const q = `date=${date}&house=Commons`;
  const recorded = (name: string): Route => () => json(fx(name));
  const base: Record<string, Route | Response | string> = {
    [`${HANSARD_API}/overview/sectionsforday.json?${q}`]: recorded(`hansard-sectionsforday-${date}.json`),
    [`${HANSARD_API}/overview/sectiontrees.json?${q}&section=Debate`]: recorded(`hansard-sectiontrees-${date}.json`),
    [`${HANSARD_API}/debates/debate/${THIRLWALL}.json`]: json(thirlwall),
    [`${HANSARD_API}/debates/debate/${TOURISM_UQ}.json`]: json(tourismUq),
    [`${HANSARD_API}/debates/debate/${ENGAGEMENTS}.json`]: json(engagements),
    [`${HANSARD_API}/debates/debate/*`]: otherDebate,
    [wmsListUrl(date)]: date === "2026-09-15" ? recorded("wms-list-2026-09-15.json") : json({ totalResults: 0, results: [] }),
    [`${WMS_API}/1943121?expandMember=true`]: recorded("wms-statement-1943121.json"),
    [`${WMS_API}/1942984?expandMember=true`]: recorded("wms-statement-1942984.json"),
    // The recorded search covers 14–15 September, so the UK-day filter has something to drop.
    [govukSearchUrl(date)]: date === "2026-09-15" ? recorded("govuk-search-2026-09-14-to-15.json") : json({ results: [], total: 0 }),
    ["https://www.gov.uk/api/content/government/news/government-to-act-on-thirlwall-patient-safety-recommendations"]: recorded("govuk-content-thirlwall.json"),
    ["https://www.gov.uk/api/content/*"]: otherRelease,
  };
  // fakeFetch takes the first matching key, so overrides go first.
  return { ...overrides, ...Object.fromEntries(Object.entries(base).filter(([k]) => !(k in overrides))) };
}

function stub(routes: Record<string, Route | Response | string>) {
  const f = fakeFetch(routes);
  return { f, fetch: f as unknown as typeof fetch };
}

// ---------------------------------------------------------------- attribution

describe("Hansard attribution", () => {
  it("reads a role with the name in brackets", () => {
    expect(parseAttribution("The Secretary of State for Health and Social Care (Yvette Cooper)")).toEqual({
      name: "Yvette Cooper",
      role: "Secretary of State for Health and Social Care",
      party: null,
      full: true,
      chair: false,
    });
    expect(parseAttribution("The Prime Minister (Andy Burnham)")).toMatchObject({ name: "Andy Burnham", role: "Prime Minister", party: null, chair: false });
    expect(parseAttribution("The Lord Chancellor and Secretary of State for Justice (Alex Norris)")).toMatchObject({
      name: "Alex Norris",
      role: "Lord Chancellor and Secretary of State for Justice",
    });
  });

  it("reads a member with constituency and party", () => {
    expect(parseAttribution("Kemi Badenoch (North West Essex) (Con)")).toEqual({ name: "Kemi Badenoch", role: null, party: "Conservative", full: true, chair: false });
    expect(parseAttribution("Mrs Kemi Badenoch (North West Essex) (Con)")).toMatchObject({ name: "Kemi Badenoch", party: "Conservative" });
    expect(parseAttribution("Dr Scott Arthur (Edinburgh South West) (Lab)")).toMatchObject({ name: "Scott Arthur", party: "Labour" });
    expect(parseAttribution("Sir Bernard Jenkin (Harwich and North Essex) (Con)")).toMatchObject({ name: "Bernard Jenkin" });
    expect(parseAttribution("Dame Siobhain McDonagh (Mitcham and Morden) (Lab)")).toMatchObject({ name: "Siobhain McDonagh" });
    expect(parseAttribution("Ms Jane Doe (Somewhere) (Ind)")).toMatchObject({ name: "Jane Doe", party: "Independent" });
    expect(parseAttribution("Mr John Roe (Somewhere) (Reform)")).toMatchObject({ name: "John Roe", party: "Reform UK" });
    expect(parseAttribution("Sarah Hall (Warrington South) (Lab/Co-op)")).toMatchObject({ party: "Labour (Co-op)" });
  });

  it("knows the chair, and keeps it as a speaker", () => {
    expect(parseAttribution("Madam Deputy Speaker (Ms Nusrat Ghani)")).toEqual({ name: "Nusrat Ghani", role: "Deputy Speaker", party: null, full: true, chair: true });
    expect(parseAttribution("Mr Speaker")).toMatchObject({ name: null, role: "Speaker", chair: true });
    expect(parseAttribution("Mr Deputy Speaker")).toMatchObject({ role: "Deputy Speaker", chair: true });
    expect(parseAttribution("The Chairman of Ways and Means (Ms Nusrat Ghani)")).toMatchObject({ chair: true });
    expect(parseAttribution("The Minister for Security (Dan Jarvis)")).toMatchObject({ chair: false });
  });

  it("reads short forms", () => {
    expect(parseAttribution("Yvette Cooper")).toEqual({ name: "Yvette Cooper", role: null, party: null, full: false, chair: false });
    expect(parseAttribution("Mrs Badenoch")).toMatchObject({ name: "Badenoch", full: false });
    expect(parseAttribution("The Prime Minister")).toMatchObject({ name: null, role: "Prime Minister", full: false });
  });

  it("maps every Hansard party abbreviation", () => {
    const table: [string, string][] = [
      ["Con", "Conservative"],
      ["Lab", "Labour"],
      ["LD", "Liberal Democrat"],
      ["SNP", "Scottish National Party"],
      ["Reform", "Reform UK"],
      ["Green", "Green Party"],
      ["PC", "Plaid Cymru"],
      ["DUP", "Democratic Unionist Party"],
      ["SF", "Sinn Féin"],
      ["SDLP", "Social Democratic and Labour Party"],
      ["Alliance", "Alliance"],
      ["Ind", "Independent"],
      ["UUP", "Ulster Unionist Party"],
      ["TUV", "Traditional Unionist Voice"],
    ];
    for (const [abbr, party] of table) expect(partyFromAbbreviation(abbr)).toBe(party);
    // An abbreviation we do not know is kept as printed, never guessed.
    expect(parseAttribution("A Member (Somewhere) (XYZ)").party).toBe("XYZ");
  });

  it("strips honorifics and post-nominals from names", () => {
    expect(cleanPersonName("The Rt Hon Yvette Cooper MP")).toBe("Yvette Cooper");
    expect(cleanPersonName("The Rt Hon Sir Keir Starmer KCB KC MP")).toBe("Keir Starmer");
    expect(cleanPersonName("Jim McMahon OBE MP")).toBe("Jim McMahon");
    expect(cleanPersonName("Lord Hendy of Richmond Hill CBE")).toBe("Lord Hendy of Richmond Hill");
    expect(cleanPersonName("Dame Siobhain McDonagh")).toBe("Siobhain McDonagh");
  });
});

// ---------------------------------------------------------------- statements

describe("Hansard statement detection", () => {
  it("finds the Thirlwall statement from its opening words", () => {
    expect(isStatementDebate(thirlwall)).toBe(true);
  });

  it("does not take an oral question, an urgent question or PMQs for a statement", () => {
    expect(isStatementDebate(trialByJury)).toBe(false);
    // "To ask the Minister … if he will make a statement" is a question, not the speaker making one.
    expect(isStatementDebate(tourismUq)).toBe(false);
    expect(isStatementDebate(engagements)).toBe(false);
  });

  it("looks past the chair to the first substantive contribution", () => {
    const debate: HansardDebate = {
      Overview: { ExtId: "AAAAAAAA-0000-0000-0000-000000000000", Title: "Energy" },
      Items: [
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 467, AttributedTo: "Mr Speaker", Value: "I call the Secretary of State to make a statement." },
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 1, AttributedTo: "The Secretary of State for Energy (A Minister)", Value: "With permission, I would like to make a statement on energy." },
      ],
    };
    expect(isStatementDebate(debate)).toBe(true);
    debate.Items![1]!.Value = "I beg to move, That this House has considered energy.";
    expect(isStatementDebate(debate)).toBe(false);
  });
});

// ---------------------------------------------------------------- text and segments

describe("Hansard text and segments", () => {
  const { text, segments } = debateText(thirlwall);
  const paragraphs = flatten(thirlwall)
    .filter((it) => it.ItemType === "Contribution" && it.HRSTag !== "hs_ColumnNumber")
    .map((it) => ({ attr: it.AttributedTo ?? "", para: htmlToText(it.Value ?? "") }))
    .filter((p) => p.para);

  it("gives each contribution a segment covering exactly its words", () => {
    expect(segments).toHaveLength(paragraphs.length);
    segments.forEach((seg, i) => {
      expect(text.slice(seg.start, seg.end)).toBe(paragraphs[i]!.para);
      // The speaker line comes just before the words.
      expect(text.slice(0, seg.start).endsWith(`${paragraphs[i]!.attr}\n`)).toBe(true);
    });
  });

  it("lays the text out as speaker line, words, blank line", () => {
    expect(text.startsWith("The Secretary of State for Health and Social Care (Yvette Cooper)\nMay I apologise for the timing")).toBe(true);
    expect(text).toContain("\n\nMadam Deputy Speaker (Ms Nusrat Ghani)\nOrder. Because the ministerial statement ran over");
    expect(text).not.toMatch(/column-number|14:32:00|Several hon\. Members rose|<span/);
  });

  it("names, roles and parties come from the attribution and the member id", () => {
    expect(segments[0]).toMatchObject({ name: "Yvette Cooper", role: "Secretary of State for Health and Social Care", party: null, memberId: 420 });
    const cooper = segments.filter((s) => s.memberId === 420);
    expect(cooper.length).toBeGreaterThan(3);
    for (const s of cooper) expect(s).toMatchObject({ name: "Yvette Cooper", role: "Secretary of State for Health and Social Care" });
    expect(segments.find((s) => s.memberId === 3969)).toMatchObject({ name: "Damian Hinds", role: null, party: "Conservative" });
    expect(segments.find((s) => s.memberId === 4460)).toMatchObject({ name: "Nusrat Ghani", role: "Deputy Speaker", party: null });
    expect(segments.find((s) => s.memberId === 5212)).toMatchObject({ name: "Scott Arthur", party: "Labour" });
    expect(segments.find((s) => s.memberId === 4934)).toMatchObject({ name: "Helen Morgan", party: "Liberal Democrat" });
  });

  it("fills in the Prime Minister and short names at PMQs", () => {
    const pmqs = debateText(engagements);
    const pm = pmqs.segments.filter((s) => s.memberId === 1427);
    expect(pm.length).toBeGreaterThan(5);
    for (const s of pm) expect(s).toMatchObject({ name: "Andy Burnham", role: "Prime Minister", party: null });
    const lo = pmqs.segments.filter((s) => s.memberId === 4597);
    expect(lo.length).toBeGreaterThan(2);
    for (const s of lo) expect(s).toMatchObject({ name: "Kemi Badenoch", party: "Conservative", role: null });
    expect(pmqs.segments.find((s) => s.memberId === 467)).toMatchObject({ role: "Speaker" });
    for (const s of pmqs.segments) expect(pmqs.text.slice(s.start, s.end).trim()).toBe(pmqs.text.slice(s.start, s.end));
  });

  it("uses the rest of the day for a member who is only named by role in one debate", () => {
    const short: HansardDebate = {
      Overview: { ExtId: "BBBBBBBB-0000-0000-0000-000000000000", Title: "Cost of Living" },
      Items: [{ ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 1427, AttributedTo: "The Prime Minister", Value: "We will cut bills." }],
    };
    expect(debateText(short).segments[0]).toMatchObject({ name: "Prime Minister", role: "Prime Minister" });
    expect(debateText(short, memberDirectory([engagements])).segments[0]).toMatchObject({ name: "Andy Burnham", role: "Prime Minister" });
  });

  it("merges one speaker's items in a row into one segment, and the joined text is in the text", () => {
    const debate: HansardDebate = {
      Overview: { ExtId: "CCCCCCCC-0000-0000-0000-000000000000", Title: "Statement" },
      Items: [
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 7, AttributedTo: "The Minister for Things (Sam Smith)", Value: "<p>First part.</p>" },
        { ItemType: "Contribution", HRSTag: "hs_ColumnNumber", MemberId: null, AttributedTo: null, Value: '<span class="column-number" data-column-number="12"></span>' },
        { ItemType: "Timestamp", HRSTag: null, MemberId: null, AttributedTo: "", Value: "14:00:00" },
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 7, AttributedTo: "Sam Smith", Value: "Second part, &pound;5 billion." },
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: null, AttributedTo: "Several hon. Members rose—", Value: "" },
        { ItemType: "Contribution", HRSTag: "hs_Para", MemberId: 8, AttributedTo: "Pat Jones (Elsewhere) (Green)", Value: "A question." },
      ],
    };
    const { text, segments } = debateText(debate);
    expect(text).toBe("The Minister for Things (Sam Smith)\nFirst part.\nSecond part, £5 billion.\n\nPat Jones (Elsewhere) (Green)\nA question.");
    expect(segments).toHaveLength(2);
    expect(text.slice(segments[0]!.start, segments[0]!.end)).toBe("First part.\nSecond part, £5 billion.");
    expect(segments[0]).toMatchObject({ name: "Sam Smith", role: "Minister for Things", memberId: 7 });
    expect(segments[1]).toMatchObject({ name: "Pat Jones", party: "Green Party", memberId: 8 });
  });
});

// ---------------------------------------------------------------- the day

describe("fetchDay with recorded responses", () => {
  it("returns the Thirlwall statement, two written statements and the day's press releases", async () => {
    const { f, fetch } = stub(dayRoutes("2026-09-15"));
    const { docs, errors } = await fetchDay("2026-09-15", { fetch });
    expect(errors).toEqual([]);

    const hansard = docs.filter((d) => d.kind.startsWith("hansard_") && d.kind !== "hansard_wms");
    expect(hansard.map((d) => d.id)).toEqual(["hansard-19e8c247"]);
    expect(hansard[0]).toMatchObject({
      kind: "hansard_statement",
      title: "Thirlwall Inquiry: Final Report and Recommendations",
      url: "https://hansard.parliament.uk/Commons/2026-09-15/debates/19E8C247-E4AF-45DC-851C-BF9EFD4BCC23/ThirlwallInquiryFinalReportAndRecommendations",
      date: "2026-09-15",
      venue: "parliament",
      venueLabel: "Commons statement",
      people: [],
    });
    expect(hansard[0]!.text).toBe(debateText(thirlwall).text);

    // Oral questions (outside the Prime Minister's) are never fetched; procedural items are skipped.
    const debates = f.calls.filter((u) => u.includes("/debates/debate/"));
    expect(debates).not.toContain(`${HANSARD_API}/debates/debate/${TRIAL_BY_JURY}.json`);
    expect(debates).toContain(`${HANSARD_API}/debates/debate/${TOURISM_UQ}.json`);
    for (const skipped of ["551D379B", "DAAE3616", "4DF677F4", "8957A9F7", "A018A4D3", "43CC131A", "848716E0"]) {
      expect(debates.some((u) => u.includes(skipped))).toBe(false);
    }
    expect(debates).toHaveLength(10);

    const wms = docs.filter((d) => d.kind === "hansard_wms");
    expect(wms.map((d) => d.id)).toEqual(["wms-hcws353", "wms-hcws351"]);
    const aml = wms[0]!;
    expect(aml).toMatchObject({
      url: "https://questions-statements.parliament.uk/written-statements/detail/2026-09-15/HCWS353",
      title: "Anti-Money Laundering and Asset Recovery Strategy 2026-29",
      venue: "parliament",
      venueLabel: "Written ministerial statement",
      people: ["Dan Jarvis"],
    });
    expect(aml.text.length).toBeGreaterThan(1000); // the full text, not the list's preview
    expect(aml.text).not.toMatch(/\.\.\.$/);
    expect(aml.segments).toEqual([{ start: 0, end: aml.text.length, name: "Dan Jarvis", role: "Minister of State for Security", party: "Labour", memberId: 4243 }]);
    // The pointer to the oral statement is skipped without reading it in full.
    expect(f.calls.filter((u) => u.startsWith(`${WMS_API}/`))).toHaveLength(2);

    const govuk = docs.filter((d) => d.kind === "govuk_press_release");
    expect(govuk.map((d) => d.id)).toEqual([
      "govuk-thousands-more-young-people-to-access-help-with-lifes-bigges",
      "govuk-government-to-act-on-thirlwall-patient-safety-recommendation",
      "govuk-councils-high-cost-services-to-be-transformed-through-91m-fu",
      "govuk-update-on-bright-horizons-regulatory-action",
      "govuk-new-sovereign-uk-turbojet-engine-takes-to-the-skies-in-under",
      "govuk-government-introduces-repeal-bill-to-remove-outdated-constit",
      "govuk-new-rules-pave-the-way-for-businesses-to-adopt-digital-proof",
    ]);
    for (const d of govuk) {
      expect(d.id.length).toBeLessThanOrEqual("govuk-".length + 60);
      expect(d).toMatchObject({ venue: "press_release", date: "2026-09-15", segments: [] });
    }
    expect(govuk[0]!.people).toEqual(["Vicky Foxcroft", "Lisa Nandy"]);
    const release = govuk[1]!;
    expect(release).toMatchObject({
      url: "https://www.gov.uk/government/news/government-to-act-on-thirlwall-patient-safety-recommendations",
      title: "Government to act on Thirlwall patient safety recommendations",
      venueLabel: "Press release (Department of Health and Social Care)",
      people: ["Yvette Cooper"],
    });
    expect(release.text.startsWith("Government to act on Thirlwall patient safety recommendations\nGovernment sets out immediate steps")).toBe(true);
    expect(release.text).toContain("Health and Social Care Secretary Yvette Cooper said:\nThe suffering endured by these babies");
    expect(govuk[2]!.people).toEqual(["Jim McMahon"]);
    expect(govuk[3]!.people).toEqual([]); // kept because the body quotes someone
  });

  it("keeps only press releases on the UK day, newest first, up to the limit", async () => {
    const { fetch } = stub(dayRoutes("2026-09-15"));
    const { docs } = await fetchDay("2026-09-15", { fetch, govukLimit: 2 });
    const govuk = docs.filter((d) => d.kind === "govuk_press_release");
    expect(govuk.map((d) => d.id)).toEqual([
      "govuk-thousands-more-young-people-to-access-help-with-lifes-bigges",
      "govuk-government-to-act-on-thirlwall-patient-safety-recommendation",
    ]);
  });

  it("reads PMQs from the Prime Minister's questions in Oral Answers", async () => {
    const date = "2026-09-09";
    const routes = dayRoutes(date, { [`${HANSARD_API}/overview/sectionsforday.json?date=${date}&house=Commons`]: json(["Debate", "WMS"]) });
    const { docs, errors } = await fetchDay(date, { fetch: stub(routes).fetch });
    expect(errors).toEqual([]);
    const pmqs = docs.filter((d) => d.kind === "hansard_pmqs");
    expect(pmqs).toHaveLength(1);
    expect(pmqs[0]).toMatchObject({
      id: "hansard-c226c460",
      title: "Engagements",
      venue: "parliament",
      venueLabel: "Prime Minister's Questions",
      url: "https://hansard.parliament.uk/Commons/2026-09-09/debates/C226C460-61AA-49F3-BBE8-1219B334BEDC/Engagements",
    });
    expect(pmqs[0]!.segments.find((s) => s.memberId === 1427)).toMatchObject({ name: "Andy Burnham", role: "Prime Minister" });
  });

  it("returns no Hansard documents on a day the House did not sit", async () => {
    const { f, fetch } = stub(dayRoutes("2026-09-16"));
    const { docs, errors } = await fetchDay("2026-09-16", { fetch });
    expect(errors).toEqual([]);
    expect(docs).toEqual([]);
    expect(f.calls.some((u) => u.includes("sectiontrees"))).toBe(false);
  });

  it("reports a failing endpoint in errors and still returns the other sources", async () => {
    const routes = dayRoutes("2026-09-15", {
      [wmsListUrl("2026-09-15")]: new Response("upstream error", { status: 500 }),
      [`${HANSARD_API}/debates/debate/${TOURISM_UQ}.json`]: new Response("not found", { status: 404 }),
      ["https://www.gov.uk/api/content/government/news/update-on-bright-horizons-regulatory-action"]: () => Promise.reject(new TypeError("fetch failed")),
    });
    const { docs, errors } = await fetchDay("2026-09-15", { fetch: stub(routes).fetch });
    expect(errors).toEqual([
      { sourceId: "hansard-646780f0", message: `HTTP 404 from hansard-api.parliament.uk/debates/debate/${TOURISM_UQ}.json` },
      { sourceId: "wms", message: "HTTP 500 from questions-statements-api.parliament.uk/api/writtenstatements/statements" },
      { sourceId: "govuk-update-on-bright-horizons-regulatory-action", message: "fetch failed" },
    ]);
    expect(docs.some((d) => d.id === "hansard-19e8c247")).toBe(true);
    expect(docs.some((d) => d.kind === "hansard_wms")).toBe(false);
    expect(docs.filter((d) => d.kind === "govuk_press_release")).toHaveLength(6);
  });

  it("reports a whole source that is down, and refuses a malformed date", async () => {
    const routes = dayRoutes("2026-09-15", { [`${HANSARD_API}/overview/sectionsforday.json?date=2026-09-15&house=Commons`]: new Response("", { status: 503 }) });
    const { docs, errors } = await fetchDay("2026-09-15", { fetch: stub(routes).fetch });
    expect(errors).toEqual([{ sourceId: "hansard", message: "HTTP 503 from hansard-api.parliament.uk/overview/sectionsforday.json" }]);
    expect(docs.filter((d) => d.kind === "hansard_wms")).toHaveLength(2);
    await expect(fetchDay("15/09/2026", { fetch: stub({}).fetch })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

// ---------------------------------------------------------------- pieces

describe("written statements", () => {
  it("skips pointers to an oral statement", () => {
    expect(isOralPointer("Please refer to the Oral Statement I have made today on this subject.")).toBe(true);
    expect(isOralPointer("Today the Government published the Anti-Money Laundering and Asset Recovery Strategy.")).toBe(false);
  });
});

describe("GOV.UK", () => {
  it("dates releases by the UK calendar", () => {
    expect(ukDate("2026-09-14T23:01:02Z")).toBe("2026-09-15"); // 00:01 BST
    expect(ukDate("2026-09-14T16:16:06Z")).toBe("2026-09-14");
    expect(ukDate("2026-12-14T23:30:00Z")).toBe("2026-12-14"); // GMT
  });

  it("cleans people to plain names", () => {
    expect(peopleNames([{ title: "The Rt Hon Lisa Nandy MP" }, { title: "Vicky Foxcroft MP" }, "Jim McMahon OBE MP", { title: "The Rt Hon Lisa Nandy MP" }])).toEqual([
      "Lisa Nandy",
      "Vicky Foxcroft",
      "Jim McMahon",
    ]);
  });

  it("reads the body as the page shows it, without stray spaces from links", () => {
    expect(prose('<p>A notice (<abbr title="Welfare Requirements Notice">WRN</abbr>) was served; see <a href="/r">the report</a>.</p><p>Next.</p>')).toBe(
      "A notice (WRN) was served; see the report.\nNext.",
    );
  });

  it("knows when a body quotes someone", () => {
    expect(quotesSomeone("<p>“We will act,” said the minister.</p>", "“We will act,” said the minister.")).toBe(true);
    expect(quotesSomeone("<p>She said:</p><blockquote><p>We will act.</p></blockquote>", "She said:\nWe will act.")).toBe(true);
    expect(quotesSomeone("<p>The report was published today.</p>", "The report was published today.")).toBe(false);
    expect(quotesSomeone("<p>The inspector said the home was safe.</p>", "The inspector said the home was safe.")).toBe(false);
  });
});

describe("ids and public URLs", () => {
  it("follow the shared conventions", () => {
    expect(hansardId(THIRLWALL)).toBe("hansard-19e8c247");
    expect(titleSlug("Thirlwall Inquiry: Final Report  and Recommendations")).toBe("ThirlwallInquiryFinalReportAndRecommendations");
    expect(titleSlug("Young Carers’ Champions")).toBe("YoungCarersChampions");
    expect(titleSlug(" Murder of George Low:  10th Anniversary")).toBe("MurderOfGeorgeLow10thAnniversary");
    expect(hansardUrl("2026-09-15", THIRLWALL, "Thirlwall Inquiry: Final Report and Recommendations")).toBe(
      "https://hansard.parliament.uk/Commons/2026-09-15/debates/19E8C247-E4AF-45DC-851C-BF9EFD4BCC23/ThirlwallInquiryFinalReportAndRecommendations",
    );
    expect(wmsId("HCWS353")).toBe("wms-hcws353");
    expect(wmsUrl("2026-09-15", "HCWS353")).toBe("https://questions-statements.parliament.uk/written-statements/detail/2026-09-15/HCWS353");
    expect(govukId("/government/news/government-to-act-on-thirlwall-patient-safety-recommendations")).toBe(
      "govuk-government-to-act-on-thirlwall-patient-safety-recommendation",
    );
    expect(govukId("/government/news/short-one")).toBe("govuk-short-one");
  });
});

// ---------------------------------------------------------------- uploads

describe("sourceFromUpload", () => {
  const base = { url: "https://www.example.org/speech", title: "Conference speech", date: "2026-09-28", venue: "speech" as const };

  it("makes one segment for the whole text when the speaker is given", async () => {
    const text = "We will build 1.5 million homes.\r\nAnd we will do it by 2029.";
    const doc = await sourceFromUpload({ ...base, text, speaker: { name: "Andy Burnham", role: "Prime Minister", party: "Labour" } });
    const clean = "We will build 1.5 million homes.\nAnd we will do it by 2029.";
    expect(doc).toEqual({
      id: `upload-${createHash("sha256").update(clean).digest("hex").slice(0, 10)}`,
      kind: "upload",
      url: base.url,
      title: base.title,
      date: base.date,
      venue: "speech",
      venueLabel: "Speech",
      text: clean,
      segments: [{ start: 0, end: clean.length, name: "Andy Burnham", role: "Prime Minister", party: "Labour", memberId: null }],
      people: ["Andy Burnham"],
    });
  });

  it("has no segments without a speaker, and keeps a given venue label", async () => {
    const doc = await sourceFromUpload({ ...base, text: "Some words.", venueLabel: "Labour conference" });
    expect(doc.segments).toEqual([]);
    expect(doc.venueLabel).toBe("Labour conference");
    expect(doc.id).toMatch(/^upload-[0-9a-f]{10}$/);
  });

  it("reads YouTube captions through safeFetch, segments joined by single spaces", async () => {
    const f = fakeFetch({
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ": watchPage("dQw4w9WgXcQ"),
      "https://www.youtube.com/api/timedtext*": json(JSON3),
    });
    const doc = await sourceFromUpload({ ...base, youtubeUrl: "https://youtu.be/dQw4w9WgXcQ?t=60", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { fetch: f as unknown as typeof fetch });
    expect(doc.text).toBe("Good morning, everyone. And let me be clear: we will build one and a half million homes in this Parliament. Thank you");
    expect(doc.id).toBe(`upload-${createHash("sha256").update(doc.text).digest("hex").slice(0, 10)}`);
    // The written (manual) English track, as JSON.
    expect(f.calls[1]).toMatch(/name=manual.*fmt=json3/);
    // Every hop was checked by the SSRF guard (against the stubbed resolver).
    expect(dns.lookup.mock.calls.map((c) => c[0])).toEqual(["www.youtube.com", "www.youtube.com"]);
  });

  it("refuses a link that is not a YouTube video, and an empty upload", async () => {
    await expect(sourceFromUpload({ ...base, youtubeUrl: "https://www.example.org/video" })).rejects.toThrow(/YouTube/);
    await expect(sourceFromUpload({ ...base })).rejects.toThrow(/text or a YouTube link/);
  });
});
