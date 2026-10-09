import { ImageResponse } from "next/og";
import { OG, ogFonts } from "./og";
import { MARK_DATA_URI } from "@/lib/brand";

export interface FiguresImage {
  /** The section after "Public Ledger ·", e.g. "Method" or "Autumn Budget 2026". */
  kicker: string;
  title: string;
  figures: { value: string; label: string }[];
  foot: string;
}

/** The share image for the method pages: a title, a line of numbers and a footnote, on the light theme. */
export function methodImage(input: Omit<FiguresImage, "kicker">) {
  return figuresImage({ kicker: "Method", ...input });
}

/** A share image for any page: section, title, up to three figures from the data, and a footnote. */
export async function figuresImage({ kicker, title, figures, foot }: FiguresImage) {
  const fonts = await ogFonts();
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "56px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600 }}>
        <img src={MARK_DATA_URI} width={28} height={28} alt="" />
        {`Public Ledger · ${kicker}`}
      </div>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 600, letterSpacing: -2.4, lineHeight: 1.05, marginTop: 44, maxWidth: 1000 }}>{title}</div>
      <div style={{ display: "flex", gap: 56, marginTop: "auto" }}>
        {figures.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", maxWidth: 340 }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 600, letterSpacing: -2.5, color: OG.rec }}>{f.value}</div>
            <div style={{ display: "flex", fontSize: 24, color: OG.ink, marginTop: 4 }}>{f.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 22, fontSize: 20, color: OG.muted }}>{foot}</div>
    </div>,
    { ...OG.size, fonts },
  );
}
