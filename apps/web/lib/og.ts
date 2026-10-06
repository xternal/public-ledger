import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Share-image theme: the light tokens from styles/tokens.css (CSS variables do not exist inside next/og). */
export const OG = {
  size: { width: 1200, height: 630 },
  bg: "#FFFFFF",
  sunk: "#F5F5F6",
  line: "#E7E7EA",
  ink: "#0B0B0D",
  muted: "#61616B",
  rec: "#2457F5",
  debt: "#F2600C",
  good: "#15803D",
  bad: "#DC2626",
} as const;

export async function ogFonts() {
  const dir = join(process.cwd(), "assets", "fonts");
  const [regular, semibold] = await Promise.all([readFile(join(dir, "Geist-Regular.ttf")), readFile(join(dir, "Geist-SemiBold.ttf"))]);
  return [
    { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}
