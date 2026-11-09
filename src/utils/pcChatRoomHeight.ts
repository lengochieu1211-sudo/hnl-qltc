/**
 * Desktop Chat room height: viewport bottom minus measured room top and a small
 * safe margin. This helper has no Firebase, auth, storage or layout side effects.
 * The mobile Chat height remains on its original VisualViewport calculation.
 */
export function calculatePcChatRoomHeight(visibleViewportBottom: number, roomTop: number): number {
  if (!Number.isFinite(visibleViewportBottom) || !Number.isFinite(roomTop)) return 240;
  return Math.max(240, Math.floor(visibleViewportBottom - roomTop - 12));
}
