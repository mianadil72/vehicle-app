import { PAGE_SIZES, pageList, type PageSize } from '../paging';

interface Props {
  page: number;
  pages: number;
  size: PageSize;
  onPage: (page: number) => void;
  onSize: (size: PageSize) => void;
  /** Show the "per page" selector (off for the second pager under the results). */
  showSize?: boolean;
}

/** Prev / numbered pages / next, plus a "per page" selector. */
export function Pagination({ page, pages, size, onPage, onSize, showSize = true }: Props) {
  return (
    <nav className="pager" aria-label="Pages">
      {showSize && (
        <label className="pager-size">
          Per page
          <select value={size} onChange={(e) => onSize(Number(e.target.value) as PageSize)}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      {pages > 1 && (
        <ul className="pager-pages">
          <li>
            <button type="button" className="pager-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
              ‹ Prev
            </button>
          </li>
          {/* Phones show "Page X of Y" instead of the numbered buttons (CSS). */}
          <li className="pager-status" aria-current="page">
            Page {page} of {pages}
          </li>
          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <li key={`gap-${i}`} className="pager-gap pager-num" aria-hidden="true">…</li>
            ) : (
              <li key={p} className="pager-num">
                <button
                  type="button"
                  className={p === page ? 'pager-btn active' : 'pager-btn'}
                  onClick={() => onPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                >
                  {p}
                </button>
              </li>
            ),
          )}
          <li>
            <button type="button" className="pager-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
              Next ›
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
