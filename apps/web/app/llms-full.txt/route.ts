import { llmsFull } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { SITE_DESCRIPTION, seoContext } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Every promise card in full, as Markdown, for AI assistants (the
 * llms-full.txt convention next to /llms.txt): the method in short, the
 * licences, then each card with its quote, facts, timeline and evidence,
 * contracts, corrections and sources.
 */
export function GET() {
  return new Response(llmsFull(getSeed().cards, seoContext(), { description: SITE_DESCRIPTION }), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
