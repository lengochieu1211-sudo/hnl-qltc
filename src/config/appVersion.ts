declare const __APP_VERSION__: string;

/** package.json is the canonical release version. Vite injects it at build time. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0-dev';
export const APP_VERSION_LABEL = `V${APP_VERSION} – Firebase-only Migration`;
