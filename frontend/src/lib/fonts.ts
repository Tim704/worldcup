/**
 * fonts.ts
 * ----------------------------------------------------------------------------
 * Idempotent Google Fonts loader for the "Broadcast Editorial" type system:
 *   - Anton       → oversized display caps (headers, scores, big numbers)
 *   - Archivo     → body / UI copy
 *   - Space Mono  → data ticks, micro-labels, monospaced metadata
 *
 * Why this exists: the existing MatchPredictionCenter component injects these
 * three families itself on mount. The rest of the SPA (App shell + the four
 * views) needs the same families available BEFORE first paint, but we must not
 * inject duplicate <link> elements (one per view mount would spam <head> and
 * trigger redundant network fetches). This single shared loader is therefore
 * idempotent: each unique href is appended at most once across the whole app
 * lifetime, guarded by a query against the document <head>.
 *
 * No measurements here, but per the project's metric mandate every duration in
 * this codebase is expressed in seconds and every spacing token in px/rem.
 * ----------------------------------------------------------------------------
 */

/**
 * The exact stylesheet href shared with MatchPredictionCenter so both the
 * component and the shell resolve to the SAME cached resource. Keep this string
 * byte-for-byte identical to the one in MatchPredictionCenter so the
 * `document.querySelector('link[href="…"]')` de-duplication actually matches.
 */
const FONT_CSS_HREF =
  'https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap';

/**
 * Append a <link> to <head> exactly once. If a link with the same href already
 * exists (e.g. injected by MatchPredictionCenter), this is a no-op.
 *
 * @param rel    The link relationship (`preconnect` | `stylesheet`).
 * @param href   The resource URL — also the de-duplication key.
 * @param cross  When true, mark the request as anonymous CORS (needed for the
 *               gstatic font binaries so the browser can reuse the connection).
 */
function appendLinkOnce(rel: string, href: string, cross?: boolean): void {
  // Already present? Nothing to do — keeps the loader idempotent.
  if (document.querySelector(`link[href="${href}"]`)) {
    return;
  }
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (cross) {
    link.crossOrigin = 'anonymous';
  }
  document.head.appendChild(link);
}

/**
 * Load the three display fonts once for the entire application.
 *
 * Safe to call from any number of components on every mount: redundant calls
 * are cheap (three `querySelector` lookups) and never duplicate DOM nodes.
 * Intended to be invoked from <App/> on mount.
 */
export function loadFonts(): void {
  // Warm up the two font origins so the stylesheet + binaries fetch in parallel.
  appendLinkOnce('preconnect', 'https://fonts.googleapis.com');
  appendLinkOnce('preconnect', 'https://fonts.gstatic.com', true);
  // The actual @font-face stylesheet.
  appendLinkOnce('stylesheet', FONT_CSS_HREF);
}
