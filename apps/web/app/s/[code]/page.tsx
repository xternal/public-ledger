import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Range } from "@ledger/schema";
import { getSeed } from "@/lib/data";
import { OPEN_GRAPH } from "@/lib/site";
import { summarise } from "@/lib/scenario-summary";
import { fixed, gbp, gbpBn, longDate, millions, rangeText, signed, signedBn } from "@/lib/format";
import { LogoMark } from "@/lib/brand";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const s = summarise(getSeed(), code);
  if (!s) return { title: "Scenario not found | Public Ledger" };
  const d = s.result.y1.d_borrowing_bn;
  const description = `${s.changes.map((c) => c.label).join("; ")}. Range ${rangeText(d, signedBn)} a year. Built in the Public Ledger sandbox; not a forecast.`;
  return {
    title: `${s.headline} | Public Ledger scenario`,
    description,
    // A shared scenario is a reader's own sum, not a page for search: previews yes, indexing no.
    openGraph: { ...OPEN_GRAPH, title: s.headline, description, type: "article", url: `/s/${code}` },
    twitter: { card: "summary_large_image", title: s.headline, description },
    robots: { index: false },
  };
}

function Figure({ label, value, range, note, tone }: { label: string; value: string; range: string; note?: string; tone?: "up" | "down" | "flat" }) {
  return (
    <div className="grid content-start gap-1">
      <div className="text-label text-muted">{label}</div>
      <div className={`text-[26px] font-semibold leading-[1.15] tracking-[var(--tracking-figure)] ${tone === "up" ? "text-bad" : tone === "down" ? "text-good" : ""}`}>{value}</div>
      <div className="text-[12.5px] text-muted">{range}</div>
      {note && <div className="text-[12.5px] text-muted">{note}</div>}
    </div>
  );
}

const pp = (x: number) => signed(x, (a) => fixed(a, 1));
const pct2 = (x: number) => signed(x, (a) => fixed(a, 2));

export default async function SharePage({ params }: Props) {
  const { code } = await params;
  const seed = getSeed();
  const s = summarise(seed, code);
  if (!s) notFound();
  const { y1 } = s.result;
  const hh = (r: Range) => rangeText(r, (x) => signed(x, gbp, 0.5));
  const stale = s.decoded.baseYear !== seed.baseYear;

  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[880px] items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline">
            <LogoMark />
            Public Ledger
          </a>
          <a href={`/?s=${code}#scenario`} className="rounded-full bg-ink px-3 py-1 text-label font-semibold text-bg no-underline hover:opacity-90">
            Open in the sandbox
          </a>
        </div>
      </header>
      <main className="mx-auto grid max-w-[880px] gap-10 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid gap-3">
          <p className="m-0 text-label text-muted">
            A scenario built in the Public Ledger sandbox, on {s.decoded.baseYear} figures
          </p>
          <h1 className={`m-0 text-[clamp(30px,5vw,44px)] font-semibold leading-[1.08] tracking-[-0.03em] ${s.tone === "up" ? "text-bad" : s.tone === "down" ? "text-good" : ""}`}>
            {s.headline}
          </h1>
          <p className="m-0 max-w-[60ch] text-lead text-muted">Range {rangeText(y1.d_borrowing_bn, signedBn)} a year, in the first year.</p>
        </div>

        <section aria-labelledby="changes-h" className="grid gap-2">
          <h2 id="changes-h" className="text-label font-medium text-muted">
            What changes
          </h2>
          <ul className="m-0 grid list-none border-t border-line p-0 text-sm">
            {s.changes.map((c, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line py-2.5">
                <span>{c.label}</span>
                <span className="grid shrink-0 justify-items-end">
                  <span className="font-medium">{signedBn(c.d_borrowing_bn[1])} borrowing</span>
                  {c.d_borrowing_bn[0] !== c.d_borrowing_bn[2] && <span className="text-caption text-muted">{rangeText(c.d_borrowing_bn, signedBn)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Results" className="grid grid-cols-2 gap-x-6 gap-y-8 border-y border-line py-8 md:grid-cols-4">
          <Figure label="Borrowing, per year" value={signedBn(y1.d_borrowing_bn[1])} range={`range ${rangeText(y1.d_borrowing_bn, signedBn)}`} tone={s.tone} />
          <Figure
            label="Per household, per year"
            value={signed(y1.per_household_gbp[1], gbp, 0.5)}
            range={`range ${hh(y1.per_household_gbp)}`}
            note={`${millions(seed.statement.macro.households_m)} households`}
          />
          <Figure label="Prices (CPI), one-off" value={`${pp(y1.cpi_pp[1])}pp`} range={`range ${rangeText(y1.cpi_pp, pp)}pp`} note="Rule of thumb" />
          <Figure label="GDP, year one" value={`${pct2(y1.gdp_pct[1])}%`} range={`range ${rangeText(y1.gdp_pct, pct2)}%`} note="Rule of thumb" />
        </section>

        <p className="m-0 text-body">
          Public debt in {s.debt.period}: <b className="font-semibold">{fixed(s.debt.central, 1)}% of GDP</b>{" "}
          <span className="text-muted">
            (range {fixed(s.debt.low, 1)}% to {fixed(s.debt.high, 1)}%), against {fixed(s.debt.obr, 1)}% in the OBR forecast.
          </span>
        </p>

        <div className="grid gap-2 rounded-panel bg-sunk p-5 text-label text-muted">
          <p className="m-0 font-semibold text-ink">Built by someone using the sandbox. This is not a Public Ledger forecast or finding.</p>
          <p className="m-0">
            Tax costings are HMRC&apos;s and debt-interest costings the OBR&apos;s, per unit of change. They include how taxpayers respond but no wider economic
            effects. Price and GDP effects are rules of thumb, shown as wide ranges. Total spending this year: {gbpBn(seed.statement.spending.reduce((a, l) => a + l.bn, 0))}.
          </p>
          {stale && (
            <p className="m-0">
              This scenario was built on {s.decoded.baseYear} figures. It now runs on {seed.baseYear}, so the numbers may differ from when it was shared.
            </p>
          )}
          <p className="m-0">
            Data as of {longDate(seed.builtAt.slice(0, 10))}. <a href="/method">How the numbers work</a>
          </p>
        </div>

        <a href={`/?s=${code}#scenario`} className="justify-self-start rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg no-underline hover:opacity-90">
          Open this scenario in the sandbox
        </a>
      </main>
    </>
  );
}
