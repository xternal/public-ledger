/**
 * Scroll a sideways-scrolling row (the menu, filter chips on phones) so that
 * `item` is fully visible, centring it if any part is hidden. Measured on
 * screen, so the row's current scroll is accounted for. Instant, not smooth:
 * a small shift that always lands, also with reduced motion or in throttled tabs.
 */
export function keepInView(row: HTMLElement, item: HTMLElement): void {
  const n = row.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.left < n.left || r.right > n.right) {
    row.scrollLeft = Math.max(0, row.scrollLeft + (r.left - n.left) - (n.width - r.width) / 2);
  }
}
