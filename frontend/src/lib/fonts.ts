/**
 * fonts.ts
 * ----------------------------------------------------------------------------
 * Idempotent Google Fonts loader for the "Warm Almanac" type system
 * (CONTRACT §7.1):
 *   - Fraunces 900       → big numbers, hero clocks, scores ("stamped" numerals)
 *   - Fraunces 600       → card headings, day/section headers
 *   - Hanken Grotesk     → all body copy, buttons, labels
 *
 * Why this exists: the shell (<App/>) needs both families available BEFORE
 * first paint, but repeated mounts must never inject duplicate <link> elements
 * into <head> (that would spam the DOM and trigger redundant network fetches).
 * This single shared loader is therefore idempotent: each unique href is
 * appended at most once across the whole app lifetime, guarded by a query
 * against the document <head>.
 *
 * No measurements here, but per the project's metric mandate every duration in
 * this codebase is expressed in SI seconds/ms and every spacing token in px.
 * ----------------------------------------------------------------------------
 */

/**
 * The exact stylesheet href for the Warm Almanac families (CONTRACT §7.1).
 * Fraunces ships its optical-size axis (opsz 9..144) at weights 400/600/900;
 * Hanken Grotesk at 400/500/600/700. Keep this string byte-for-byte stable —
 * it doubles as the de-duplication key for `appendLinkOnce`.
 */
const FONT_CSS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap';

/**
 * Append a <link> to <head> exactly once. If a link with the same href already
 * exists, this is a no-op — that is what keeps the loader idempotent.
 *
 * @param rel    The link relationship (`preconnect` | `stylesheet`).
 * @param href   The resource URL — also the de-duplication key.
 * @param cross  When true, mark the request as anonymous CORS (needed for the
 *               gstatic font binaries so the browser can reuse the connection).
 */
function appendLinkOnce(rel: string, href: string, cross?: boolean): void {
  // Already present? Nothing to do.
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
 * Load Fraunces + Hanken Grotesk once for the entire application.
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
