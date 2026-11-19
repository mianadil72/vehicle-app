// Inventory paging: page-size options and which page numbers to show.

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/**
 * Page numbers to show: always the first and last, the current page with one neighbour on each
 * side, and "…" for the gaps. E.g. 1 … 4 5 6 … 52.
 */
export function pageList(page: number, pages: number): (number | '…')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  // Show a lone hidden page instead of an ellipsis that would hide just one number.
  if (wanted.has(3) && !wanted.has(2) && pages >= 3) wanted.add(2);
  if (wanted.has(pages - 2) && !wanted.has(pages - 1)) wanted.add(pages - 1);
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}
