import { ImageResponse } from "next/og";
import { OG, ogFonts } from "@/lib/og";
import { MARK_DATA_URI } from "@/lib/brand";

/** Share image for /mp and /mp/<constituency>: built from the constituency list alone, so it never waits on Parliament. */
export async function mpShareImage(eyebrow: string, heading: string): Promise<ImageResponse> {
  const fonts = await ogFonts();
  const row = (label: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, color: OG.ink }}>
      <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: OG.rec }} />
      {label}
    </div>
  );
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "56px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600 }}>
        <img src={MARK_DATA_URI} width={28} height={28} alt="" />
        Public Ledger
      </div>
      <div style={{ display: "flex", fontSize: 30, color: OG.muted, marginTop: 52 }}>{eyebrow}</div>
      <div style={{ display: "flex", fontSize: heading.length > 32 ? 60 : 76, fontWeight: 600, letterSpacing: -2.4, lineHeight: 1.05, marginTop: 10, maxWidth: 1060 }}>
        {heading}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: "auto" }}>
        {row("Who they are")}
        {row("The promises we track for them and their party")}
        {row("How they voted recently, from UK Parliament")}
      </div>
    </div>,
    { ...OG.size, fonts },
  );
}
