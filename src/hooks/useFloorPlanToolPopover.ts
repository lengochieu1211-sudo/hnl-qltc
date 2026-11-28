import { useLayoutEffect, useState } from 'react';
import { placeFloorPlanDisplayPopover } from '../utils/floorPlanDisplayPopover';

/** UI-only popover coordinates inside the floor viewport; never changes plan geometry. */
type Position = { left: number; top: number; width: number; maxHeight: number };
export function useFloorPlanToolPopover(
  active: boolean, isFullscreen: boolean, imageContainer: HTMLElement | null,
  triggerSelector: string, preferredWidth: number, heightFraction: number,
): Position | undefined {
  const [position, setPosition] = useState<Position>();
  useLayoutEffect(() => {
    if (!active || !isFullscreen) { setPosition(undefined); return; }
    const viewport = imageContainer?.closest<HTMLElement>('[data-hnl-pc-plan-viewport]');
    const trigger = viewport?.querySelector<HTMLElement>(triggerSelector);
    if (!viewport || !trigger) { setPosition(undefined); return; }
    const update = () => {
      const view = viewport.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const base = placeFloorPlanDisplayPopover(anchor, view);
      const width = Math.min(preferredWidth, Math.max(0, view.width - 16));
      const left = Math.max(8, Math.min(view.width - width - 8, anchor.right - view.left - width));
      const maxHeight = Math.max(64, Math.min(view.height * heightFraction, view.height - base.top - 12));
      const next = { left, top: base.top, width, maxHeight };
      setPosition(previous => previous && Object.keys(next).every(k =>
        previous[k as keyof Position] === next[k as keyof Position]) ? previous : next);
    };
    update();
    const toolbar = viewport.querySelector<HTMLElement>('[data-hnl-ios-fullscreen-toolbar]');
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(viewport);
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, isFullscreen, imageContainer, triggerSelector, preferredWidth, heightFraction]);
  return position;
}
