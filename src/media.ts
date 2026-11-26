import { useSyncExternalStore } from 'react';

/** Phones: the same width as the `@media (max-width: 640px)` rules in App.css. */
export const PHONE_QUERY = '(max-width: 640px)';

/** Phones and tablets in portrait: the same width as the `@media (max-width: 860px)` rules in App.css. */
export const TABLET_QUERY = '(max-width: 860px)';

/** Whether a CSS media query currently matches; re-renders when it changes (rotation, resizing). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
