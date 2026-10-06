import { ImageResponse } from "next/og";
import { getSeed } from "@/lib/data";
import { OG, ogFonts } from "@/lib/og";
import { STATUS_LABEL } from "@/lib/copy";
import { fixed, gbp, gbpBn, longDate, perHousehold, rangeText, shareOf } from "@/lib/format";
import { whoLine } from "@/lib/promises";

export const alt = "A Public Ledger promise card: the quote, its status, cost, per household and who pays";
export const size = OG.size;
export const contentType = "image/png";

export function generateStaticParams() {
  return getSeed().cards.map((c) => ({ id: c.id }));
}

const STATUS_COLOR: Record<string, string> = {
  delivered: OG.good,
  failed: OG.bad,
  quietly_dropped: OG.bad,
  in_plan: OG.rec,
  legislated: OG.rec,
  funded: "#A3480A",
  delivering: "#A3480A",
  promised: OG.muted,
  unscoreable: OG.muted,
};
const MAX_QUOTE_CHARS = 150;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seed = getSeed();
  const card = seed.cards.find((c) => c.id === id)!;
  const fonts = await ogFonts();
  const p = card.current.parameters;
  const cost = p?.how_much_bn_per_year ?? null;
  const spending = seed.statement.spending.reduce((a, l) => a + l.bn, 0);
  const hh = (x: number) => gbp(perHousehold(x, seed.statement.macro.households_m));
  const quote = card.current.text.length > MAX_QUOTE_CHARS ? `${card.current.text.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…` : card.current.text;
  const stat = (label: string, value: string, sub: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <div style={{ fontSize: 22, color: OG.muted }}>{label}</div>
      <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: -1.2 }}>{value}</div>
      <div style={{ fontSize: 20, color: OG.muted }}>{sub}</div>
    </div>
  );
  const funding = p === null ? "Unscoreable: no who, how much, when or from where" : p.funded_by ? `Paid for by: ${p.funded_by}` : "Funding not stated when it was announced";
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "52px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 600 }}>
          <div style={{ display: "flex", width: 20, height: 20, borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: "55%", height: "100%", background: OG.rec }} />
            <div style={{ width: "45%", height: "100%", background: OG.debt }} />
          </div>
          Public Ledger
        </div>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: STATUS_COLOR[card.file.status] ?? OG.ink, border: `2px solid ${STATUS_COLOR[card.file.status] ?? OG.ink}`, padding: "4px 16px", borderRadius: 999 }}>
          {STATUS_LABEL[card.file.status]}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: OG.muted, marginTop: 34 }}>{`${whoLine(card)}, ${longDate(card.file.made_on)}`}</div>
      <div style={{ display: "flex", fontSize: 46, fontWeight: 600, letterSpacing: -1.4, lineHeight: 1.15, marginTop: 10 }}>{`“${quote}”`}</div>
      {cost ? (
        <div style={{ display: "flex", gap: 36, marginTop: "auto", paddingTop: 24, borderTop: `2px solid ${OG.line}` }}>
          {stat("A year", gbpBn(cost[1]), `range ${rangeText(cost, gbpBn)}`)}
          {stat("Per household", hh(cost[1]), `range ${rangeText(cost, hh)}`)}
          {stat("Share of spending", `${fixed(shareOf(cost[1], spending), 2)}%`, `of ${gbpBn(spending)}`)}
        </div>
      ) : (
        <div style={{ display: "flex", marginTop: "auto", paddingTop: 24, borderTop: `2px solid ${OG.line}`, fontSize: 30, color: OG.muted }}>
          {p === null ? "Not costable" : "Cost not stated or not yet costed"}
        </div>
      )}
      <div style={{ display: "flex", fontSize: 22, color: p?.funded_by ? OG.ink : OG.muted, marginTop: 18 }}>{funding.length > 120 ? `${funding.slice(0, 119)}…` : funding}</div>
    </div>,
    { ...size, fonts },
  );
}
