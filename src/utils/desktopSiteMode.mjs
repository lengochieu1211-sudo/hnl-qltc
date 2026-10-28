/**
 * Best-effort Chrome Android 'Request desktop site' presentation hint.
 * Chrome hides the original Android platform behind a desktop User-Agent in that mode.
 * Never use this hint for data, authorization, offline persistence or platform APIs.
 */
/**
 * @typedef {{userAgent: string, viewportWidth: number, touchPoints: number, screenWidth: number}} DesktopSiteHint
 */
/** @param {DesktopSiteHint} hint */
export function detectChromeDesktopSiteOnTouchDevice(hint) {
  const { userAgent, viewportWidth, touchPoints, screenWidth } = hint;
  if (!Number.isFinite(viewportWidth) || viewportWidth < 960 || touchPoints < 1) return false;
  // Ordinary Chrome Android mobile mode contains 'Android'; desktop request impersonates desktop Linux.
  if (!/Chrome\/\d+/i.test(userAgent) || /Android|iPhone|iPad|Mobile/i.test(userAgent)) return false;
  // 980px virtual viewport is typical on phones. Also account for larger virtual viewports
  // on small touch devices, while not forcing modern mode on desktop touchscreen monitors.
  return viewportWidth < 1100 || (screenWidth > 0 && screenWidth < 800);
}

/**
 * Desktop-only data grids remain available on narrow Windows/PC viewports.
 * Do not infer the physical device solely from CSS pixels (Windows DPI zoom).
 * On Android Chrome Desktop Site the desktop UA can be spoofed; its touch hint
 * is supplied by detectChromeDesktopSiteOnTouchDevice above.
 * @param {{userAgent: string, chromeDesktopSite: boolean, isDesktopRuntime: boolean}} params
 */
export function canUsePcQuickEdit({ userAgent, chromeDesktopSite, isDesktopRuntime }) {
  if (isDesktopRuntime) return true; // Explicit installed Windows desktop shell.
  if (chromeDesktopSite) return false;
  return !/Android|iPhone|iPad|Mobile/i.test(userAgent || '');
}
