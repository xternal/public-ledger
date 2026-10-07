import type { Metadata } from "next";
import { safeNext } from "@ledger/server/alpha";

export const metadata: Metadata = {
  title: "Public Ledger alpha",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  wrong: "That password is not right. Check it and try again.",
  busy: "Too many tries from this connection today. Try again tomorrow.",
  error: "Something went wrong. Please try again.",
};

type Props = { searchParams: Promise<{ next?: string; e?: string }> };

/** The alpha preview's sign-in page: one shared password for testers. */
export default async function AlphaPage({ searchParams }: Props) {
  const { next, e } = await searchParams;
  const message = e ? (ERRORS[e] ?? ERRORS.error) : null;
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-[420px] content-center gap-5 px-4 py-16">
      <p className="m-0 text-label font-medium text-muted">Public Ledger · alpha</p>
      <h1 className="m-0 text-[clamp(28px,4vw,36px)] font-semibold leading-tight tracking-[-0.03em]">A private preview</h1>
      <p className="m-0 text-lead text-muted">
        This early version is for testers. Figures come from official sources, but promise cards have not had their editor review yet. Please don&apos;t share
        it.
      </p>
      <form method="post" action="/api/alpha" className="grid gap-3">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label htmlFor="alpha-password" className="text-label font-medium text-muted">
          Password
        </label>
        <input
          id="alpha-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field-input"
          aria-invalid={!!message}
          aria-describedby={message ? "alpha-error" : undefined}
        />
        {message && (
          <p id="alpha-error" role="alert" className="m-0 text-sm text-debt-ink">
            {message}
          </p>
        )}
        <button type="submit" className="cursor-pointer justify-self-start rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
          Enter
        </button>
      </form>
    </main>
  );
}
