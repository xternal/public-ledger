"use client";

import { SiteHeader } from "@/components/SiteHeader";

/**
 * Parliament's data service did not answer while this page was being made.
 * Nothing is cached in this state: the next visit tries again, and a page
 * made earlier keeps being served meanwhile.
 */
export default function MpPageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <SiteHeader current="/mp" />
      <main className="mx-auto grid max-w-[640px] gap-4 px-4 pb-20 pt-12 sm:px-6">
        <h1 className="m-0 text-[clamp(26px,4vw,34px)] font-semibold leading-[1.1] tracking-[-0.03em]">UK Parliament&apos;s data is not answering</h1>
        <p className="m-0 text-muted">
          We read MPs and votes from UK Parliament&apos;s open data, and it did not reply just now. This usually clears within a few minutes.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => retry()}
            className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
          >
            Try again
          </button>
          <a href="/mp" className="text-sm font-medium">
            Back to Your MP
          </a>
        </div>
      </main>
    </>
  );
}
