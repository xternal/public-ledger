"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { useScenario } from "@/lib/scenario";
import { ContributeForm, type SubmissionKind } from "./ContributeForm";
import { CreditTable } from "./CreditTable";
import { PromiseDetail } from "./PromiseDetail";
import { PromiseList } from "./PromiseList";
import { QualityBadge, SectionHeading } from "./ui";

/** Today's date, read on the client only so the static page never freezes it (review M1). */
function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);
  return today;
}

export function PromisesSection() {
  const { seed } = useScenario();
  const promises = seed.promises.promises;
  const [selected, setSelected] = useState(promises[0]!.id);
  const [followOpen, setFollowOpen] = useState(false);
  const [kind, setKind] = useState<SubmissionKind>("new");
  const [cardId, setCardId] = useState(promises[0]!.id);
  const today = useToday();
  const card = promises.find((p) => p.id === selected)!;

  return (
    <section id="promises" aria-labelledby="promises-h" className="scroll-mt-16 pt-20">
      <SectionHeading
        id="promises-h"
        title="Promise ledger"
        intro="Every promise gets a card: what, who, how much, from where, and a timeline that ends in delivery or in silence."
        aside={<QualityBadge quality="approx">Sample cards, editor check pending</QualityBadge>}
      />
      <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <PromiseList
          promises={promises}
          selected={selected}
          today={today}
          onSelect={(id) => {
            setSelected(id);
            setFollowOpen(false);
            track("promise_card_viewed", { promise_id: id, status: promises.find((p) => p.id === id)!.status });
          }}
        />
        <PromiseDetail
          card={card}
          today={today}
          followOpen={followOpen}
          onToggleFollow={() => {
            if (!followOpen) track("follow_panel_opened", { target_kind: "promise" });
            setFollowOpen(!followOpen);
          }}
          onAddEvidence={() => {
            setKind("evidence");
            setCardId(card.id);
            document.getElementById("contribute")?.scrollIntoView({ behavior: "smooth", block: "start" });
            setTimeout(() => document.getElementById("sub-url")?.focus({ preventScroll: true }), 0);
          }}
        />
      </div>
      <CreditTable promises={promises} />
      <ContributeForm promises={promises} kind={kind} cardId={cardId} onKind={setKind} onCard={setCardId} />
    </section>
  );
}
