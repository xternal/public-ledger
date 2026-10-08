import type { MetadataRoute } from "next";
import { absolute } from "@/lib/site";

/** Search engines and AI crawlers are welcome on public pages and the open data API; forms, tokens and admin are not for indexing. */
const PRIVATE = ["/api/", "/admin", "/follow/", "/submission/"];
const OPEN = ["/", "/api/v1/"];
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: OPEN, disallow: PRIVATE }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: OPEN, disallow: PRIVATE }))],
    sitemap: absolute("/sitemap.xml"),
  };
}
