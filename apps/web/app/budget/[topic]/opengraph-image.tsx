import { ImageResponse } from "next/og";
import { getSeed } from "@/lib/data";
import { OG, ogFonts } from "@/lib/og";
import { MARK_DATA_URI } from "@/lib/brand";
import { STATUS_LABEL } from "@/lib/copy";
import { gbpBn, rangeText } from "@/lib/format";
import { costSense, ownerOf, shortName } from "@/lib/promises";
import { BUDGET, BUDGET_TOPICS, topicCards } from "@/lib/budget";

export const alt = "Public Ledger: what each party has promised on a Budget question, with what each would cost or raise";
export const size = OG.size;
export const contentType = "image/png";
export const revalidate = 3600;

/** Rows that fit under a two-line title; the rest are counted. */
const MAX_ROWS = 6;
const MAX_HEADLINE_CHARS = 46;

export function generateStaticParams() {
  return BUDGET_TOPICS.filter((t) => topicCards(getSeed().cards, t).length > 0).map((t) => ({ topic: t.id }));
}

export default async function Image({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: id } = await params;
  const topic = BUDGET_TOPICS.find((t) => t.id === id)!;
  const cards = topicCards(getSeed().cards, topic);
  const rows = cards.slice(0, MAX_ROWS);
  const fonts = await ogFonts();
  const clip = (s: string) => (s.length > MAX_HEADLINE_CHARS ? `${s.slice(0, MAX_HEADLINE_CHARS - 1).trimEnd()}…` : s);
  const cost = (r: (typeof cards)[number]) => {
    const range = r.current.parameters?.how_much_bn_per_year;
    if (!range) return { text: r.current.parameters === null ? "Not costable" : "Cost not stated", color: OG.muted };
    const { raises, abs } = costSense(range);
    return { text: `${raises ? "Raises" : "Costs"} ${rangeText(abs, gbpBn)}`, color: raises ? OG.rec : OG.debt };
  };
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "44px 60px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 600 }}>
        <img src={MARK_DATA_URI} width={24} height={24} alt="" />
        {`Public Ledger · ${BUDGET.name}`}
      </div>
      <div style={{ display: "flex", fontSize: 48, fontWeight: 600, letterSpacing: -1.6, lineHeight: 1.05, marginTop: 18, maxWidth: 1060 }}>{topic.heading}</div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 22, borderTop: `2px solid ${OG.line}` }}>
        {rows.map((c) => {
          const k = cost(c);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 20, padding: "9px 0", borderBottom: `1px solid ${OG.line}` }}>
              <div style={{ display: "flex", width: 170, fontSize: 22, fontWeight: 600 }}>{shortName(ownerOf(c))}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 22 }}>{clip(c.file.headline ?? c.current.text)}</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 300 }}>
                <div style={{ display: "flex", fontSize: 21, fontWeight: 600, color: k.color }}>{k.text}</div>
                <div style={{ display: "flex", fontSize: 16, color: OG.muted }}>{STATUS_LABEL[c.file.status]}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 19, color: OG.muted }}>
        <div style={{ display: "flex" }}>Every quote word for word · every cost a year, with its source</div>
        <div style={{ display: "flex" }}>{cards.length > MAX_ROWS ? `and ${cards.length - MAX_ROWS} more on the page` : ""}</div>
      </div>
    </div>,
    { ...OG.size, fonts },
  );
}
