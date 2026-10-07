import { FAQ } from "@/lib/faq";
import { SectionHeading } from "./ui";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="pt-20">
      <SectionHeading id="faq-h" title="Questions" />
      <div className="grid gap-x-10 gap-y-6 text-sm md:grid-cols-2">
        {FAQ.map(({ q, a }) => (
          <div key={q} className="grid max-w-[60ch] gap-1.5">
            <h3 className="m-0 text-body font-semibold text-ink">{q}</h3>
            <p className="m-0 text-muted">{a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
