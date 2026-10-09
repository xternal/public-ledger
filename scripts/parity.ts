/**
 * pnpm parity:snapshot and pnpm parity:check: proof that a change leaves what
 * the site serves exactly as it was. Written for the move to the OpenPromises
 * engine, usable for any refactor (docs/OPERATIONS.md §14).
 *
 * Both build the site for production and start it on a free local port, then
 * fetch, byte for byte: every /api/v1 endpoint as JSON and CSV, every feed
 * (all, updates, deadlines, and one per area, actor and promise),
 * sitemap.xml, robots.txt, llms.txt, llms-full.txt and every card's .md. For
 * every page in the sitemap, every actor page and each route type by name,
 * they keep the tags search engines and share previews read: title,
 * description, canonical, robots, alternates, Open Graph, Twitter and JSON-LD.
 *
 * snapshot writes .parity/baseline. check writes .parity/current, compares
 * every file with the baseline, prints a diff grouped by file and exits 1 on
 * any difference. Both builds use the same settings: SITE_URL is the
 * production address, the alpha gate is off, and the clock is pinned to the
 * moment the baseline was taken (scripts/parity-clock.cjs), so a check run
 * days later compares like with like. Only what must vary between builds is
 * normalised: the API's data_build stamp, and the time an MP page read
 * Parliament's data.
 *
 *   pnpm parity:snapshot     on the commit to compare against (e.g. main)
 *   pnpm parity:check        on the change
 *
 * Options: --no-build uses apps/web/.next as it is (built with other settings,
 * it will differ); --concurrency N (default 8).
 */
