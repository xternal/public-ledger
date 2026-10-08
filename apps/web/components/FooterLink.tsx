"use client";

import { usePathname } from "next/navigation";

/** A footer link that marks itself as the current page (aria-current), so readers know where they are on pages outside the menu. */
export function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const current = usePathname() === href;
  return (
    <a href={href} aria-current={current ? "page" : undefined} className={current ? "font-semibold text-ink" : undefined}>
      {children}
    </a>
  );
}
