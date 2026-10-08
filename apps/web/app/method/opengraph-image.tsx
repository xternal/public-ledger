import { getSeed, getVintages } from "@/lib/data";
import { OG } from "@/lib/og";
import { methodImage } from "@/lib/method-og";
import { METHOD_TITLE } from "@/lib/method-copy";

export const alt = "Public Ledger: how the numbers are made, with every data edition listed";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const { manifest, changelog } = getVintages();
  return methodImage({
    title: METHOD_TITLE,
    figures: [
      { value: String(getSeed().sources.length), label: "official sources" },
      { value: String(changelog.length), label: "data editions on file" },
      { value: String(manifest.sources.length), label: "read every night" },
    ],
    foot: "Every number has a source, an edition and a quality label",
  });
}
