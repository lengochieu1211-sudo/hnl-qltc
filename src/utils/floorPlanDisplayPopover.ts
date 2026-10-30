/** Keep the fullscreen display menu under its trigger and inside the plan viewport.
 * Screen-pixel geometry only; this never touches floor or room coordinates. */
export function placeFloorPlanDisplayPopover(
  trigger: { right: number; bottom: number },
  viewport: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number; maxHeight: number } {
  const padding = 8;
  const width = Math.min(304, Math.max(0, viewport.width - padding * 2));
  const left = Math.max(padding, Math.min(viewport.width - width - padding, trigger.right - viewport.left - width));
  const top = Math.max(padding, Math.min(viewport.height - 80, trigger.bottom - viewport.top + 8));
  const maxHeight = Math.max(64, Math.min(Math.floor(viewport.height * 0.34), viewport.height - top - 12));
  return { left, top, width, maxHeight };
}
