/** Safe, project-shared presentation option; legacy configs default to off. */
export type FestivalEffectMode = 'off' | 'snow' | 'apricot' | 'peach' | 'blossoms' | 'fireworks';

const MODES: readonly FestivalEffectMode[] = ['off', 'snow', 'apricot', 'peach', 'blossoms', 'fireworks'];
export function normalizeFestivalEffectMode(raw: unknown): FestivalEffectMode {
  return typeof raw === 'string' && MODES.includes(raw as FestivalEffectMode)
    ? raw as FestivalEffectMode : 'off';
}

/** Windows EXE or a genuine PC browser, never Android's emulated desktop view. */
export function isFestivalPcRuntime(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
  const installedDesktop = new URLSearchParams(window.location.search).get('app') === 'desktop';
  return installedDesktop || window.innerWidth >= 1024;
}
