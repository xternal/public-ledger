import type { ActorFile } from "@ledger/schema";
import type { HarvestReport, SourceDoc } from "./types";

/** The one SDK method extraction uses, so tests can pass a stand-in client. */
export interface ExtractClient {
  beta: { messages: { create(body: unknown, options?: { timeout?: number; maxRetries?: number }): PromiseLike<unknown> } };
}

export interface ExtractOptions {
  /** null = no API key: nothing is extracted and the report says so. */
  client: ExtractClient | null;
  model?: string;
  actors: ActorFile[];
  /** Quotes already on cards or in drafts, to skip duplicates. */
  known: string[];
}

/** Claude proposes candidate promises per source; only verbatim quotes with exact spans survive. */
export async function extractFromSources(_docs: SourceDoc[], _opts: ExtractOptions): Promise<Pick<HarvestReport, "candidates" | "dropped" | "errors">> {
  throw new Error("extractFromSources: not built yet (M4 extract)");
}
