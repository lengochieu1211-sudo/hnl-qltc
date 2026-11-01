#!/usr/bin/env python3
"""Minimal PROD account-safety port onto DEV after guarded three-way merge."""
from pathlib import Path
import json
app=Path("src/App.tsx")
chat=Path("src/lib/chatService.ts")
s=app.read_text("utf8")
c=chat.read_text("utf8")
def once(text,needle,replacement,label):
    if text.count(needle)!=1: raise RuntimeError(label+": expected one anchor, found "+str(text.count(needle)))
    return text.replace(needle,replacement,1)
# DEV atomic Chat and Cloud position locks are newer than PROD; never replace.
anchor="async function commitProjectMessage("
if anchor not in c or "let chatOutboxFlushPromise: Promise<void> | null = null;" not in c:
    raise RuntimeError("Unexpected Chat core")
guard="""// PROD account safety: fail closed for pending Chat writes or unreadable outbox.
export async function hasPendingChatOutboxForCurrentUser(): Promise<boolean> {
  const uid = getCurrentRealFirebaseUser()?.uid;
  if (!uid || chatOutboxFlushPromise) return true;
  try {
    const rows = await listChatOutbox();
    if (getCurrentRealFirebaseUser()?.uid !== uid) return true;
    return rows.some((row) => row.id.startsWith(uid + '_'));
  } catch {
    return true;
  }
}

"""
# Merge may have independently imported the older PROD helper. Replace only
# that small helper with the DEV-compatible fail-closed version, not Chat core.
if "export async function hasPendingChatOutboxForCurrentUser" in c:
    a=c.index("export async function hasPendingChatOutboxForCurrentUser")
    b=c.index(anchor,a)
    c=c[:a]+guard+c[b:]
else:
    c=once(c,anchor,guard+anchor,"Chat guard insertion")
if "import { hasPendingChatOutboxForCurrentUser }" not in s:
    s=once(s,
"import { REALTIME_STATE_KEYS, STATE_KEY_TO_CLOUD_NAME } from './config/realtimeCollections';",
"import { REALTIME_STATE_KEYS, STATE_KEY_TO_CLOUD_NAME } from './config/realtimeCollections';\nimport { hasPendingChatOutboxForCurrentUser } from './lib/chatService';",
"Chat guard import")
if "const [securityModalEntryPoint, setSecurityModalEntryPoint]" not in s:
    s=once(s,
"  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);",
"  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);\n  const [securityModalEntryPoint, setSecurityModalEntryPoint] = useState<'account' | 'switch' | 'rbac' | 'pin'>('pin');",
"securityModalEntryPoint")
insert="""  // Safeguard signout against uncommitted Firestore, media or Chat work.
  const desktopAccountHasPendingSync = !cloudInitialReady
    || firestorePendingWriteCount > 0
    || syncDiagnosticPendingData > 0
    || syncDiagnosticPendingMetadata > 0
    || Number(photoCloudStatus.pending || 0) > 0
    || floorPlanImageSyncPendingRef.current.size > 0
    || floorPlanImageSyncInFlightRef.current.size > 0;
  const handleDesktopAccountSignOut = async () => {
    if (!isOnline || desktopAccountHasPendingSync || await hasPendingChatOutboxForCurrentUser()) {
      alert('Không thể đăng xuất khi đang ngoại tuyến hoặc còn dữ liệu (kể cả tin nhắn Chat) chờ đồng bộ. Hãy kết nối mạng và đợi đồng bộ hoàn tất.');
      return;
    }
    await signOutGoogle();
  };
  const handleDesktopLockNow = () => {
    if (getStoredPinLockConfig().enabled) setIsAppLocked(true);
    else {
      setSecurityModalEntryPoint('pin');
      setIsSecurityModalOpen(true);
    }
  };

"""
if "const handleDesktopAccountSignOut" not in s:
    s=once(s,"  const hasExcelExport = ['warehouse', 'volume', 'floorplan', 'checklist', 'crew'].includes(activeTab);\n",
"  const hasExcelExport = ['warehouse', 'volume', 'floorplan', 'checklist', 'crew'].includes(activeTab);\n"+insert,
"safe account helpers")
if "onSignOut={handleDesktopAccountSignOut}" not in s:
    s=once(s,
"""            showChecklist={showChecklistModule}
            showAi={HNL_AI_ENABLED}
            showSuperAdmin={isCurrentSuperAdmin}
          />""",
"""            showChecklist={showChecklistModule}
            showAi={HNL_AI_ENABLED}
            showSuperAdmin={isCurrentSuperAdmin}
            userRole={currentUserRole}
            roleResolved={isProjectRoleResolved && projectRoleAllowed}
            online={isOnline}
            hasPendingSync={desktopAccountHasPendingSync}
            onOpenAccount={(section) => {
              setSecurityModalEntryPoint(section);
              setIsSecurityModalOpen(true);
            }}
            onLockNow={handleDesktopLockNow}
            onSignOut={handleDesktopAccountSignOut}
          />""",
"desktop account props")
if "onSafeAccountSignOut={handleDesktopAccountSignOut}" not in s:
    s=once(s,
"""        <SecurityModal
          isOpen={isSecurityModalOpen}
          onClose={() => setIsSecurityModalOpen(false)}
          onLockNow={() => setIsAppLocked(true)}""",
"""        <SecurityModal
          isOpen={isSecurityModalOpen}
          onClose={() => {
            setIsSecurityModalOpen(false);
            setSecurityModalEntryPoint('pin');
          }}
          entryPoint={securityModalEntryPoint}
          onSafeAccountSignOut={handleDesktopAccountSignOut}
          signOutBlocked={!isOnline || desktopAccountHasPendingSync}
          onLockNow={() => setIsAppLocked(true)}""",
"SecurityModal props")
for token in ["commitPositionLocksOnCloud","handleCommitPositionLocks","onCommitPositionLocks={handleCommitPositionLocks}"]:
    if token not in s:raise RuntimeError("Lost DEV Cloud position-lock core: "+token)
for token in ["writeBatch","batch.commit()","blockChatOutbox","getDocFromServer"]:
    if token not in c:raise RuntimeError("Lost DEV atomic Chat/outbox guarantee: "+token)
chat.write_text(c,"utf8");app.write_text(s,"utf8")
print(json.dumps({"safeProdOnlyPorts":["desktop account guard","SecurityModal safe account"],"devCloudPositionLocksPreserved":True,"devAtomicChatPreserved":True,"schemaChanged":False}))
