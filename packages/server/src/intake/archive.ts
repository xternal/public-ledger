import type { Fetch } from "./ssrf";

/**
 * A copy of the source in the Internet Archive, so a card's evidence survives
 * the page being edited or deleted. Anonymous Save Page Now first; if that does
 * not give us a snapshot address, the most recent existing snapshot from the
 * availability API. The hosts are fixed, so these requests need no SSRF guard.
 */

export interface ArchiveResult {
  archivedUrl: string | null;
  method: "save" | "availability" | null;
  error?: string;
}

const WAYBACK = "https://web.archive.org";

function snapshotUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value, WAYBACK);
    if (u.hostname !== "web.archive.org" || !u.pathname.startsWith("/web/")) return null;
    u.protocol = "https:";
    return u.href;
  } catch {
    return null;
  }
}

export async function archiveUrl(url: string, fetchImpl: Fetch = fetch, opts: { userAgent?: string; saveTimeoutMs?: number } = {}): Promise<ArchiveResult> {
  const headers = opts.userAgent ? { "user-agent": opts.userAgent } : undefined;
  const errors: string[] = [];
  try {
    const res = await fetchImpl(`${WAYBACK}/save/${url}`, {
      method: "GET",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(opts.saveTimeoutMs ?? 45_000),
    });
    void res.body?.cancel().catch(() => undefined); // do not wait: cancelling can wait on the network
    const found = snapshotUrl(res.headers.get("content-location")) ?? (res.status >= 300 && res.status < 400 ? snapshotUrl(res.headers.get("location")) : null);
    if (found) return { archivedUrl: found, method: "save" };
    errors.push(`save: HTTP ${res.status}`);
  } catch (e) {
    errors.push(`save: ${(e as Error).name === "TimeoutError" ? "timed out" : "failed"}`);
  }
  try {
    const res = await fetchImpl(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } };
      const closest = json.archived_snapshots?.closest;
      const found = closest?.available ? snapshotUrl(closest.url ?? null) : null;
      if (found) return { archivedUrl: found, method: "availability" };
      errors.push("availability: no snapshot");
    } else errors.push(`availability: HTTP ${res.status}`);
  } catch (e) {
    errors.push(`availability: ${(e as Error).name === "TimeoutError" ? "timed out" : "failed"}`);
  }
  return { archivedUrl: null, method: null, error: errors.join("; ") };
}
