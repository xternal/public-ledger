import { ImageResponse } from "next/og";
import { getPeople } from "@/lib/data";
import { OG, ogFonts } from "@/lib/og";
import { pctGdp, per100, span, spendingSpan } from "@/lib/people-view";

export const alt = "Public Ledger: people over pension age per 100 of working age, and spending that rises with age, from ONS and OBR projections";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const p = getPeople();
  const oadr = span(p.charts.oadr);
  const spend = spendingSpan(p);
  const fonts = await ogFonts();
  const figure = (from: string, to: string, fromYear: string | number, toYear: string | number, label: string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", width: 500 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 30, color: OG.muted }}>{from}</div>
        <div style={{ display: "flex", fontSize: 30, color: OG.muted }}>→</div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 600, letterSpacing: -3, color }}>{to}</div>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: OG.ink, marginTop: 6 }}>{label}</div>
      <div style={{ display: "flex", fontSize: 22, color: OG.muted, marginTop: 4 }}>{`${fromYear} to ${toYear}`}</div>
    </div>
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
      <div style={{ display: "flex", fontSize: 60, fontWeight: 600, letterSpacing: -2.2, lineHeight: 1.05, marginTop: 44, maxWidth: 1000 }}>
        An ageing country, and what it costs
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto" }}>
        {figure(per100(oadr.first), per100(oadr.last), oadr.firstYear, oadr.lastYear, "people over pension age per 100 of working age", OG.rec)}
        {figure(pctGdp(spend.first), pctGdp(spend.last), spend.firstYear, spend.lastYear, "of GDP spent on things that rise with age", OG.ink)}
      </div>
      <div style={{ display: "flex", marginTop: 22, fontSize: 20, color: OG.muted }}>ONS principal projection and OBR baseline, with every variant on the page</div>
    </div>,
    { ...size, fonts },
  );
}
