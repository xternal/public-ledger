"use client";

import type { Seed } from "@ledger/schema";
import { ScenarioProvider } from "@/lib/scenario";
import { T1Provider } from "@/lib/t1";
import { Hero, TopBar } from "./Masthead";
import { KpiStrip } from "./KpiStrip";
import { StatementSection } from "./Statement";
import { YourShare } from "./YourShare";
import { PromisesSection } from "./Promises";
import { Footer, Method } from "./Method";
import { Faq } from "./Faq";

export function Ledger({ seed }: { seed: Seed }) {
  return (
    <ScenarioProvider seed={seed}>
      {/* T1 (PolicyEngine) state is shared by the "Who gains and loses" panel and "People like me". */}
      <T1Provider>
        <TopBar />
        <main id="top" className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
          <Hero />
          <KpiStrip />
          <StatementSection />
          <YourShare />
          <PromisesSection />
          <Method />
          <Faq />
          <Footer />
        </main>
      </T1Provider>
    </ScenarioProvider>
  );
}
