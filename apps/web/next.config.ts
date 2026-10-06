import path from "node:path";
import type { NextConfig } from "next";

const root = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  // Workspace packages ship TypeScript source; seed JSON lives at the repo root.
  transpilePackages: ["@ledger/engine", "@ledger/schema", "@ledger/server"],
  // Node-only server dependencies (database, mail, Claude API) load at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "@aws-sdk/client-sesv2", "@anthropic-ai/sdk"],
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};

export default config;
