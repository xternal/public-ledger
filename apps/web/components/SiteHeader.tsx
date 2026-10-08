import { NavLinks } from "./NavLinks";
import { SITE_LINKS } from "./siteLinks";
import { LogoMark } from "@/lib/brand";

/** Header for pages outside the home page. Server-safe, no sandbox state. */
export function SiteHeader({ current }: { current?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-ink no-underline">
          <LogoMark />
          Public Ledger
        </a>
        <NavLinks links={SITE_LINKS} current={current} />
      </div>
    </header>
  );
}
