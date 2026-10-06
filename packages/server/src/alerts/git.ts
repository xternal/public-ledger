import { execFileSync } from "node:child_process";
import { actorsFrom, type LooseActor } from "./content";

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

/** Promise files that differ between two commits (renames listed as delete + add). */
export function changedPromiseFiles(git: GitRunner, before: string, after: string): string[] {
  return lines(git(["diff", "--name-only", "--no-renames", before, after, "--", PROMISES_DIR])).filter(isYaml);
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
