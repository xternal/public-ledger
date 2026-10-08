import { cardMarkdownFile, MARKDOWN_CONTENT_TYPE } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { absolute, seoContext } from "@/lib/site";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getSeed().cards.map((c) => ({ file: `${c.id}.md` }));
}

/**
 * One promise card as Markdown, for AI assistants: served at
 * /promise/<id>.md (a rewrite in next.config.ts) and advertised by the card
 * page's <link rel="alternate" type="text/markdown">. The canonical link
 * points search engines at the web page, so the two are never indexed twice.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = file.endsWith(".md") ? file.slice(0, -3) : "";
  const card = getSeed().cards.find((c) => c.id === id);
  if (!card) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(cardMarkdownFile(card, seoContext()), {
    headers: { "content-type": MARKDOWN_CONTENT_TYPE, link: `<${absolute(`/promise/${id}`)}>; rel="canonical"` },
  });
}