import { spawn, spawnSync, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps", "web");
const next = join(web, "node_modules", ".bin", "next");
const PARITY = join(root, ".parity");
/** The production address, so absolute URLs read as they do on the live site. */
const SITE_URL = "https://ledgergov.uk";
/** A share crawler, so the page metadata is in the HTML as previews see it (Next streams it later for browsers). */
const USER_AGENT = "LinkedInBot/1.0 (compatible; Public Ledger parity check)";
/** Each route type named in the migration plan; the sitemap adds every card, area, actor, topic and MP page. */
const ROUTE_TYPES = ["/", "/promises", "/budget", "/method", "/method/api", "/method/backtest", "/people", "/editors", "/feeds", "/mp", "/privacy"];
const ROUTE_PATTERNS: [string, RegExp][] = [
  ["home", /^\/$/],
  ["promises", /^\/promises$/],
  ["area", /^\/promises\/area\/[^/]+$/],
  ["actor", /^\/actor\/[^/]+$/],
  ["card", /^\/promise\/[^/]+$/],
  ["budget", /^\/budget$/],
  ["budget topic", /^\/budget\/[^/]+$/],
  ["MP", /^\/mp\/[^/]+$/],
  ["method", /^\/method$/],
  ["people", /^\/people$/],
  ["editors", /^\/editors$/],
];
/**
 * MP pages kept, in alphabetical order. Each asks UK Parliament's API when it
 * is first served, so all 650 would send thousands of requests to Parliament
 * every run; the page code is the same for every constituency.
 */
const MP_SAMPLE = 3;
/** Shown in full for this many changed files; the rest are listed by name (the report file has them all). */
const SHOW_FILES = 25;
const SHOW_LINES = 80;

interface Entry {
  url: string;
  status: number;
  type: string;
  location?: string;
}
interface Manifest {
  format: 1;
  commit: string;
  dirty: boolean;
  site_url: string;
  /** The moment the clock was pinned to; a check reuses its baseline's. */
  pinned_now: string;
  taken_at: string;
  seconds: { build: number | null; fetch: number };
  /** By file, relative to the snapshot folder: served/… for whole responses, head/… for a page's metadata. */
  entries: Record<string, Entry>;
}

// ------------------------------------------------------------------ small helpers

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const rel = (p: string) => relative(root, p);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const duration = (s: number) => (s < 90 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`);
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const ukTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

function git(...a: string[]): string {
  return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * "/api/v1/promises" → "served/api__v1__promises.json"; a page's metadata →
 * "head/promise__uk-bus-cap-2-2026.txt". Named from the address alone, so a
 * file keeps its name whatever the response.
 */
function fileFor(kind: "served" | "head", path: string): string {
  const flat = path === "/" ? "index" : path.slice(1).replaceAll("/", "__");
  if (kind === "head") return `head/${flat}.txt`;
  const last = path.split("/").at(-1) ?? "";
  return `served/${flat}${path.startsWith("/api/") && !last.includes(".") ? ".json" : ""}`;
}

/**
 * Only what must vary between two builds of the same content: the API's data
 * build stamp, and on MP pages the moment Parliament's data was read (their
 * structured data's dateModified). Everything else must match byte for byte.
 */
function normalise(path: string, text: string): string {
  const out = text.replace(/"data_build":\s*"[^"]*"/g, '"data_build":"(normalised)"');
  return /^\/mp\/[^/]+$/.test(path) ? out.replace(/"dateModified":\s*"[^"]*"/g, '"dateModified":"(normalised)"') : out;
}

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((m) => [m[1]!.toLowerCase(), m[2]!]));

/** The tags search engines and share previews read, in document order, values exactly as served. */
function headOf(html: string): string {
  const lines = [`title: ${/<title[^>]*>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "(none)"}`];
  for (const m of html.matchAll(/<(meta|link)\b([^>]*)>/g)) {
    const a = attrs(m[2]!);
    if (m[1] === "meta") {
      const key = a.name ?? a.property;
      if (key && (key === "description" || key === "robots" || key.startsWith("og:") || key.startsWith("twitter:"))) lines.push(`meta ${key}: ${a.content ?? ""}`);
    } else if (a.rel === "canonical" || a.rel === "alternate") {
      lines.push(`link ${a.rel}${a.type ? ` ${a.type}` : ""}${a.hreflang ? ` ${a.hreflang}` : ""}: ${a.href ?? ""}${a.title ? ` "${a.title}"` : ""}`);
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) lines.push(`json-ld: ${m[1]}`);
  return `${lines.join("\n")}\n`;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

// ------------------------------------------------------------------ build and serve

function parityEnv(now: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SITE_URL,
    // The public site: no alpha label or password gate, whatever the local environment says.
    SITE_STAGE: "",
    ALPHA_PASSWORD: "",
    PARITY_NOW: now,
    NEXT_TELEMETRY_DISABLED: "1",
    // Only the clock pin: nothing inherited (tsx's own loader included) reaches the build.
    NODE_OPTIONS: `--require ${JSON.stringify(join(root, "scripts", "parity-clock.cjs"))}`,
  };
}

function build(now: string, dir: string): number {
  console.log("Building the site for production (a few minutes)…");
  const start = Date.now();
  const log = join(dir, "build.log");
  const fd = openSync(log, "w");
  const r = spawnSync(next, ["build"], { cwd: web, env: parityEnv(now), stdio: ["ignore", fd, fd] });
  if (r.status !== 0) {
    console.error(readFileSync(log, "utf8").split("\n").slice(-30).join("\n"));
    throw new Error(`next build failed; the full log is in ${rel(log)}`);
  }
  return (Date.now() - start) / 1000;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let server: ChildProcess | null = null;
const stopServer = () => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  server = null;
};
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });

async function serve(now: string, dir: string): Promise<string> {
  const port = await freePort();
  const log = join(dir, "server.log");
  server = spawn(next, ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: parityEnv(now), stdio: ["ignore", openSync(log, "w"), openSync(log, "a")] });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (!server || server.exitCode !== null) throw new Error(`next start stopped; see ${rel(log)}`);
    try {
      if ((await fetch(`${origin}/robots.txt`)).ok) return origin;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`next start did not answer within a minute; see ${rel(log)}`);
    await sleep(250);
  }
}

// ------------------------------------------------------------------ fetch

interface Got extends Entry {
  body: string;
}

async function get(origin: string, path: string): Promise<Got> {
  const r = await fetch(origin + path, { redirect: "manual", headers: { "user-agent": USER_AGENT } });
  const location = r.headers.get("location");
  return { url: path, status: r.status, type: r.headers.get("content-type") ?? "", ...(location ? { location } : {}), body: await r.text() };
}

/** What to fetch, found from the site itself: the API index and lists, the feeds page and the sitemap. */
async function discover(origin: string): Promise<{ served: string[]; pages: string[] }> {
  const json = async (p: string) => {
    const r = await get(origin, p);
    if (r.status !== 200) throw new Error(`${p} answered ${r.status}`);
    return JSON.parse(r.body);
  };
  const index = (await json("/api/v1")).data as { endpoints: { path: string; url: string; formats: string[] }[]; years: string[] };
  const promises = (await json("/api/v1/promises")).data.promises as { id: string }[];
  const actors = (await json("/api/v1/actors")).data.actors as { id: string }[];

  const served = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/api/v1"]);
  for (const e of index.endpoints) {
    const paths = e.path.includes("{id}")
      ? promises.map((p) => e.path.replace("{id}", p.id))
      : e.path.includes("{year}")
        ? index.years.map((y) => e.path.replace("{year}", y))
        : e.path.includes("{")
          ? [new URL(e.url).pathname] // a parameter this script does not know yet: at least its example
          : [e.path];
    for (const p of paths) {
      served.add(p);
      if (e.formats.includes("csv")) served.add(`${p}.csv`);
    }
  }
  // Every feed the feeds page links to, and in any case one per card and actor; every card as Markdown.
  for (const m of (await get(origin, "/feeds")).body.matchAll(/href="(\/feeds\/[^"#?]+\.xml)"/g)) served.add(m[1]!);
  for (const p of promises) {
    served.add(`/feeds/promise/${p.id}.xml`);
    served.add(`/promise/${p.id}.md`);
  }
  for (const a of actors) served.add(`/feeds/actor/${a.id}.xml`);

  // Every page in the sitemap but a sample of MP pages, every actor page (an actor with no cards of its own is not in
  // the sitemap) and each route type.
  const pages = new Set(ROUTE_TYPES);
  const listed = [...(await get(origin, "/sitemap.xml")).body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!.replaceAll("&amp;", "&")).pathname).sort();
  const mp = /^\/mp\/[^/]+$/;
  for (const p of [...listed.filter((p) => !mp.test(p)), ...listed.filter((p) => mp.test(p)).slice(0, MP_SAMPLE)]) pages.add(p);
  for (const a of actors) pages.add(`/actor/${a.id}`);
  const all = [...pages];
  const missing = ROUTE_PATTERNS.filter(([, re]) => !all.some((p) => re.test(p))).map(([name]) => name);
  if (missing.length) console.warn(`warning: no page found for ${missing.join(", ")}`);
  return { served: [...served].sort(), pages: all.sort() };
}

async function take(dir: string, now: string, opts: { build: boolean; concurrency: number; also?: Manifest }): Promise<Manifest> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "served"), { recursive: true });
  mkdirSync(join(dir, "head"), { recursive: true });
  const buildSeconds = opts.build ? build(now, dir) : null;
  if (!opts.build) console.log("Using the existing build in apps/web/.next (--no-build).");
  const origin = await serve(now, dir);
  const start = Date.now();
  const found = await discover(origin);
  // A check also asks for everything the baseline had, so a page that has gone shows as gone.
  const served = new Set(found.served);
  const pages = new Set(found.pages);
  for (const e of Object.entries(opts.also?.entries ?? {})) (e[0].startsWith("head/") ? pages : served).add(e[1].url);
  console.log(`Fetching ${count(served.size, "file")} and the metadata of ${count(pages.size, "page")}…`);

  const entries: Record<string, Entry> = {};
  const save = (file: string, got: Got, text: string) => {
    writeFileSync(join(dir, file), text);
    const { body: _body, ...entry } = got;
    entries[file] = entry;
  };
  await pool([...served].sort(), opts.concurrency, async (path) => {
    const got = await get(origin, path);
    save(fileFor("served", path), got, normalise(path, got.body));
  });
  await pool([...pages].sort(), opts.concurrency, async (path) => {
    const got = await get(origin, path);
    save(fileFor("head", path), got, normalise(path, headOf(got.body)));
  });
  stopServer();

  const manifest: Manifest = {
    format: 1,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
    site_url: SITE_URL,
    pinned_now: now,
    taken_at: new Date().toISOString(),
    seconds: { build: buildSeconds, fetch: (Date.now() - start) / 1000 },
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ------------------------------------------------------------------ compare and report

type Op = { op: " " | "-" | "+"; line: string };

/**
 * Myers' line diff. Its memory grows with the number of edits, so past a
 * budget it gives up and shows the differing middle as removed and added.
 */
function diffLines(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const head: Op[] = a.slice(0, pre).map((line) => ({ op: " ", line }));
  const tail: Op[] = a.slice(a.length - suf).map((line) => ({ op: " ", line }));
  const n = A.length;
  const m = B.length;
  const off = n + m + 1;
  const maxD = Math.min(2000, Math.floor(25_000_000 / (2 * off + 1)));
  const v = new Int32Array(2 * off + 1);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(n + m, maxD) && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [...head, ...A.map((line) => ({ op: "-" as const, line })), ...B.map((line) => ({ op: "+" as const, line })), ...tail];
  const mid: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[off + k - 1]! < vd[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      mid.push({ op: " ", line: A[--x]! });
      y--;
    }
    if (x === prevX) mid.push({ op: "+", line: B[--y]! });
    else mid.push({ op: "-", line: A[--x]! });
  }
  while (x > 0 && y > 0) {
    mid.push({ op: " ", line: A[--x]! });
    y--;
  }
  return [...head, ...mid.reverse(), ...tail];
}

/** Readable lines: JSON pretty-printed, JSON-LD in page metadata too. The comparison itself is on the bytes. */
function displayLines(file: string, text: string): string[] {
  const pretty = (s: string) => {
    try {
      return JSON.stringify(JSON.parse(s), null, 2).split("\n");
    } catch {
      return null;
    }
  };
  if (file.endsWith(".json")) return pretty(text) ?? text.split("\n");
  if (file.startsWith("head/")) return text.split("\n").flatMap((l) => (l.startsWith("json-ld: ") ? (pretty(l.slice(9))?.map((p, i) => (i ? `  ${p}` : `json-ld: ${p}`)) ?? [l]) : [l]));
  return text.split("\n");
}

function hunks(ops: Op[], context = 3, limit = SHOW_LINES): string[] {
  const out: string[] = [];
  const changed = ops.map((o, i) => (o.op === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return ["  (the bytes differ, but the lines read the same: whitespace, key order or line endings)"];
  let i = 0;
  while (i < changed.length) {
    const start = Math.max(0, changed[i]! - context);
    let end = Math.min(ops.length, changed[i]! + context + 1);
    while (i + 1 < changed.length && changed[i + 1]! - context <= end) end = Math.min(ops.length, changed[++i]! + context + 1);
    i++;
    // The line number in the baseline's (pretty-printed) text.
    out.push(`  @@ line ${ops.slice(0, start).filter((o) => o.op !== "+").length + 1} @@`);
    for (const o of ops.slice(start, end)) out.push(`  ${o.op} ${o.line.length > 400 ? `${o.line.slice(0, 400)}…` : o.line}`);
  }
  return out.length > limit ? [...out.slice(0, limit), `  … ${count(out.length - limit, "more line")} of diff`] : out;
}

function check(baseDir: string, curDir: string, base: Manifest, cur: Manifest): { lines: string[]; differences: number } {
  const files = [...new Set([...Object.keys(base.entries), ...Object.keys(cur.entries)])].sort();
  const missing: string[] = [];
  const added: string[] = [];
  const changed: { file: string; why: string[] }[] = [];
  for (const file of files) {
    const b = base.entries[file];
    const c = cur.entries[file];
    if (!c) missing.push(file);
    else if (!b) added.push(file);
    else {
      const why: string[] = [];
      if (b.status !== c.status) why.push(`status ${b.status} → ${c.status}`);
      if (b.type !== c.type) why.push(`content type "${b.type}" → "${c.type}"`);
      if ((b.location ?? "") !== (c.location ?? "")) why.push(`redirect "${b.location ?? ""}" → "${c.location ?? ""}"`);
      if (!readFileSync(join(baseDir, file)).equals(readFileSync(join(curDir, file)))) why.push("content");
      if (why.length) changed.push({ file, why });
    }
  }
  const lines: string[] = [];
  const differences = missing.length + added.length + changed.length;
  lines.push(
    `Parity check: ${count(files.length, "file")}, ${cur.commit}${cur.dirty ? " (with uncommitted changes)" : ""} against the baseline from ${base.commit}${base.dirty ? " (with uncommitted changes)" : ""}`,
    `Both built as of ${ukTime(base.pinned_now)} for ${base.site_url}.`,
    "",
  );
  if (!differences) {
    lines.push(`✓ No differences: every file and every page's metadata is byte for byte the same.`);
    return { lines, differences };
  }
  lines.push(`✗ ${count(changed.length, "changed file")}, ${count(missing.length, "file")} gone, ${count(added.length, "new file")}.`, "");
  changed.forEach(({ file, why }, i) => {
    lines.push(`── ${file}  (${cur.entries[file]!.url})  ${why.join("; ")}`);
    if (i < SHOW_FILES && why.includes("content")) {
      const ops = diffLines(displayLines(file, readFileSync(join(baseDir, file), "utf8")), displayLines(file, readFileSync(join(curDir, file), "utf8")));
      lines.push(...hunks(ops));
    }
    lines.push("");
  });
  if (changed.length > SHOW_FILES) lines.push(`(Diffs shown for the first ${SHOW_FILES} changed files; the rest are listed above.)`, "");
  if (missing.length) lines.push("Gone: in the baseline, not served now", ...missing.map((f) => `  - ${f}  (${base.entries[f]!.url})`), "");
  if (added.length) lines.push("New: served now, not in the baseline", ...added.map((f) => `  + ${f}  (${cur.entries[f]!.url})`), "");
  return { lines, differences };
}

