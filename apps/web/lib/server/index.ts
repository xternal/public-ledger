import "server-only";
import { getDb, loadConfig, mailerFor, type Config, type Db, type Mailer } from "@ledger/server";

/**
 * One place where route handlers get the server: configuration, the database
 * (Neon in production, PGlite locally) and the mailer (SES in production, the
 * outbox table locally). Route handlers using it must set `runtime = "nodejs"`.
 */
export interface Server {
  config: Config;
  db: Db;
  mail: Mailer;
}

let server: Promise<Server> | null = null;

export function getServer(): Promise<Server> {
  server ??= (async () => {
    const config = loadConfig();
    const db = await getDb(config);
    return { config, db, mail: mailerFor(config, db) };
  })().catch((e) => {
    server = null; // try again on the next request rather than caching the failure
    throw e;
  });
  return server;
}
