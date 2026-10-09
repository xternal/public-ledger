import { AREA_SLUG, areaBySlug, areaTitle, statusCounts } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";
import { STATUS_LABEL } from "@/lib/copy";
import { AREA_LABEL } from "@/lib/promises";

export const alt = "Public Ledger: UK political promises in one policy area, with how many are on track";
export const size = OG.size;
export const contentType = "image/png";

export function generateStaticParams() {
  return [...new Set(getSeed().cards.map((c) => c.file.policy_area))].map((a) => ({ area: AREA_SLUG[a] }));
}

export default async function Image({ params }: { params: Promise<{ area: string }> }) {
  const area = areaBySlug((await params).area)!;
  const cards = getSeed().cards.filter((c) => c.file.policy_area === area);
  const top = statusCounts(cards)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  return figuresImage({
    kicker: AREA_LABEL[area],
    title: areaTitle(area),
    figures: [
      { value: String(cards.length), label: cards.length === 1 ? "promise tracked" : "promises tracked" },
      ...top.map((x) => ({ value: String(x.count), label: STATUS_LABEL[x.status].toLowerCase() })),
    ],
    foot: "Every promise word for word · one standard for every party",
  });
}
