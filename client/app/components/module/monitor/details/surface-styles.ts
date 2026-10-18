/*
 * Console surface styles for the monitor details page and the incident table.
 *
 * Copied from blocks-release's deployment `surface-styles.ts` (the "Monitoring" table on the
 * repository page) rather than imported across repos. Only what this repo's kit does not already
 * give is kept: the kit `Table` plus the global table CSS already draw the uppercase `h-10 px-5`
 * headers, the `px-5 py-4` cells, the `border-border/50` row dividers and the warm hover tint, and
 * the kit's outline `Button` is already the console outline button, so repeating those classes
 * here would only duplicate them.
 */

/** Table wrapper: the table draws its own card, with its pagination footer inside it. */
export const TABLE_CARD_CLASS = "overflow-hidden rounded-sm bg-card shadow-surface-ring";

/** Section rhythm: heading over its body, sections spaced by the page's `space-y-6`. */
export const SECTION_CLASS = "flex flex-col gap-3";

/** An outlined surface for a section body: a stat tile or the chart. */
export const SURFACE_TILE_CLASS = "rounded-sm bg-card p-5 shadow-surface-ring";

/** Stat tiles: a 1 / 2 / 4 column grid of small muted label, large value, muted sub-line. */
export const STAT_GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";
export const STAT_LABEL_CLASS = "text-xs font-medium text-muted-foreground";
export const STAT_VALUE_CLASS =
  "mt-2 flex min-h-8 items-center text-2xl font-semibold tracking-tight text-high-emphasis";
export const STAT_SUB_CLASS = "mt-1 text-xs text-muted-foreground";

/** Soft status pills: `forest` for up / resolved, `rose` for down / open, muted for paused. */
export type StatusTone = "up" | "down" | "paused";

export const STATUS_PILL_CLASS =
  "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium";

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  up: "bg-forest-soft text-forest-ink",
  down: "bg-rose-soft text-rose-ink",
  paused: "bg-muted text-muted-foreground",
};
