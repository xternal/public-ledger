import { ImageResponse } from "next/og";
import { CONFIRM_TTL_DAYS } from "@ledger/server/follow";
import { SUBMITTER_EMAIL_RETENTION_DAYS } from "@ledger/server/intake";
import { OG, ogFonts } from "@/lib/og";
import { PRIVACY_TITLE } from "@/lib/privacy-copy";

export const alt = "Public Ledger privacy notice: what we keep, why, for how long, and how to have it deleted";
export const size = OG.size;
export const contentType = "image/png";

/** The share image for /privacy: the title and the retention periods the code enforces, numbers first. */
export default async function Image() {
  const fonts = await ogFonts();
  const figures = [
    { value: `${CONFIRM_TTL_DAYS} days`, label: "until an unconfirmed sign-up is deleted" },
    { value: `${SUBMITTER_EMAIL_RETENTION_DAYS} days`, label: "at most for a submitter's email" },
    { value: "Never", label: "do we keep your postcode" },
  ];
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "56px 64px", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 600 }}>
        <div style={{ display: "flex", width: 22, height: 22, borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: "55%", height: "100%", background: OG.rec }} />
          <div style={{ width: "45%", height: "100%", background: OG.debt }} />
        </div>
        Public Ledger
      </div>
      <div style={{ display: "flex", fontSize: 64, fontWeight: 600, letterSpacing: -2.4, lineHeight: 1.05, marginTop: 44, maxWidth: 1000 }}>{PRIVACY_TITLE}</div>
      <div style={{ display: "flex", fontSize: 30, color: OG.muted, marginTop: 16, maxWidth: 1000 }}>We keep as little about you as we can, and delete it for real.</div>
      <div style={{ display: "flex", gap: 56, marginTop: "auto" }}>
        {figures.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", maxWidth: 320 }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 600, letterSpacing: -2.2, color: OG.rec }}>{f.value}</div>
            <div style={{ display: "flex", fontSize: 24, color: OG.ink, marginTop: 4 }}>{f.label}</div>
          </div>
        ))}
      </div>
    </div>,
    { ...OG.size, fonts },
  );
}
