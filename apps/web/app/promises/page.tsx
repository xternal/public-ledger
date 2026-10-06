import type { Metadata } from "next";
import { getSeed } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseIndex } from "@/components/PromiseIndex";
import { FollowButton } from "@/components/FollowPanel";
import { AREA_LABEL } from "@/lib/promises";
import { followOptions } from "@/app/follow/targets";

export const metadata: Metadata = {
  title: "Promise ledger | Public Ledger",
  description: "Every tracked UK political promise: what, who, how much, from where, and whether it happened. One standard for every party.",
};

export default function PromisesPage() {
  const seed = getSeed();
  return (
    <>
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1200px] gap-8 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid max-w-[66ch] gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">Promise ledger</h1>
          <p className="m-0 text-lead text-muted">
            Every card follows one published standard, the same for every party: the promise in the speaker&apos;s own words, its cost and who pays,
            and a timeline that ends in delivery or in silence.
          </p>
          <FollowButton
            label="Follow a policy area or everything"
            trackKind="area"
            areas={Object.entries(AREA_LABEL).map(([id, label]) => ({ id, label }))}
            options={followOptions()}
          />
        </div>
        <PromiseIndex cards={seed.cards} />
      </main>
    </>
  );
}
