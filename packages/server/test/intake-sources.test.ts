import { describe, expect, it } from "vitest";
import { formatVideoTime, normaliseUrl, parseVideoTime } from "../src/intake/normalise";
import { assertPublicUrl, BlockedUrlError, isPublicAddress, safeFetch } from "../src/intake/ssrf";
import { archiveUrl } from "../src/intake/archive";
import {
  captionTracksFrom,
  htmlToText,
  matchQuote,
  normaliseForMatch,
  pickCaptionTrack,
  playerResponseFrom,
  transcriptFromJson3,
} from "../src/intake/text";
import { fakeFetch, fakeLookup, JSON3, json, PUBLIC_DNS, watchPage } from "./intake-helpers";

describe("URL normalisation", () => {
  const cases: [string, string, number | null][] = [
    ["HTTPS://WWW.GOV.UK/Government/News/Bus-Fares/", "https://www.gov.uk/Government/News/Bus-Fares", null],
    ["https://www.gov.uk/", "https://www.gov.uk", null],
    ["https://news.example.org/a/?utm_source=x&id=7&UTM_Medium=y&fbclid=abc#comments", "https://news.example.org/a?id=7", null],
    ["https://news.example.org/a?gclid=1&si=2", "https://news.example.org/a", null],
    ["https://news.example.org:443/a?q=%20x+y", "https://news.example.org/a?q=%20x+y", null],
    ["http://hansard.parliament.uk/Commons/2026-10-01/debates/X#contribution-1", "http://hansard.parliament.uk/Commons/2026-10-01/debates/X", null],
    ["https://youtu.be/dQw4w9WgXcQ?si=share123", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", null],
    ["https://youtu.be/dQw4w9WgXcQ?t=754", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 754],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12m34s&feature=share", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 754],
    ["https://m.youtube.com/watch?feature=youtu.be&v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", null],
    ["https://youtube.com/shorts/dQw4w9WgXcQ?feature=share", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", null],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?si=x&t=1h2m3s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 3723],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ?start=90", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 90],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=1m30s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 90],
    ["https://www.youtube.com/@PrimeMinister/videos", "https://www.youtube.com/@PrimeMinister/videos", null],
  ];
  it.each(cases)("%s → %s", (input, url, time) => {
    const n = normaliseUrl(input);
    expect(n.url).toBe(url);
    expect(n.linkTime).toBe(time);
  });

  it("refuses non-web links", () => {
    expect(() => normaliseUrl("javascript:alert(1)")).toThrow();
    expect(() => normaliseUrl("ftp://example.org/x")).toThrow();
    expect(() => normaliseUrl("not a url")).toThrow();
  });

  it("reads and writes video times", () => {
    expect(parseVideoTime("12:34")).toBe(754);
    expect(parseVideoTime("1:02:03")).toBe(3723);
    expect(parseVideoTime("75:30")).toBe(4530);
    expect(parseVideoTime("90")).toBe(90);
    expect(parseVideoTime("1h2m3s")).toBe(3723);
    expect(parseVideoTime("1:75:00")).toBeNull();
    expect(parseVideoTime("12:3")).toBeNull();
    expect(parseVideoTime("soon")).toBeNull();
    expect(parseVideoTime("")).toBeNull();
    expect(formatVideoTime(754)).toBe("12:34");
    expect(formatVideoTime(3723)).toBe("1:02:03");
  });
});

