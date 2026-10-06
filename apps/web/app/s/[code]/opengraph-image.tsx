import { ImageResponse } from "next/og";
import { getSeed } from "@/lib/data";
import { summarise } from "@/lib/scenario-summary";
import { OG, ogFonts } from "@/lib/og";
import { fixed, gbp, rangeText, signed, signedBn } from "@/lib/format";

export const alt = "A Public Ledger sandbox scenario: borrowing, per household and debt, with ranges";
export const size = OG.size;
export const contentType = "image/png";

const MAX_CHANGES_SHOWN = 2;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const seed = getSeed();
  const s = summarise(seed, code);
  const fonts = await ogFonts();
  if (!s) {
    return new ImageResponse(
      <div style={{ display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink, fontSize: 48, alignItems: "center", justifyContent: "center", fontFamily: "Geist" }}>
        Public Ledger
      </div>,
      { ...size, fonts },
    );
  }
  const { y1 } = s.result;
  const color = s.tone === "up" ? OG.bad : s.tone === "down" ? OG.good : OG.ink;
  const shown = s.changes.slice(0, MAX_CHANGES_SHOWN).map((c) => c.label);
  const more = s.changes.length - shown.length;
  const stat = (label: string, value: string, range: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
      <div style={{ fontSize: 24, color: OG.muted }}>{label}</div>
      <div style={{ fontSize: 46, fontWeight: 600, letterSpacing: -1.4 }}>{value}</div>
      <div style={{ fontSize: 22, color: OG.muted }}>{range}</div>
    </div>
  );
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "56px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600 }}>
          <div style={{ display: "flex", width: 22, height: 22, borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: "55%", height: "100%", background: OG.rec }} />
            <div style={{ width: "45%", height: "100%", background: OG.debt }} />
          </div>
          Public Ledger
        </div>
        <div style={{ display: "flex", fontSize: 22, color: OG.muted, background: OG.sunk, padding: "6px 16px", borderRadius: 999 }}>
          {`Sandbox scenario, UK ${s.decoded.baseYear}`}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 44, gap: 10 }}>
        <div style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2.4, color, lineHeight: 1.05 }}>{s.headline}</div>
        <div style={{ display: "flex", fontSize: 28, color: OG.muted }}>{`Range ${rangeText(y1.d_borrowing_bn, signedBn)} a year`}</div>
      </div>

      <div style={{ display: "flex", gap: 40, marginTop: 40, paddingTop: 28, borderTop: `2px solid ${OG.line}` }}>
        {stat("Per household, a year", signed(y1.per_household_gbp[1], gbp, 0.5), `range ${rangeText(y1.per_household_gbp, (x) => signed(x, gbp, 0.5))}`)}
        {stat(`Debt in ${s.debt.period}`, `${fixed(s.debt.central, 1)}% of GDP`, `OBR forecast ${fixed(s.debt.obr, 1)}%`)}
        {y1.cpi_pp[0] !== 0 || y1.cpi_pp[2] !== 0
          ? stat("Prices, one-off", `${signed(y1.cpi_pp[1], (a) => fixed(a, 1))}pp`, "rule of thumb")
          : stat("GDP, year one", `${signed(y1.gdp_pct[1], (a) => fixed(a, 2))}%`, "rule of thumb")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: 8 }}>
        <div style={{ display: "flex", fontSize: 24, color: OG.ink }}>
          {`${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`}
        </div>
        <div style={{ display: "flex", fontSize: 20, color: OG.muted }}>Built in the sandbox by a reader. Not a Public Ledger forecast. HMRC and OBR costings, no wider economic effects.</div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
