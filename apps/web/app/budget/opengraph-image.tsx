import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";
import { BUDGET, budgetDay, budgetWatch } from "@/lib/budget";
import { todayIso } from "@/lib/promises";

export const alt = "Public Ledger: the government's promises the Budget could fund or break, with what each would cost";
export const size = OG.size;
export const contentType = "image/png";
/** Same as the page: the image turns from "to watch" to "what it did" on Budget day without a deploy. */
export const revalidate = 3600;

export default async function Image() {
  const w = budgetWatch(getSeed().cards);
  const after = todayIso() >= BUDGET.date;
  const watched = w.needMoney.length + w.tax.length + w.other.length;
  return figuresImage({
    kicker: BUDGET.name,
    title: after ? "What the Budget did to the promises" : "The promises it could fund or break",
    figures: [
      ...(after ? [{ value: String(w.moved.length), label: "promises moved on Budget day" }] : []),
      { value: String(watched), label: "government promises it could move" },
      { value: String(w.needMoney.length), label: "with a stated cost" },
      ...(after ? [] : [{ value: String(w.opposition.length), label: "opposition pledges, costed" }]),
    ],
    foot: `Budget day ${budgetDay()} · every promise word for word, every cost with its source`,
  });
}
