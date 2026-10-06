import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

/**
 * Read content/*.yaml from disk. Node only (server components, tests, scripts);
 * the browser receives parsed cards as props.
 */

export function repoRoot(start = process.cwd()): string {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`no pnpm-workspace.yaml above ${start}`);
    dir = up;
  }
  return dir;
}

export interface RawContentFile {
  path: string;
  data: unknown;
}

export function readYamlDir(dir: string): RawContentFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      return { path, data: parse(readFileSync(path, "utf8")) };
    });
}

export interface RawContent {
  promises: RawContentFile[];
  actors: RawContentFile[];
}

export function readContent(root = repoRoot()): RawContent {
  return {
    promises: readYamlDir(join(root, "content", "promises")),
    actors: readYamlDir(join(root, "content", "actors")),
  };
}
