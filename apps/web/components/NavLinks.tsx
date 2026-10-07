"use client";

import { useEffect, useRef, useState } from "react";

export interface NavLink {
  href: string;
  label: string;
}

/** Below the sticky header (56px) plus a little air: a section counts as "in view" once its top passes this line. */
const SPY_LINE_PX = 120;

/**
 * The site menu, so readers always know where they are:
 * - the current page (and its sub-pages, e.g. a promise card under "Promises") is highlighted, with aria-current="page";
 * - with `spy`, the in-page section in view is highlighted as the reader scrolls, with aria-current="location";
 * - on narrow screens the menu scrolls sideways, and the highlighted item is kept in view.
 */
export function NavLinks({ links, current, spy = false }: { links: NavLink[]; current?: string; spy?: boolean }) {
  const [inView, setInView] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Section in view: the last section whose top has passed the line under the header.
  useEffect(() => {
    if (!spy) return;
    const ids = links.map((l) => l.href.split("#")[1]).filter((id): id is string => !!id);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = 0;
      timer = undefined;
      let active: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= SPY_LINE_PX) active = id;
      }
      // At the very bottom the last short sections may never reach the line: treat the end of the page as the last section.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = ids.at(-1) ?? active;
      setInView(active);
    };
    // Next animation frame, with a timer as a fallback: hidden or throttled tabs pause animation frames.
    const onScroll = () => {
      if (frame || timer) return;
      frame = requestAnimationFrame(update);
      timer = setTimeout(update, 120);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [spy, links]);

  const isActive = (l: NavLink) => (spy ? inView !== null && l.href.endsWith(`#${inView}`) : current === l.href);

  // Keep the highlighted item visible in the sideways-scrolling menu (phones), without moving the page.
  const activeHref = links.find(isActive)?.href ?? null;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Nothing highlighted (the top of the page): show the menu from its start.
    if (!activeHref) {
      nav.scrollLeft = 0;
      return;
    }
    const link = nav.querySelector<HTMLElement>(`a[href="${CSS.escape(activeHref)}"]`);
    if (!link) return;
    // Measure on screen, so the menu's current scroll is accounted for; centre the item if any part is hidden.
    const n = nav.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    if (r.left < n.left || r.right > n.right) {
      // Instant, not smooth: a small shift that always lands, also with reduced motion or in throttled tabs.
      nav.scrollLeft = Math.max(0, nav.scrollLeft + (r.left - n.left) - (n.width - r.width) / 2);
    }
  }, [activeHref]);

  return (
    <nav ref={navRef} aria-label="Sections" className="no-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
      {links.map((l) => {
        const active = isActive(l);
        return (
          <a
            key={l.href}
            href={l.href}
            aria-current={active ? (spy ? "location" : "page") : undefined}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium no-underline transition-colors hover:bg-sunk hover:text-ink ${
              active ? "bg-sunk text-ink shadow-[inset_0_-2px_0_var(--ink)]" : "text-muted"
            }`}
          >
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
