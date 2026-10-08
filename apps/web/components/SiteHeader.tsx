import { NavLinks } from "./NavLinks";

const LINKS = [
  { href: "/#statement", label: "Statement" },
  { href: "/#scenario", label: "Scenario" },
  { href: "/#you", label: "Your share" },
  { href: "/promises", label: "Promises" },
  { href: "/mp", label: "Your MP" },
  { href: "/people", label: "People" },
  { href: "/#contribute", label: "Contribute" },
  { href: "/method", label: "Method" },
];

/** Header for pages outside the home page. Server-safe, no sandbox state. */
export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline">
          <i aria-hidden className="inline-block size-3.5 rounded-[3px] bg-[linear-gradient(90deg,var(--rec)_0_55%,var(--debt)_55%_100%)]" />
          Public Ledger
        </a>
        <NavLinks links={LINKS} current={current} />
      </div>
    </header>
  );
}
