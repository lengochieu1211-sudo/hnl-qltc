/** P21.6: deliberately isolated room cutover rehearsal, NEVER for live DEV or PROD.
 * A flag alone must not turn on any new writer. Fail closed for non-loopback hosts.
 */
import { APP_ENVIRONMENT, FIREBASE_EMULATOR_ENABLED, FIREBASE_EMULATOR_PROJECT_ID, FIREBASE_EMULATOR_HOST } from './firebaseBase';

const optedIn = String((import.meta as any).env?.VITE_P21_ROOM_SIDECAR_DEMO || '') === 'P21_LOCAL_EMULATOR_ONLY';
const safe = APP_ENVIRONMENT === 'DEV' && FIREBASE_EMULATOR_ENABLED &&
  FIREBASE_EMULATOR_PROJECT_ID.startsWith('demo-') &&
  ['localhost', '127.0.0.1', '::1'].includes(FIREBASE_EMULATOR_HOST);
if (optedIn && !safe) throw new Error('P21_ROOM_SIDECAR_REFUSES_NONLOCAL_OR_PROD_FIREBASE');
export const ROOM_SIDECAR_DEMO_MODE = optedIn && safe;
