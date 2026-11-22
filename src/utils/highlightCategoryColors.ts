/**
 * HNL QLTC — floor-wide, display-only color key for Highlight categories.
 * A main-category key and a child (parent+name) key share one color pool.
 * Stable across device reloads and room order changes; no Firestore writes.
 */
import type { RoomProgressItem } from '../types';
import { getDirectHighlightCategoryNames, getDirectStageCategory } from './floorHighlightDirectShapes.ts';

export const HIGHLIGHT_CATEGORY_SWATCHES = [
  '#2563eb', '#e11d48', '#16a34a', '#9333ea', '#f59e0b', '#0891b2',
  '#be185d', '#c2410c', '#0d9488', '#a21caf', '#65a30d', '#b45309',
  '#4f46e5', '#dc2626', '#047857', '#7c3aed', '#d97706', '#0e7490',
  '#a855f7', '#f97316', '#3f6212', '#b91c1c', '#0369a1', '#a16207',
] as const;

export type FloorHighlightColorEntry = {
  key: string;
  kind: 'main' | 'child';
  category: string;
  name: string;
  color: string;
  hasGeometry: boolean;
};

export const mainHighlightColorKey = (category: string) => JSON.stringify(['main', category]);
export const childHighlightColorKey = (category: string, name: string) => JSON.stringify(['child', category, name]);
type MutableEntry = Omit<FloorHighlightColorEntry, 'color'> & { preferences: Set<string> };
const validHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

/** Different labels on the same floor never share a swatch; a label is stable across rooms. */
export function buildFloorHighlightColorLegend(rooms: ReadonlyArray<RoomProgressItem>): {
  entries: FloorHighlightColorEntry[];
  colors: Record<string, string>;
} {
  const registry = new Map<string, MutableEntry>();
  const add = (kind: 'main' | 'child', category: string, name: string) => {
    const key = kind === 'main' ? mainHighlightColorKey(category) : childHighlightColorKey(category, name);
    let item = registry.get(key);
    if (!item) {
      item = { key, kind, category, name, hasGeometry: false, preferences: new Set() };
      registry.set(key, item);
    }
    return item;
  };
  for (const room of rooms) {
    for (const category of getDirectHighlightCategoryNames(room)) {
      const entry = add('main', category, category);
      if (room.categoryHighlightShapes?.[category]?.length || room.categoryHighlightRegions?.[category])
        entry.hasGeometry = true;
    }
    for (const stage of room.subItems || []) {
      const category = getDirectStageCategory(stage, room);
      const name = stage.name?.trim() || stage.id;
      const entry = add('child', category, name);
      if (stage.highlightShapes?.length || stage.highlightRegions?.length) entry.hasGeometry = true;
      // Preserve the user's saved stage color where it does not collide with
      // another displayed label; collisions are solved in UI only.
      if (stage.highlightColor && validHexColor(stage.highlightColor))
        entry.preferences.add(stage.highlightColor.toLowerCase());
    }
  }
  const ordered = [...registry.values()].sort((a, b) =>
    (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1) ||
    a.category.localeCompare(b.category, 'vi') ||
    a.name.localeCompare(b.name, 'vi') ||
    a.key.localeCompare(b.key, 'vi')
  );
  const used = new Set<string>();
  const byKey = new Map<string, string>();
  // Reserve explicit saved custom colors first, so automatic entries cannot
  // steal them. If two custom values collide, keep one and resolve the other.
  for (const entry of ordered) {
    const custom = [...entry.preferences].sort().find(color => !used.has(color));
    if (custom) {
      byKey.set(entry.key, custom);
      used.add(custom);
    }
  }
  let paletteIndex = 0, overflowIndex = 0;
  for (const entry of ordered) {
    if (byKey.has(entry.key)) continue;
    while (paletteIndex < HIGHLIGHT_CATEGORY_SWATCHES.length &&
      used.has(HIGHLIGHT_CATEGORY_SWATCHES[paletteIndex].toLowerCase())) paletteIndex++;
    const color = paletteIndex < HIGHLIGHT_CATEGORY_SWATCHES.length
      ? HIGHLIGHT_CATEGORY_SWATCHES[paletteIndex++]
      : `hsl(${Math.round((overflowIndex++ * 137.508 + 17) % 360)} 75% 40%)`;
    byKey.set(entry.key, color);
    used.add(color.toLowerCase());
  }
  const entries: FloorHighlightColorEntry[] = ordered.map(({preferences: _preferences, ...rest}) => ({
    ...rest, color: byKey.get(rest.key) || '#2563eb',
  }));
  const colors: Record<string, string> = {};
  for (const entry of entries) colors[entry.key] = entry.color;
  return { entries, colors };
}
