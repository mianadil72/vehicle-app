import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { NavState } from '../navigation';

/**
 * Shows a confirmation message passed as `state.notice` when navigating (e.g. after saving or deleting).
 * The message is removed from history state right away, so reloading or going back doesn't show it again,
 * and it's hidden once the user moves to another page.
 */
export function Notice() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as NavState | null;
  const incoming = state?.notice;
  const [notice, setNotice] = useState<{ text: string; path: string; key: string } | null>(null);

  // Pick up a new notice during render (keyed by the history entry), then clear it from history state.
  if (incoming && notice?.key !== location.key) {
    setNotice({ text: incoming, path: location.pathname, key: location.key });
  }

  useEffect(() => {
    if (!incoming) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: { ...state, notice: undefined } },
    );
  }, [incoming]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!notice || notice.path !== location.pathname) return null;
  return (
    <div className="notice" role="status">
      <span>{notice.text}</span>
      <button type="button" className="notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
        ×
      </button>
    </div>
  );
}
