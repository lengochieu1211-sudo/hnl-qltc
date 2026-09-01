from pathlib import Path


def rep(path, old, new, label, count=1):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    found = s.count(old)
    if found < count:
        raise SystemExit(f'{label}: expected >= {count}, found {found}')
    p.write_text(s.replace(old, new, count), encoding='utf-8')
    print('patched', label)

rep('src/utils/securityUtils.ts',
    "export function savePinLockConfig(config: PinLockConfig): void {\n  localStorage.setItem(PIN_LOCK_STORAGE_KEY, JSON.stringify(config));\n}\n",
    "export function savePinLockConfig(config: PinLockConfig): void {\n  localStorage.setItem(PIN_LOCK_STORAGE_KEY, JSON.stringify(config));\n}\n\nconst REMOTE_PIN_RESET_PREFIX = 'construction_pin_remote_reset_epoch_';\n\nexport function applyRemotePinReset(epoch: number, email?: string | null): boolean {\n  const normalizedEmail = String(email || '').trim().toLowerCase();\n  const nextEpoch = Number(epoch || 0);\n  if (!normalizedEmail || !Number.isFinite(nextEpoch) || nextEpoch <= 0) return false;\n  const key = `${REMOTE_PIN_RESET_PREFIX}${normalizedEmail}`;\n  const applied = Number(localStorage.getItem(key) || 0);\n  if (nextEpoch <= applied) return false;\n  const current = getStoredPinLockConfig();\n  savePinLockConfig({ ...current, enabled: false, pinHash: undefined, pinSalt: undefined, pinOwnerUid: undefined, pinOwnerEmail: undefined });\n  localStorage.setItem(key, String(nextEpoch));\n  return true;\n}\n",
    'security remote reset helper')

rep('src/lib/firebase.ts',
    "  isOwner?: boolean;\n  // `verified` means Firestore answered authoritatively",
    "  isOwner?: boolean;\n  pinResetEpoch?: number;\n  // `verified` means Firestore answered authoritatively",
    'role info reset epoch')

rep('src/lib/firebase.ts',
    "return { allowed: true, role, isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: role === 'ADMIN', verification: 'verified' };",
    "return { allowed: true, role, isCloudSynced: true, ownerUid: pOwnerUid, ownerEmail: pOwnerEmail, isOwner: role === 'ADMIN', pinResetEpoch: Number(mData?.pinResetEpoch || 0), verification: 'verified' };",
    'role fetch carries reset epoch')

marker = "/**\n * Add or update project member in Cloud by email/UID\n */\nexport async function saveProjectMemberToCloud("
insert = """/**
 * SUPER ADMIN remote PIN invalidation. PIN/hash never leaves the device.
 */
export async function requestProjectMemberPinReset(projectId: string, memberEmail: string, reason = 'SUPER ADMIN remote reset'): Promise<number> {
  const actor = getCurrentRealFirebaseUser();
  const normalizedEmail = normalizeEmail(memberEmail);
  if (!actor || !isSuperAdminEmail(actor.email)) throw new Error('Chỉ SUPER ADMIN được reset PIN từ xa.');
  if (!projectId || !normalizedEmail) throw new Error('Thiếu project hoặc email user cần reset PIN.');
  const memberRef = doc(db, 'projects', projectId, 'members', normalizedEmail);
  const memberSnap = await getDocFromServer(memberRef);
  if (!memberSnap.exists()) throw new Error('User chưa có member record trong dự án này.');
  const epoch = Date.now();
  await setDoc(memberRef, {
    pinResetEpoch: epoch,
    pinResetByUid: actor.uid,
    pinResetByEmail: normalizeEmail(actor.email),
    pinResetReason: String(reason || '').slice(0, 240),
    updatedAt: epoch,
  }, { merge: true });
  await saveProjectAuditLog(projectId, {
    timestamp: epoch,
    action: 'SECURITY_CONFIG_CHANGE',
    description: `SUPER ADMIN yêu cầu reset PIN từ xa cho ${normalizedEmail}`,
    details: `Remote PIN reset: ${normalizedEmail}`,
    module: 'security',
    syncStatus: 'PENDING',
  }).catch(() => {});
  return epoch;
}

export function subscribeCurrentUserPinResetRealtime(projectId: string, user: User, onResetEpoch: (epoch: number) => void): () => void {
  const email = normalizeEmail(user?.email);
  if (!projectId || !email) return () => {};
  return onSnapshot(doc(db, 'projects', projectId, 'members', email), (snap) => {
    if (!snap.exists()) return;
    const epoch = Number(snap.data()?.pinResetEpoch || 0);
    if (Number.isFinite(epoch) && epoch > 0) onResetEpoch(epoch);
  }, (err) => console.warn('Remote PIN reset subscription warning:', err));
}

/**
 * Add or update project member in Cloud by email/UID
 */
export async function saveProjectMemberToCloud("""
rep('src/lib/firebase.ts', marker, insert, 'firebase remote reset API')

rep('src/App.tsx',
    "import { getStoredPinLockConfig, logAuditAction, getCurrentUserRole, setCurrentUserRole, UserRole,",
    "import { getStoredPinLockConfig, applyRemotePinReset, logAuditAction, getCurrentUserRole, setCurrentUserRole, UserRole,",
    'App security imports')
