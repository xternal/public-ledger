/**
 * The Public Ledger mark: the Statement's Sankey in one glyph. Income (blue)
 * and borrowing (orange) flow into spending (the light block), on a navy
 * tile. app/icon.svg, the PNG and .ico icons (scripts/icons.sh) and the share
 * images draw the same paths; change them together.
 */
export const MARK = {
  tile: "#101820",
  paths: [
    { d: "M9 11h3c13 0 13 9 25 9v18c-12 0-12-9-25-9H9z", fill: "#7b9dff" },
    { d: "M9 40h3c13 0 13-2 25-2v8c-12 0-12 2-25 2H9z", fill: "#ff7a2e" },
    { d: "M37 20h15a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H37z", fill: "#e7edf3" },
  ],
} as const;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${MARK.tile}"/>${MARK.paths
  .map((p) => `<path d="${p.d}" fill="${p.fill}"/>`)
  .join("")}</svg>`;

/** The mark as a data URI, for share images (ImageResponse draws an <img> of it). */
export const MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(markSvg)}`;

/**
 * The mark inline, next to the site name. In dark mode the tile takes the
 * raised surface colour (--mark-tile) so it still stands out on the navy page.
 */
export function LogoMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={`shrink-0 ${className}`}>
      <rect width="64" height="64" rx="14" style={{ fill: "var(--mark-tile)" }} />
      {MARK.paths.map((p) => (
        <path key={p.d} d={p.d} fill={p.fill} />
      ))}
    </svg>
  );
}
