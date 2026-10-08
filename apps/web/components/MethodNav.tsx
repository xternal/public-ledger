import { METHOD_PAGES } from "@/lib/method-copy";

/**
 * The method pages' own menu, under the site header (where "Method" is highlighted
 * for all three). The current page is marked with aria-current; the items wrap on
 * phones, so the highlighted one is always in view.
 */
export function MethodNav({ current }: { current: (typeof METHOD_PAGES)[number]["href"] }) {
  return (
    <nav aria-label="Method" className="flex flex-wrap gap-1 border-b border-line pb-3">
      {METHOD_PAGES.map((p) => {
        const active = p.href === current;
        return (
          <a
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 text-label font-medium no-underline transition-colors hover:bg-sunk hover:text-ink ${
              active ? "bg-sunk text-ink shadow-[inset_0_-2px_0_var(--ink)]" : "text-muted"
            }`}
          >
            {p.label}
          </a>
        );
      })}
    </nav>
  );
}
