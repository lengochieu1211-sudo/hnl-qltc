/**
 * DEV BACKUP mobile sign-in transport only. The backup Firebase Hosting website is
 * reachable at both web.app and firebaseapp.com, but its Auth SDK uses the latter as
 * authDomain. On mobile browsers with partitioned third-party storage, using web.app
 * as the page origin causes signInWithRedirect to return with no credential.
 *
 * Keep Firebase project, Auth configuration, OAuth provider, data and authorization
 * rules untouched: relay a *user-initiated* login to the same project's first-party
 * firebaseapp.com Hosting origin, where the existing redirect flow is supported.
 * The one-shot resume marker is removed before the OAuth navigation to prevent loops.
 */
export const BACKUP_MOBILE_LOGIN_RESUME_KEY = '_hnl_backup_google_login';

export type BackupAuthEnvironment = {
  appEnvironment: string;
  devTarget: string;
  projectId: string;
  authDomain: string;
};

const BACKUP_WEB_ORIGIN = 'https://hnl-qltc-dev-backup.web.app';
const BACKUP_AUTH_ORIGIN = 'https://hnl-qltc-dev-backup.firebaseapp.com';

function isExpectedBackupAuthEnvironment(config: BackupAuthEnvironment): boolean {
  return config.appEnvironment === 'DEV'
    && config.devTarget === 'backup'
    && config.projectId === 'hnl-qltc-dev-backup'
    && config.authDomain === 'hnl-qltc-dev-backup.firebaseapp.com';
}

export function getBackupMobileLoginHandoffUrl(
  currentUrl: string,
  config: BackupAuthEnvironment,
): string | null {
  if (!isExpectedBackupAuthEnvironment(config)) return null;
  let current: URL;
  try { current = new URL(currentUrl); } catch { return null; }
  if (current.origin !== BACKUP_WEB_ORIGIN) return null;

  const next = new URL(current.href);
  next.host = 'hnl-qltc-dev-backup.firebaseapp.com';
  next.searchParams.set(BACKUP_MOBILE_LOGIN_RESUME_KEY, '1');
  return next.href;
}

export function getBackupMobileLoginResumeCleanUrl(
  currentUrl: string,
  config: BackupAuthEnvironment,
): string | null {
  if (!isExpectedBackupAuthEnvironment(config)) return null;
  let current: URL;
  try { current = new URL(currentUrl); } catch { return null; }
  if (current.origin !== BACKUP_AUTH_ORIGIN || current.searchParams.get(BACKUP_MOBILE_LOGIN_RESUME_KEY) !== '1') {
    return null;
  }
  current.searchParams.delete(BACKUP_MOBILE_LOGIN_RESUME_KEY);
  return current.href;
}
