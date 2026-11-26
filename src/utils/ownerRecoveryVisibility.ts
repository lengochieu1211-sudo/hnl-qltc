/** Visibility only. Firestore Rules and claimProjectOwnership remain authoritative. */
export interface OwnerRecoveryRole {
  allowed: boolean;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  isCloudSynced: boolean;
  ownerUid?: string;
  ownerEmail?: string;
  isOwner?: boolean;
  verification: 'verified' | 'unavailable';
  projectDeleted?: boolean;
}
export interface OwnerRecoverySnapshot {
  projectId: string;
  uid: string;
  email: string;
  info: OwnerRecoveryRole;
}
const normalize = (value?: string) => String(value || '').trim().toLowerCase();
export function shouldShowOwnerRecovery(
  snapshot: OwnerRecoverySnapshot | null,
  selectedProjectId: string,
  user: { uid?: string; email?: string | null } | null,
  online: boolean,
  checking: boolean,
): boolean {
  const email = normalize(user?.email || '');
  if (!online || checking || !snapshot || !selectedProjectId || !user?.uid || !email ||
      snapshot.projectId !== selectedProjectId || snapshot.uid !== user.uid ||
      normalize(snapshot.email) !== email) return false;
  const info = snapshot.info;
  if (info.verification !== 'verified' || info.projectDeleted) return false;
  const ownerEmail = normalize(info.ownerEmail);
  const ownerUid = String(info.ownerUid || '');
  // Email-linked owner with an old UID can repair the UID under existing Rules.
  // A verified normal ADMIN, EDITOR or VIEWER needs no recovery prompt.
  if (ownerEmail === email && ownerUid && ownerUid !== user.uid &&
      info.allowed && info.role === 'ADMIN' && info.isOwner) return true;
  // The authoritative role reader returns unsynced/denied only for a missing
  // root or a genuinely unowned project after checking direct member documents.
  // An explicit or inactive member is synced, so cannot see this prompt.
  return !ownerUid && !ownerEmail && !info.allowed && !info.isCloudSynced && !info.isOwner;
}
