import type { MetadataRoute } from "next";
import { absolute } from "@/lib/site";

/**
 * Search engines and AI crawlers are welcome on public pages, the open data
 * API and the Markdown copies of cards; forms, tokens, admin and the alpha
 * sign-in are not for indexing. /md/ is the internal path behind
 * /promise/<id>.md, kept out so a card is not crawled twice.
 */
const PRIVATE = ["/api/", "/admin", "/follow/", "/submission/", "/alpha", "/md/"];
const OPEN = ["/", "/api/v1/"];
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: OPEN, disallow: PRIVATE }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: OPEN, disallow: PRIVATE }))],
    sitemap: absolute("/sitemap.xml"),
  };
}
