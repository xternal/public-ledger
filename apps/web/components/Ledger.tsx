"use client";

import type { Seed } from "@ledger/schema";
import { ScenarioProvider } from "@/lib/scenario";
import { Hero, TopBar } from "./Masthead";
import { KpiStrip } from "./KpiStrip";
import { StatementSection } from "./Statement";
import { YourShare } from "./YourShare";
import { PromisesSection } from "./Promises";
import { Footer, Method } from "./Method";

export function Ledger({ seed }: { seed: Seed }) {
  return (
    <ScenarioProvider seed={seed}>
      <TopBar />
      <main id="top" className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
        <Hero />
        <KpiStrip />
        <StatementSection />
        <YourShare />
        <PromisesSection />
        <Method />
        <Footer />
      </main>
    </ScenarioProvider>
  );
}
