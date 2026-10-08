import { constituencyBySlug } from "@ledger/server/mp";
import { OG } from "@/lib/og";
import { mpShareImage } from "@/lib/mp-og";

export const alt = "Public Ledger: the MP for a constituency, with their promises and votes";
export const size = OG.size;
export const contentType = "image/png";

/** Made on first request and then cached, like the page. */
export function generateStaticParams() {
  return [];
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = constituencyBySlug(slug);
  return mpShareImage("Your MP in", c?.name ?? "the UK");
}
