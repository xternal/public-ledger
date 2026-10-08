import { execFileSync } from "node:child_process";
import { actorsFrom, parseCard, type LooseActor } from "./content";
import type { DataSide } from "./data";

/**
 * Read content at a commit with read-only git (`rev-parse`, `diff --name-only`,
 * `ls-tree`, `show`). The runner is injectable so tests use fixtures, not a repo.
 */
export type GitRunner = (args: string[]) => string;

export function gitRunner(cwd: string): GitRunner {
  return (args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export const PROMISES_DIR = "content/promises";
export const ACTORS_DIR = "content/actors";
export const CONTRACTS_DIR = "data/build/contracts";
export const STATEMENTS_DIR = "data/build/statements";

const isYaml = (p: string) => /\.ya?ml$/.test(p);
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** The full sha of a commit, or null if it does not exist here (e.g. GitHub's all-zero `before` on a new branch). */
export function resolveCommit(git: GitRunner, ref: string | null | undefined): string | null {
  if (!ref || /^0+$/.test(ref)) return null;
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

/** Files under a directory that differ between two commits (renames listed as delete + add). */
function changedFiles(git: GitRunner, before: string, after: string, dir: string): string[] {
  return lines(git(["diff", "--name-only", "--no-renames", before, after, "--", dir]));
}

/** Promise files that differ between two commits (renames listed as delete + add). */
export function changedPromiseFiles(git: GitRunner, before: string, after: string): string[] {
  return changedFiles(git, before, after, PROMISES_DIR).filter(isYaml);
}

/** Whether `ancestor` is `descendant` or comes before it in its history (read-only `merge-base --is-ancestor`). */
export function isAncestor(git: GitRunner, ancestor: string, descendant: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false; // exit status 1: not an ancestor
  }
}

/** path → YAML text at a commit; paths missing at that commit are left out. */
export function filesAt(git: GitRunner, sha: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of paths) {
    try {
      out.set(path, git(["show", `${sha}:${path}`]));
    } catch {
      // not present at this commit (added or deleted in the range)
    }
  }
  return out;
}

export function dirAt(git: GitRunner, sha: string, dir: string): Map<string, string> {
  const paths = lines(git(["ls-tree", "-r", "--name-only", sha, "--", dir])).filter(isYaml);
  return filesAt(git, sha, paths);
}

export interface Snapshots {
  before: Map<string, string>;
  after: Map<string, string>;
  actors: Map<string, LooseActor>;
  /** The resolved commits; `before` falls back to the parent of `after`. */
  range: { before: string | null; after: string };
}

/**
 * The changed promise files on both sides of a push, plus every actor at
 * `after` (names, and which party a person belongs to). When `before` is
 * unknown (first push, force push) the parent of `after` is used; with no
 * parent at all nothing counts as changed, so a fresh repository sends no alerts.
 */
export function snapshotsFor(git: GitRunner, beforeRef: string | null | undefined, afterRef: string): Snapshots {
  const after = resolveCommit(git, afterRef);
  if (!after) throw new Error(`Unknown commit: ${afterRef}`);
  const before = resolveCommit(git, beforeRef) ?? resolveCommit(git, `${after}^`);
  const actors = actorsFrom(dirAt(git, after, ACTORS_DIR));
  if (!before) return { before: new Map(), after: new Map(), actors, range: { before: null, after } };
  const paths = changedPromiseFiles(git, before, after);
  return { before: filesAt(git, before, paths), after: filesAt(git, after, paths), actors, range: { before, after } };
}

export interface DataSnapshots {
  before: DataSide;
  after: DataSide;
  actors: Map<string, LooseActor>;
  range: { before: string; after: string };
}

const jsonKey = (path: string, dir: string) => (path.startsWith(`${dir}/`) && path.endsWith(".json") ? path.slice(dir.length + 1, -5) : null);

/**
 * What the data diff needs between two commits, read with the same read-only
 * git: every card at `after` (which contracts each links, and its status), the
 * changed cards at `before`, the contract files that changed or that a changed
 * card links, and the changed Statement years. Unchanged files are not read twice.
 */
export function dataSnapshotsFor(git: GitRunner, before: string, after: string): DataSnapshots {
  const actors = actorsFrom(dirAt(git, after, ACTORS_DIR));
  const changedPromises = changedPromiseFiles(git, before, after);
  const contractPaths = changedFiles(git, before, after, CONTRACTS_DIR).filter((p) => jsonKey(p, CONTRACTS_DIR));
  const statementPaths = changedFiles(git, before, after, STATEMENTS_DIR).filter((p) => /\/\d{4}-\d{2}\.json$/.test(p));
  const empty = (): DataSide => ({ promises: new Map(), contracts: new Map(), statements: new Map() });
  if (!changedPromises.length && !contractPaths.length && !statementPaths.length) return { before: empty(), after: empty(), actors, range: { before, after } };

  const promisesAfter = dirAt(git, after, PROMISES_DIR);
  const promisesBefore = new Map(promisesAfter);
  for (const p of changedPromises) promisesBefore.delete(p);
  for (const [p, text] of filesAt(git, before, changedPromises)) promisesBefore.set(p, text);

  // A changed card may link a contract that did not change: read it too, to tell "newly shown" from "changed".
  const linked = changedPromises.flatMap((p) => parseCard(promisesAfter.get(p) ?? "")?.contracts ?? []);
  const keys = [...new Set([...contractPaths.map((p) => jsonKey(p, CONTRACTS_DIR)!), ...linked])].filter((k) => /^[A-Za-z0-9._-]+$/.test(k));
  const contractFiles = keys.map((k) => `${CONTRACTS_DIR}/${k}.json`);
  const byKey = (files: Map<string, string>) => new Map([...files].map(([p, text]) => [jsonKey(p, CONTRACTS_DIR)!, text]));
  const byYear = (files: Map<string, string>) => new Map([...files].map(([p, text]) => [p.slice(STATEMENTS_DIR.length + 1, -5), text]));

  return {
    before: { promises: promisesBefore, contracts: byKey(filesAt(git, before, contractFiles)), statements: byYear(filesAt(git, before, statementPaths)) },
    after: { promises: promisesAfter, contracts: byKey(filesAt(git, after, contractFiles)), statements: byYear(filesAt(git, after, statementPaths)) },
    actors,
    range: { before, after },
  };
}
