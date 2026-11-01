#!/usr/bin/env python3
"""Minimal PROD account-safety port onto DEV after guarded three-way merge."""
from pathlib import Path
import json
import subprocess
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
# Chat is highly transactional: restore exact already-certified DEV Chat core and
# port only the read-only PROD account logout guard. Avoid auto-merged split writes.
c=subprocess.check_output(["git","show","6073580c0d5ebcce1b6669f531d7140c384a78d3:src/lib/chatService.ts"],text=True)
c=once(c,"let chatOutboxFlushPromise: Promise<void> | null = null;\n",
"let chatOutboxFlushPromise: Promise<void> | null = null;\n\n"+guard,
"DEV Chat plus read-only logout guard")
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
# Reconcile PROD CAD/grid and stroke additions with DEV Cloud position locks.
floor=Path("src/components/FloorPlanDefectTab.tsx")
u=floor.read_text("utf8")
import re
u=re.sub(r"readIdSet\(getDraftKey\((['\"])(construction_floorplan_locked_(?:rooms|defects))\1\)\)",
         lambda m:"readLegacyLockedIds('"+m.group(2)+"')",u)
# The DEV snap preview is already declared above; remove only second declaration.
duplicate="  const [objectSnapPreview, setObjectSnapPreview] = useState<RoomSnapCandidate | null>(null);"
if u.count(duplicate)==2:
    pos=u.rfind(duplicate)
    u=u[:pos]+u[pos:].replace(duplicate+"\n","",1)
if "getCadDrawingHotkey" in u and "import { CAD_GRID_STEP, applyCadDrawingGuide, getCadDrawingHotkey }" not in u:
    u=once(u,"import { snapRoomPointOrthogonal } from '../utils/roomHighlightSnap';",
           "import { snapRoomPointOrthogonal } from '../utils/roomHighlightSnap';\nimport { CAD_GRID_STEP, applyCadDrawingGuide, getCadDrawingHotkey } from '../utils/roomHighlightCadShortcuts';",
           "PROD CAD shortcuts import")
if "cadGridVisible" in u and "const [cadGridVisible, setCadGridVisible]" not in u:
    state="""  // PROD CAD function keys; isolated per-project drawing preferences, OFF by default.
  const [cadGridVisible, setCadGridVisible] = useState(() => readSnapPref('room_cad_grid_visible'));
  const [cadGridSnap, setCadGridSnap] = useState(() => readSnapPref('room_cad_grid_snap'));
  const [cadOrtho, setCadOrtho] = useState(() => readSnapPref('room_cad_ortho'));
  const [cadPolar, setCadPolar] = useState(() => readSnapPref('room_cad_polar'));
"""
    u=once(u,"  const [objectSnapMidpoints, setObjectSnapMidpoints] = useState(() => readSnapPref('room_object_snap_midpoints'));\n",
           "  const [objectSnapMidpoints, setObjectSnapMidpoints] = useState(() => readSnapPref('room_object_snap_midpoints'));\n"+state,
           "CAD function-key states")
if "getCadDrawPoint(" in u and "const getCadDrawPoint =" not in u:
    prod=subprocess.check_output(["git","show","1c2b7d663d51d51aa45010e533d8e035e22adf59:src/components/FloorPlanDefectTab.tsx"],text=True)
    i=prod.index("  const getCadDrawPoint =")
    j=prod.index("  const [roomSortBy,",i)
    cad=prod[i:j]
    u=once(u,"  const [roomSortBy,",
           cad+"  const [roomSortBy,","CAD drawing guide function")
if "savedRoomStrokeScale" in u and "const savedRoomStrokeScale =" not in u:
    p="                  const strokeScale = (roomHighlightStrokePercent / 100) / Math.max(1, zoomScale);"
    u=once(u,p,p+"\n                  const savedRoomStrokeScale = roomHighlightStrokePercent / 100;", "saved room stroke pixel width")
for token in ["onCommitPositionLocks", "positionLockBusy", "legacyOnlyLock"]:
    if token not in u:raise RuntimeError("DEV Cloud lock behavior lost: "+token)
for token in ["getCadDrawingHotkey","const getCadDrawPoint =","const savedRoomStrokeScale ="]:
    if token not in u:raise RuntimeError("PROD CAD/stroke feature missing: "+token)
floor.write_text(u,"utf8")

chat.write_text(c,"utf8");app.write_text(s,"utf8")
print(json.dumps({"safeProdOnlyPorts":["desktop account guard","SecurityModal safe account"],"devCloudPositionLocksPreserved":True,"devAtomicChatPreserved":True,"schemaChanged":False}))
