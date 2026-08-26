import { APP_VERSION } from './appVersion';

declare const __BUILD_TIME__: string;
declare const __BUILD_ID__: string;
declare const __GIT_COMMIT__: string;
declare const __APP_ENV__: string;

export type AppEnvironment = 'DEV' | 'PROD';
export type AppPlatform = 'Web' | 'Android' | 'Windows';

function platformFromLocation(): AppPlatform {
  if (typeof window === 'undefined') return 'Web';
  const value = new URLSearchParams(window.location.search).get('app')?.toLowerCase();
  if (value === 'android') return 'Android';
  if (value === 'desktop' || value === 'windows') return 'Windows';
  return 'Web';
}

export const BUILD_METADATA = Object.freeze({
  appVersion: APP_VERSION,
  buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'local',
  gitCommit: typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : 'local',
  buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'local',
  environment: ((typeof __APP_ENV__ === 'string' ? __APP_ENV__ : 'DEV').toUpperCase() === 'PROD' ? 'PROD' : 'DEV') as AppEnvironment,
});

export function getRuntimeBuildMetadata() {
  return { ...BUILD_METADATA, platform: platformFromLocation() };
}
