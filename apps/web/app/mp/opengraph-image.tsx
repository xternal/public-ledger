import { OG } from "@/lib/og";
import { mpShareImage } from "@/lib/mp-og";

export const alt = "Public Ledger: find your MP by postcode, with their promises and votes";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  return mpShareImage("Find them by postcode", "Your MP");
}
