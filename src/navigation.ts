/** Navigation state used across pages: `from` preserves inventory filters, `notice` shows a one-time message. */
export interface NavState {
  from?: string;
  notice?: string;
  /** Sign-in page only: where to go after signing in. */
  returnTo?: string;
}

/** Only same-site paths, so a crafted link can't send the user to another site (e.g. "//evil.example"). */
export const safePath = (path: string | undefined, fallback = '/') =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : fallback;
