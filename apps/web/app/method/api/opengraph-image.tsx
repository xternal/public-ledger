import { endpoints } from "@/lib/api";
import { OG } from "@/lib/og";
import { methodImage } from "@/lib/method-og";
import { API_TITLE } from "@/lib/method-copy";

export const alt = "Public Ledger open data API: JSON and CSV, free, no key";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  return methodImage({
    title: API_TITLE,
    figures: [
      { value: String(endpoints().filter((e) => !e.path.includes("{")).length), label: "datasets" },
      { value: "JSON", label: "or CSV" },
      { value: "0", label: "keys or sign-ups" },
    ],
    foot: "Statement, promises, actors, forecasts, contracts and data editions, each number with its source",
  });
}
