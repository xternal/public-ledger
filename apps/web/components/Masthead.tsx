"use client";

import { useScenario } from "@/lib/scenario";
import { gbpBn } from "@/lib/format";
import { NavLinks } from "./NavLinks";
import { LogoMark } from "@/lib/brand";

const SECTIONS = [
  { href: "#statement", label: "Statement" },
  { href: "#scenario", label: "Scenario" },
  { href: "#you", label: "Your share" },
  { href: "#promises", label: "Promises" },
  { href: "/mp", label: "Your MP" },
  { href: "/people", label: "People" },
  { href: "#contribute", label: "Contribute" },
  { href: "#method", label: "Method" },
];

export function TopBar() {
  const { view } = useScenario();
  const { meta } = view.statement;
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline">
          <LogoMark />
          Public Ledger
        </a>
        <NavLinks links={SECTIONS} spy />
        <span className="hidden whitespace-nowrap text-label text-muted md:inline">
          {meta.country}, {meta.fiscal_year}
        </span>
      </div>
    </header>
  );
}

export function Hero() {
  const { seed, baseResult } = useScenario();
  const { meta } = seed.statement;
  const { receipts_bn, spending_bn, borrowing_bn } = baseResult.totals;
  return (
    <div className="pb-8 pt-12 sm:pt-16">
      <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-label text-muted">
        <span>
          Annual statement for {meta.fiscal_year}, based on the {meta.vintage_label}
        </span>
        <span className="rounded-full bg-warn/8 px-2 py-0.5 text-caption font-medium text-warn">Early version: cards checked by AI Journalist, human review to come</span>
      </p>
      <h1 className="max-w-[20ch] text-[clamp(32px,4.4vw,var(--text-display))] font-semibold leading-[1.06] tracking-[-0.035em]">
        Where {gbpBn(spending_bn)} of public money went, and where it came from
      </h1>
      <p className="mt-4 max-w-[58ch] text-lead text-muted">
        Taxes and other income covered {gbpBn(receipts_bn)}. The other{" "}
        <b className="font-semibold text-ink shadow-[inset_0_-3px_0_var(--debt-soft)]">{gbpBn(borrowing_bn)} was borrowed</b>, so every
        new promise either takes money from somewhere else or adds to that line.
      </p>
    </div>
  );
}