describe("SSRF guard", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.20.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["fd00:ec2::254", false],
    ["fe80::1", false],
    ["ff02::1", false],
    ["64:ff9b::a00:1", false],
    ["2002:0a00:0001::1", false],
    ["2001:db8::1", false],
    ["93.184.215.14", true],
    ["151.101.64.144", true],
    ["::ffff:93.184.215.14", true],
    ["2a00:1450:4009:81f::200e", true],
    ["not-an-ip", false],
  ])("%s public: %s", (ip, ok) => {
    expect(isPublicAddress(ip)).toBe(ok);
  });

  const lookup = fakeLookup({ ...PUBLIC_DNS, "internal.example.org": ["10.0.0.7"], "mixed.example.org": ["93.184.215.14", "127.0.0.1"] });
  const refuse = async (url: string) => {
    const f = fakeFetch({});
    const err = await safeFetch(url, { fetch: f, lookup }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(f.calls).toEqual([]); // never requested
    return (err as BlockedUrlError).reason;
  };

  it("refuses private, loopback, link-local and metadata addresses before any request", async () => {
    expect(await refuse("http://127.0.0.1/")).toBe("private_address");
    expect(await refuse("http://10.0.0.1/admin")).toBe("private_address");
    expect(await refuse("http://169.254.169.254/latest/meta-data/")).toBe("private_address");
    expect(await refuse("http://[::1]/")).toBe("private_address");
    expect(await refuse("http://[::ffff:127.0.0.1]/")).toBe("private_address");
    expect(await refuse("https://internal.example.org/")).toBe("private_address");
    expect(await refuse("https://mixed.example.org/")).toBe("private_address");
    expect(await refuse("http://localhost/")).toBe("private_host");
    expect(await refuse("http://metadata.google.internal/")).toBe("private_host");
    expect(await refuse("https://www.gov.uk:8443/")).toBe("port");
    expect(await refuse("https://user:pw@www.gov.uk/")).toBe("credentials");
    expect(await refuse("https://nowhere.example.org/")).toBe("dns");
  });

  it("re-checks every redirect hop and refuses a redirect to a private address", async () => {
    const f = fakeFetch({
      "https://news.example.org/story": new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    });
    const err = await safeFetch("https://news.example.org/story", { fetch: f, lookup }).catch((e: unknown) => e);
    expect((err as BlockedUrlError).reason).toBe("private_address");
    expect(f.calls).toEqual(["https://news.example.org/story"]);
  });

  it("follows at most 3 redirects", async () => {
    const hop = (n: number) => new Response(null, { status: 301, headers: { location: `/r${n}` } });
    const f = fakeFetch({
      "https://news.example.org/r0": hop(1),
      "https://news.example.org/r1": hop(2),
      "https://news.example.org/r2": hop(3),
      "https://news.example.org/r3": "<p>made it</p>",
    });
    const ok = await safeFetch("https://news.example.org/r0", { fetch: f, lookup });
    expect(ok.finalUrl).toBe("https://news.example.org/r3");
    const g = fakeFetch({ ...Object.fromEntries([0, 1, 2, 3].map((n) => [`https://news.example.org/r${n}`, hop(n + 1)])) });
    const err = await safeFetch("https://news.example.org/r0", { fetch: g, lookup }).catch((e: unknown) => e);
    expect((err as BlockedUrlError).reason).toBe("too_many_redirects");
  });

  it("cuts the body at the cap", async () => {
    const f = fakeFetch({ "https://news.example.org/big": new Response("x".repeat(5000), { headers: { "content-type": "text/plain" } }) });
    const r = await safeFetch("https://news.example.org/big", { fetch: f, lookup, maxBytes: 1000 });
    expect(r.body.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  it("checks the URL itself before resolving", async () => {
    await expect(assertPublicUrl(new URL("file:///etc/passwd"), lookup)).rejects.toThrow(BlockedUrlError);
    await expect(assertPublicUrl(new URL("https://www.gov.uk/x"), lookup)).resolves.toEqual(["151.101.64.144"]);
  });
});

describe("transcripts and exact match", () => {
  it("reads caption tracks from a watch page and prefers English written by people", () => {
    const player = playerResponseFrom(watchPage("dQw4w9WgXcQ"));
    expect(player).not.toBeNull();
    const track = pickCaptionTrack(captionTracksFrom(player!));
    expect(track?.languageCode).toBe("en-GB");
    expect(pickCaptionTrack([{ baseUrl: "u", languageCode: "fr" }, { baseUrl: "a", languageCode: "en", kind: "asr" }])?.baseUrl).toBe("a");
    expect(playerResponseFrom("<html>no player</html>")).toBeNull();
  });

  it("builds timed text from json3 and finds the quote with its timestamp", () => {
    const t = transcriptFromJson3(JSON3);
    expect(t.text).toContain("we will build one and a half million homes in this Parliament.");
    const m = matchQuote("We will build one-and-a-half million homes in this Parliament", t, 754);
    expect(m).not.toBeNull();
    expect(m!.source).toBe("transcript");
    expect(m!.at_seconds).toBe(751);
    expect(m!.near_video_time).toBe(true);
    expect(m!.text).toBe("we will build one and a half million homes in this Parliament");
    expect(matchQuote("we will build two million homes", t, null)).toBeNull();
    expect(matchQuote("we will build one and a half million homes", t, 2000)!.near_video_time).toBe(false);
    expect(matchQuote("Thank you", t, null)!.at_seconds).toBe(760);
  });

  it("normalises case, whitespace, curly quotes, apostrophes and punctuation — nothing more", () => {
    expect(normaliseForMatch("  “We’ll  CUT—waiting lists,” she said. ").text).toBe("well cut waiting lists she said");
    expect(normaliseForMatch("Café £2 cap").text).toBe("cafe £2 cap");
    // whole words only: "ill" must not match inside "will"
    expect(matchQuote("ill build homes", { source: "page", text: "We will build homes" }, null)).toBeNull();
  });

  it("matches against the visible text of a page, not its scripts", () => {
    const html = `<html><head><title>x</title><script>var q = "we will abolish the tax";</script></head>
      <body><nav>Home | News</nav><article><h1>Speech</h1><p>The Chancellor said: &ldquo;We will cut fuel duty by 5p&rdquo;.</p>
      <p>Officials&nbsp;confirmed it.</p><!-- we will abolish the tax --></article><style>p{}</style></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("“We will cut fuel duty by 5p”");
    expect(text).not.toContain("abolish");
    expect(text).not.toContain("Home | News");
    const m = matchQuote("we will cut fuel duty by 5p", { source: "page", text }, null);
    expect(m).toMatchObject({ source: "page", text: "We will cut fuel duty by 5p" });
    expect(m!.at_seconds).toBeUndefined();
    expect(matchQuote("we will abolish the tax", { source: "page", text }, null)).toBeNull();
  });

  it("strips an unclosed script without hanging", () => {
    const start = Date.now();
    expect(htmlToText("<p>Hello</p>" + "<script>".repeat(50_000))).toBe("Hello");
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("Internet Archive", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("reads the snapshot from Save Page Now's Content-Location", async () => {
    const f = fakeFetch({
      [`https://web.archive.org/save/${url}`]: new Response("", { status: 200, headers: { "content-location": `/web/20261006101500/${url}` } }),
    });
    expect(await archiveUrl(url, f)).toEqual({ archivedUrl: `https://web.archive.org/web/20261006101500/${url}`, method: "save" });
  });

  it("reads the snapshot from a redirect Location", async () => {
    const f = fakeFetch({
      [`https://web.archive.org/save/${url}`]: new Response(null, { status: 302, headers: { location: `https://web.archive.org/web/20261006101501/${url}` } }),
    });
    expect((await archiveUrl(url, f)).archivedUrl).toBe(`https://web.archive.org/web/20261006101501/${url}`);
  });

  it("falls back to the availability API", async () => {
    const f = fakeFetch({
      [`https://web.archive.org/save/${url}`]: new Response("Too many requests", { status: 429 }),
      "https://archive.org/wayback/available?url=*": json({
        archived_snapshots: { closest: { available: true, status: "200", url: `http://web.archive.org/web/20260901000000/${url}`, timestamp: "20260901000000" } },
      }),
    });
    expect(await archiveUrl(url, f)).toEqual({ archivedUrl: `https://web.archive.org/web/20260901000000/${url}`, method: "availability" });
    expect(f.calls[1]).toBe(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
  });

  it("records failure without throwing", async () => {
    const f = fakeFetch({
      [`https://web.archive.org/save/${url}`]: () => Promise.reject(new TypeError("fetch failed")),
      "https://archive.org/wayback/available?url=*": json({ archived_snapshots: {} }),
    });
    const r = await archiveUrl(url, f);
    expect(r.archivedUrl).toBeNull();
    expect(r.error).toBe("save: failed; availability: no snapshot");
  });
});