// ------------------------------------------------------------------ main

async function main() {
  const mode = args[0];
  const concurrency = Number(option("--concurrency", "8")) || 8;
  const build = !flag("--no-build");
  const baseDir = join(PARITY, "baseline");
  const started = Date.now();

  if (mode === "snapshot") {
    const m = await take(baseDir, new Date().toISOString(), { build, concurrency });
    console.log(
      `\nBaseline: ${count(Object.keys(m.entries).length, "file")} from ${m.commit}${m.dirty ? " (with uncommitted changes)" : ""} in ${rel(baseDir)}, built as of ${ukTime(m.pinned_now)}.`,
    );
    console.log(`Took ${duration((Date.now() - started) / 1000)}${m.seconds.build !== null ? ` (build ${duration(m.seconds.build)}, fetch ${duration(m.seconds.fetch)})` : ""}.`);
    return;
  }
  if (mode === "check") {
    const manifestPath = join(baseDir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error(`No baseline in ${rel(baseDir)}: run pnpm parity:snapshot on the commit to compare against first.`);
    const base = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const curDir = join(PARITY, "current");
    const cur = await take(curDir, base.pinned_now, { build, concurrency, also: base });
    const { lines, differences } = check(baseDir, curDir, base, cur);
    const report = join(PARITY, "report.txt");
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, `${lines.join("\n")}\n`);
    console.log(`\n${lines.join("\n")}`);
    console.log(`\nReport: ${rel(report)}. Took ${duration((Date.now() - started) / 1000)}${cur.seconds.build !== null ? ` (build ${duration(cur.seconds.build)}, fetch ${duration(cur.seconds.fetch)})` : ""}.`);
    process.exitCode = differences ? 1 : 0;
    return;
  }
  console.error("Usage: pnpm parity:snapshot | pnpm parity:check  [--no-build] [--concurrency N]");
  process.exitCode = 2;
}

main().catch((e: Error) => {
  stopServer();
  console.error(`parity: ${e.message}`);
  process.exitCode = 2;
});
