/**
 * Draft pull requests through the GitHub REST API: branch from main, write one
 * file, open a draft PR. A fine-grained token for this repository only, with
 * Contents and Pull requests read/write (docs/OPERATIONS.md §6). Safe to retry:
 * an existing branch, file or open PR is reused.
 */

export interface GitHubOptions {
  token: string;
  /** owner/name */
  repo: string;
  base?: string;
  fetch?: typeof fetch;
}

export interface DraftPrRequest {
  branch: string;
  path: string;
  /** Returns the new file content given the current one on the branch (null if absent); null means "no change". */
  content: (current: string | null) => string | null;
  message: string;
  title: string;
  body: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = "https://api.github.com";
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function gh<T>(opts: GitHubOptions, method: string, path: string, body?: unknown): Promise<T> {
  const res = await (opts.fetch ?? fetch)(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${opts.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "public-ledger-triage",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GitHubError(`GitHub ${method} ${path.split("?")[0]} failed: ${res.status}`, res.status);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** A file's text and blob sha on a ref, or null if it does not exist there. */
export async function readRepoFile(opts: GitHubOptions, path: string, ref: string): Promise<{ text: string; sha: string } | null> {
  try {
    const f = await gh<{ content?: string; encoding?: string; sha: string }>(opts, "GET", `/repos/${opts.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    if (typeof f.content !== "string") return null;
    return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export async function openDraftPr(opts: GitHubOptions, req: DraftPrRequest): Promise<{ url: string; number: number }> {
  const base = opts.base ?? "main";
  const repo = opts.repo;
  const head = await gh<{ object: { sha: string } }>(opts, "GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  try {
    await gh(opts, "POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${req.branch}`, sha: head.object.sha });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e; // 422: the branch exists already (a retry)
  }
  const current = await readRepoFile(opts, req.path, req.branch);
  const next = req.content(current?.text ?? null);
  if (next !== null && next !== current?.text) {
    await gh(opts, "PUT", `/repos/${repo}/contents/${encPath(req.path)}`, {
      message: req.message,
      content: Buffer.from(next, "utf8").toString("base64"),
      branch: req.branch,
      ...(current ? { sha: current.sha } : {}),
    });
  }
  const owner = repo.split("/")[0]!;
  const open = await gh<{ html_url: string; number: number }[]>(
    opts,
    "GET",
    `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${req.branch}`)}&base=${encodeURIComponent(base)}`,
  );
  if (open[0]) return { url: open[0].html_url, number: open[0].number };
  const pr = await gh<{ html_url: string; number: number }>(opts, "POST", `/repos/${repo}/pulls`, {
    title: req.title,
    head: req.branch,
    base,
    body: req.body,
    draft: true,
  });
  return { url: pr.html_url, number: pr.number };
}
