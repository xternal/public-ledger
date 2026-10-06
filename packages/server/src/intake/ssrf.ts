import { isIP } from "node:net";

/**
 * Fetching links that readers send us, without letting a link reach our own
 * network (server-side request forgery). Every hop is checked before it is
 * requested: http(s) only, ports 80/443 only, no credentials, and every address
 * the host resolves to must be public (no private, loopback, link-local, CGNAT,
 * multicast, documentation or cloud-metadata ranges, IPv4 or IPv6). Redirects
 * are followed by hand (at most 3), the whole fetch has a 10 s budget and the
 * body is cut at 2 MB.
 *
 * Known limit: the address is checked, then fetch() resolves the name again,
 * so a host that changes its DNS answer between the two (DNS rebinding) could
 * slip through. We only GET, never send credentials, and nothing fetched is
 * shown to the submitter; the result goes to editors only.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** Resolve a host name to all its addresses. */
export type Lookup = (host: string) => Promise<string[]>;

export class BlockedUrlError extends Error {
  constructor(readonly reason: string) {
    super(`blocked: ${reason}`);
    this.name = "BlockedUrlError";
  }
}

export async function systemLookup(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

// ---------------------------------------------------------------- addresses

function ipv4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT (also Alibaba's metadata address)
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. 169.254.169.254 cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. broadcast
];

function inPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < prefix.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i]! & mask) !== (prefix[i]! & mask)) return false;
  }
  return true;
}

function isPublicV4(bytes: number[]): boolean {
  return !V4_BLOCKED.some(([p, bits]) => inPrefix(bytes, p, bits));
}

/** Parse an IPv6 address (with optional embedded IPv4 and zone) into 16 bytes. */
function ipv6Bytes(raw: string): number[] | null {
  let ip = raw.replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  let v4: number[] | null = null;
  const lastColon = ip.lastIndexOf(":");
  if (ip.slice(lastColon + 1).includes(".")) {
    v4 = ipv4Bytes(ip.slice(lastColon + 1));
    if (!v4) return null;
    ip = `${ip.slice(0, lastColon + 1)}0:0`; // two placeholder groups, overwritten below
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string) => (s ? s.split(":") : []);
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
  if (v4) bytes.splice(12, 4, ...v4);
  return bytes;
}

function isPublicV6(b: number[]): boolean {
  const zeroes = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // ::/80 prefix: unspecified, loopback, IPv4-compatible, IPv4-mapped (::ffff:a.b.c.d)
  if (zeroes(0, 10)) {
    if (b[10] === 0xff && b[11] === 0xff) return isPublicV4(b.slice(12));
    return false;
  }
  // 64:ff9b::/96 NAT64 carries an IPv4 address; check that address. 64:ff9b:1::/48 is local-use.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return zeroes(4, 12) ? isPublicV4(b.slice(12)) : false;
  }
  // 2002::/16 6to4 carries an IPv4 address in bits 16–48.
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicV4(b.slice(2, 6));
  // Only global unicast (2000::/3) is public; that excludes fc00::/7 (ULA, incl. fd00:ec2::254
  // metadata), fe80::/10 (link-local), fec0::/10, ff00::/8 (multicast), 100::/64 (discard).
  if ((b[0]! & 0xe0) !== 0x20) return false;
  // Inside 2000::/3: 2001::/23 IETF assignments (Teredo, benchmarking…), 2001:db8::/32 and
  // 3fff::/20 documentation.
  if (b[0] === 0x20 && b[1] === 0x01 && b[2]! <= 0x01) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;
  if (b[0] === 0x3f && b[1] === 0xff && (b[2]! & 0xf0) === 0x00) return false;
  return true;
}

/** True only for an address on the public internet. Anything unparseable counts as not public. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]!);
  if (kind === 4) {
    const b = ipv4Bytes(ip);
    return !!b && isPublicV4(b);
  }
  if (kind === 6) {
    const b = ipv6Bytes(ip);
    return !!b && isPublicV6(b);
  }
  return false;
}

// ---------------------------------------------------------------- urls

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

/** Throws BlockedUrlError unless the URL is safe to request. Returns the resolved addresses. */
export async function assertPublicUrl(url: URL, lookup: Lookup): Promise<string[]> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("scheme");
  if (url.username || url.password) throw new BlockedUrlError("credentials");
  if (url.port && url.port !== "80" && url.port !== "443") throw new BlockedUrlError("port");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new BlockedUrlError("host");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError("private_address");
    return [host];
  }
  if (host === "localhost" || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new BlockedUrlError("private_host");
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new BlockedUrlError("dns");
  }
  if (!addresses.length) throw new BlockedUrlError("dns");
  if (!addresses.every(isPublicAddress)) throw new BlockedUrlError("private_address");
  return addresses;
}

// ---------------------------------------------------------------- fetch

export interface SafeFetchOptions {
  fetch?: Fetch;
  lookup?: Lookup;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeResponse {
  status: number;
  /** URL of the last hop, after redirects. */
  finalUrl: string;
  contentType: string;
  body: string;
  /** True when the body was cut at maxBytes. */
  truncated: boolean;
}

export const FETCH_LIMITS = { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3 };

async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      void reader.cancel().catch(() => undefined); // do not wait: cancelling can wait on the network
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes, truncated };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** GET a reader-supplied URL with the guard applied on every hop. Throws BlockedUrlError or a network error. */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const doFetch = opts.fetch ?? fetch;
  const lookup = opts.lookup ?? systemLookup;
  const maxRedirects = opts.maxRedirects ?? FETCH_LIMITS.maxRedirects;
  const maxBytes = opts.maxBytes ?? FETCH_LIMITS.maxBytes;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? FETCH_LIMITS.timeoutMs);
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current, lookup);
    const res = await doFetch(current.href, { method: "GET", redirect: "manual", signal, headers: opts.headers });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      void res.body?.cancel().catch(() => undefined);
      if (hop >= maxRedirects) throw new BlockedUrlError("too_many_redirects");
      current = new URL(location, current);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const { bytes, truncated } = await readCapped(res, maxBytes);
    return { status: res.status, finalUrl: current.href, contentType, body: decode(bytes, contentType), truncated };
  }
}
