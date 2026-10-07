"use client";

import { useEffect, useState } from "react";
import { useScenario } from "@/lib/scenario";
import { todayIso } from "@/lib/promises";
import { ContributeForm, type SubmissionKind } from "./ContributeForm";
import { CreditTable } from "./CreditTable";
import { PromiseList } from "./PromiseList";
import { QualityBadge, SectionHeading } from "./ui";

/** How many of the newest cards the home page shows; the rest live on /promises. */
const HOME_CARDS = 6;

function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  return today;
}

export function PromisesSection() {
  const { seed } = useScenario();
  const cards = seed.cards;
  const today = useToday();
  const [kind, setKind] = useState<SubmissionKind>("new");
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");

  // "Add evidence" on a card page links here with ?card=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("card");
    if (id && cards.some((c) => c.id === id)) {
      setKind("evidence");
      setCardId(id);
    }
  }, [cards]);

  const unchecked = cards.filter((c) => c.file.editor_check_required).length;

  return (
    <section id="promises" aria-labelledby="promises-h" className="pt-20">
      <SectionHeading
        id="promises-h"
        title="Promise ledger"
        intro="Every promise gets a card: what, who, how much, from where, and a timeline that ends in delivery or in silence."
        aside={unchecked ? <QualityBadge quality="approx">{`${unchecked} of ${cards.length} cards awaiting editor check`}</QualityBadge> : undefined}
      />
      <PromiseList cards={cards.slice(0, HOME_CARDS)} today={today} />
      <a href="/promises" className="mt-4 inline-block text-sm font-semibold">
        See all {cards.length} promises, with filters
      </a>

      <div className="mt-16">
        <SectionHeading title="Track record" intro="How each party's promises stand, counted from the cards. No scores: the mix speaks for itself." />
        <CreditTable cards={cards} by="party" caption="Promises by party and status" />
      </div>

      <ContributeForm promises={cards} kind={kind} cardId={cardId} onKind={setKind} onCard={setCardId} />
    </section>
  );
}
