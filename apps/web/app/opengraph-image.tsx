import { ImageResponse } from "next/og";
import { getSeed } from "@/lib/data";
import { OG, ogFonts } from "@/lib/og";
import { fixed, gbpBn, shareOf } from "@/lib/format";

export const alt = "Public Ledger: where UK public money went, and where it came from";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const seed = getSeed();
  const s = seed.statement;
  const receipts = s.receipts.reduce((a, l) => a + l.bn, 0);
  const spending = s.spending.reduce((a, l) => a + l.bn, 0);
  const fonts = await ogFonts();
  const bar = (share: number, color: string, hatch = false) => (
    <div style={{ display: "flex", width: `${share}%`, height: "100%", background: hatch ? `repeating-linear-gradient(45deg, ${color} 0 6px, #FDE3D3 6px 12px)` : color }} />
  );
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "56px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600 }}>
        <div style={{ display: "flex", width: 22, height: 22, borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: "55%", height: "100%", background: OG.rec }} />
          <div style={{ width: "45%", height: "100%", background: OG.debt }} />
        </div>
        Public Ledger
      </div>
      <div style={{ display: "flex", fontSize: 66, fontWeight: 600, letterSpacing: -2.4, lineHeight: 1.05, marginTop: 52, maxWidth: 980 }}>
        {`Where ${gbpBn(spending)} of public money went in ${s.meta.fiscal_year}, and where it came from`}
      </div>
      <div style={{ display: "flex", height: 36, marginTop: "auto", borderRadius: 8, overflow: "hidden" }}>
        {bar(shareOf(receipts, spending), OG.rec)}
        {bar(shareOf(s.borrowing_bn, spending), OG.debt, true)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 26 }}>
        <div style={{ display: "flex", color: OG.rec, fontWeight: 600 }}>{`Taxes and other income ${gbpBn(receipts)}`}</div>
        <div style={{ display: "flex", color: OG.debt, fontWeight: 600 }}>{`Borrowed ${gbpBn(s.borrowing_bn)}, ${fixed(shareOf(s.borrowing_bn, spending), 1)}p of every £1`}</div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
