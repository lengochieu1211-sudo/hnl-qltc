import { getCurrentRealFirebaseUser } from './firebase';

const OFFLINE_MIRROR_PREFIX = 'hnl_project_offline_mirror_v1';

function currentUid(): string {
  try {
    return getCurrentRealFirebaseUser()?.uid || 'signed-out';
  } catch (_) {
    return 'signed-out';
  }
}

function enabledKey(projectId: string, uid = currentUid()): string {
  return `${OFFLINE_MIRROR_PREFIX}:enabled:${uid}:${projectId}`;
}

function lastSyncKey(projectId: string, uid = currentUid()): string {
  return `${OFFLINE_MIRROR_PREFIX}:last-sync:${uid}:${projectId}`;
}

export function isProjectOfflineMirrorEnabled(projectId: string): boolean {
  if (!projectId || currentUid() === 'signed-out' || typeof localStorage === 'undefined') return false;
  return localStorage.getItem(enabledKey(projectId)) === 'true';
}

export function setProjectOfflineMirrorEnabled(projectId: string, enabled: boolean): void {
  if (!projectId || currentUid() === 'signed-out' || typeof localStorage === 'undefined') return;
  if (enabled) localStorage.setItem(enabledKey(projectId), 'true');
  else localStorage.removeItem(enabledKey(projectId));
  try {
    window.dispatchEvent(new CustomEvent('hnl-offline-mirror-setting-changed', { detail: { projectId, enabled } }));
  } catch (_) {}
}

export function getProjectOfflineMirrorLastSyncAt(projectId: string): number {
  if (!projectId || currentUid() === 'signed-out' || typeof localStorage === 'undefined') return 0;
  return Number(localStorage.getItem(lastSyncKey(projectId)) || 0) || 0;
}

export function setProjectOfflineMirrorLastSyncAt(projectId: string, timestamp: number): void {
  if (!projectId || currentUid() === 'signed-out' || typeof localStorage === 'undefined') return;
  if (timestamp > 0) localStorage.setItem(lastSyncKey(projectId), String(timestamp));
}

/**
 * Read-only helper used by the realtime photo listener. It intentionally has no Cloud
 * write side effects; enabling Offline Mirror only changes whether Cloud-ready binary
 * files are prefetched into this authenticated WebView/browser profile.
 */
export function shouldAutoMirrorProjectBinaries(projectId: string): boolean {
  return isProjectOfflineMirrorEnabled(projectId);
}