rep('src/App.tsx',
    "fetchProjectUserRoleFromCloud, subscribeProjectUserRoleRealtime, fetchCurrentUserProjectsFromCloud,",
    "fetchProjectUserRoleFromCloud, subscribeProjectUserRoleRealtime, subscribeCurrentUserPinResetRealtime, signOutGoogle, fetchCurrentUserProjectsFromCloud,",
    'App firebase imports')
rep('src/App.tsx',
    "    let isMounted = true;\n    let roleUnsub: (() => void) | null = null;\n",
    "    let isMounted = true;\n    let roleUnsub: (() => void) | null = null;\n    let pinResetUnsub: (() => void) | null = null;\n",
    'App reset unsubscribe state')
rep('src/App.tsx',
    "      if (roleUnsub) { roleUnsub(); roleUnsub = null; }\n      const realUser = getCurrentRealFirebaseUser();",
    "      if (roleUnsub) { roleUnsub(); roleUnsub = null; }\n      if (pinResetUnsub) { pinResetUnsub(); pinResetUnsub = null; }\n      const realUser = getCurrentRealFirebaseUser();",
    'App listener reset cleanup')
rep('src/App.tsx',
    "      rememberVerifiedAuthIdentity(realUser);\n      roleUnsub = subscribeProjectUserRoleRealtime(activeProjectId, realUser, (res) => {",
    "      rememberVerifiedAuthIdentity(realUser);\n      pinResetUnsub = subscribeCurrentUserPinResetRealtime(activeProjectId, realUser, (epoch) => {\n        if (!isMounted || !applyRemotePinReset(epoch, realUser.email)) return;\n        setIsAppLocked(false);\n        logAuditAction('SECURITY_CONFIG_CHANGE', `PIN local đã bị SUPER ADMIN reset từ xa (${realUser.email || realUser.uid})`, activeProjectId);\n        window.setTimeout(() => {\n          alert('SUPER ADMIN đã đặt lại mã PIN trên tài khoản này.\\n\\nPIN cũ đã bị vô hiệu hóa. Vui lòng đăng nhập Google lại và tạo PIN mới trong Bảo mật.');\n          void signOutGoogle();\n        }, 0);\n      });\n      roleUnsub = subscribeProjectUserRoleRealtime(activeProjectId, realUser, (res) => {",
    'App attach reset subscription')

p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
cleanup = "      if (roleUnsub) roleUnsub();"
if cleanup in s:
    s = s.replace(cleanup, "      if (pinResetUnsub) pinResetUnsub();\n      if (roleUnsub) roleUnsub();", 1)
p.write_text(s, encoding='utf-8')

rep('src/components/SecurityModal.tsx',
    "import { formatDateTime } from '../utils/dateFormatter';\n",
    "import { formatDateTime } from '../utils/dateFormatter';\nimport { isSuperAdminEmail } from '../config/superAdmin';\n",
    'SecurityModal superadmin import')
rep('src/components/SecurityModal.tsx',
    "          assignedAt: Number(m.assignedAt || m.updatedAt || Date.now()),\n",
    "          assignedAt: Number(m.assignedAt || m.updatedAt || Date.now()),\n          pinResetEpoch: Number(m.pinResetEpoch || 0),\n",
    'SecurityModal member reset metadata')
rep('src/components/SecurityModal.tsx',
    "  const canManageProjectMembers = canManageMembers(currentRole);\n",
    "  const canManageProjectMembers = canManageMembers(currentRole);\n  const isCompanySuperAdmin = isSuperAdminEmail(cloudUser?.email);\n",
    'SecurityModal superadmin flag')
anchor = "  const handleExportLogs = () => {\n    void handleExportLogsSafe();\n  };\n\n"
handler = """  const handleRemotePinReset = async (email: string) => {
    if (!isCompanySuperAdmin) return;
    const ok = await confirmAsync({ title: 'Reset PIN từ xa?', message: `PIN cũ của ${email} sẽ bị vô hiệu khi thiết bị online. User sẽ phải đăng nhập Google lại trước khi tiếp tục.`, confirmText: 'Reset PIN', cancelText: 'Hủy', tone: 'danger' });
    if (!ok) return;
    setMemberMsg(null);
    try {
      const { requestProjectMemberPinReset } = await import('../lib/firebase');
      const epoch = await requestProjectMemberPinReset(selectedPid, email);
      setMemberMsg({ type: 'success', text: `Đã gửi lệnh reset PIN từ xa cho ${email} (${formatDateTime(epoch)}).` });
    } catch (err: any) {
      setMemberMsg({ type: 'error', text: `Không reset được PIN: ${err?.message || err}` });
    }
  };

  const handleExportLogs = () => {
    void handleExportLogsSafe();
  };

"""
rep('src/components/SecurityModal.tsx', anchor, handler, 'SecurityModal reset handler')
rep('src/components/SecurityModal.tsx',
    "                        {canManageProjectMembers && <button\n                          type=\"button\"\n                          onClick={() => handleRemoveMemberSafe(m.email)}",
    "                        {isCompanySuperAdmin && <button type=\"button\" onClick={() => void handleRemotePinReset(m.email)} className=\"mr-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-[9px] font-extrabold whitespace-nowrap\" title=\"Vô hiệu hóa PIN local của user khi thiết bị online\">Reset PIN</button>}\n                        {canManageProjectMembers && <button\n                          type=\"button\"\n                          onClick={() => handleRemoveMemberSafe(m.email)}",
    'SecurityModal reset button')

print('remote PIN reset patch complete')
