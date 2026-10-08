/** UI-only HNL palette. Does not change persisted settings or business/status colors. */
type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_SURFACE: Rgb = [15, 23, 42];
const DEFAULT_PRIMARY = '#2563eb';

const toRgb = (hex: string): Rgb => {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_PRIMARY;
  return [parseInt(safe.slice(1, 3), 16), parseInt(safe.slice(3, 5), 16), parseInt(safe.slice(5, 7), 16)];
};
const toHex = (rgb: Rgb): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];
const luminance = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map((c) => {
    const channel = c / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};
export const hnlContrastRatio = (a: string, b: string): number => {
  const aLum = luminance(toRgb(a));
  const bLum = luminance(toRgb(b));
  return (Math.max(aLum, bLum) + 0.05) / (Math.min(aLum, bLum) + 0.05);
};
const readableShade = (color: Rgb, target: Rgb, backgrounds: string[]): string => {
  // 4.5:1 WCAG AA for normal text, including tiny navigation labels.
  for (let step = 0; step <= 100; step++) {
    const candidate = toHex(mix(color, target, step / 100));
    if (backgrounds.every((background) => hnlContrastRatio(candidate, background) >= 4.56)) return candidate;
  }
  return toHex(target);
};

export const getHnlPrimaryThemeColors = (input: string) => {
  const primary = /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : DEFAULT_PRIMARY;
  const custom = primary !== DEFAULT_PRIMARY;
  const lightSelectedBackground = toHex(mix(WHITE, toRgb(primary), 0.08));
  const action = custom ? readableShade(toRgb(primary), BLACK, ['#ffffff', lightSelectedBackground]) : DEFAULT_PRIMARY;
  const lightText = custom ? action : DEFAULT_PRIMARY;
  const darkSelectedBackground = toHex(mix(DARK_SURFACE, toRgb(primary), 0.24));
  const darkText = custom ? readableShade(toRgb(primary), WHITE, ['#0f172a', darkSelectedBackground]) : '#93c5fd';
  const hover = custom ? toHex(mix(toRgb(action), BLACK, 0.15)) : '#1d4ed8';
  return { primary, action, hover, lightText, darkText, custom };
};
