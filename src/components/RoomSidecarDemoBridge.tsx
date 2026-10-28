import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import type { RoomProgressItem } from '../types';
import type { RoomSidecarDefinition, RoomSidecarProgress } from '../utils/roomSidecarProgressSafety';
import { overlayMigratedRoomSubItems } from '../utils/roomSidecarProgressSafety';
import { planDemoRoomSidecarSave } from '../utils/roomSidecarDemoSaveSafety';
import { ROOM_SIDECAR_DEMO_MODE } from '../lib/roomSidecarDemoMode';
import { updateMigratedRoomSubItemsProgressAtomic } from '../lib/roomSidecarProgressCloud';
import { db } from '../lib/firebase';
import { RoomHighlightModal } from './RoomHighlightModal';

type Props = React.ComponentProps<typeof RoomHighlightModal> & { projectId: string };
type Verified = {
  key: string;
  room: RoomProgressItem;
  progress: RoomSidecarProgress[];
  definitions: RoomSidecarDefinition[];
};

/** Rehearsal only: server verified read, complete overlay, atomic CAS save.
 * A migrated room is never shown for editing from unverified cached legacy data.
 * Other device changes between load/save are rejected by transaction revision checks.
 */
export function RoomSidecarDemoBridge({ projectId, ...props }: Props) {
  const migrated = ROOM_SIDECAR_DEMO_MODE && props.isOpen && props.roomItem?.subItemProgressMigrated === true;
  const key = `${projectId}/${props.roomItem?.id || ''}`;
  const [verified, setVerified] = useState<Verified | null>(null);
  const [loadError, setLoadError] = useState('');
  const saveLock = useRef(false);
  const roomId = props.roomItem?.id;
  useEffect(() => {
    let cancelled = false;
    setVerified(null);
    setLoadError('');
    saveLock.current = false;
    if (!migrated || !roomId) return;
    if (!projectId || !projectId.trim() || !roomId.trim() ||
        [projectId,roomId].some(v => v.includes('/') || v === '.' || v === '..')) {
      setLoadError('ROOM_SIDECAR_INVALID_ID');
      return;
    }
    (async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('ROOM_SIDECAR_REQUIRES_ONLINE');
        const base = ['projects', projectId, 'rooms', roomId] as const;
        const [roomSnap, p, d] = await Promise.all([
          getDocFromServer(doc(db, ...base)),
          getDocsFromServer(collection(db, ...base, 'subitem_progress')),
          getDocsFromServer(collection(db, ...base, 'subitem_definitions')),
        ]);
        if (!roomSnap.exists() || roomSnap.data().subItemProgressMigrated !== true ||
            roomSnap.data().deleted === true || roomSnap.data().deletedAt != null)
          throw new Error('ROOM_SIDECAR_SERVER_MARKER_MISSING');
        const source = { ...roomSnap.data(), id: roomSnap.id } as RoomProgressItem;
        const progress = p.docs.map(row => ({ ...row.data(), id: row.id } as RoomSidecarProgress));
        const definitions = d.docs.map(row => ({ ...row.data(), id:row.id } as RoomSidecarDefinition));
        const room = overlayMigratedRoomSubItems(source, projectId, progress, definitions);
        if (progress.some(row => !Number.isSafeInteger(row.revision) || (row.revision ?? 0) < 1))
          throw new Error('ROOM_SIDECAR_UNVERIFIED_REVISION');
        if (!cancelled) setVerified({key,room,progress,definitions});
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [migrated, projectId, roomId, key]);

  if (!migrated) return <RoomHighlightModal {...props} />;
  const current = verified?.key === key ? verified : null;
  if (!current) {
    return <div role="dialog" aria-label="Đối chiếu tiến độ Căn / Phòng" className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="max-w-md w-full rounded-xl bg-white p-5 text-sm text-slate-800 shadow-xl">
        <div className="font-bold mb-2">Đang đối chiếu tiến độ từ Firebase Emulator</div>
        <p>{loadError ? `Tạm khóa chỉnh sửa: ${loadError}` : 'Chỉ mở chỉnh sửa khi dữ liệu hạng mục và tiến độ máy chủ đầy đủ, khớp ID.'}</p>
        <button type="button" className="mt-4 rounded-lg bg-slate-800 text-white px-4 py-2" onClick={props.onClose}>Đóng</button>
      </div>
    </div>;
  }
  const save = async (room: Parameters<Props['onSaveRoom']>[0]) => {
    if (saveLock.current) throw new Error('ROOM_SIDECAR_SAVE_IN_PROGRESS');
    saveLock.current = true;
    try {
      const edits = planDemoRoomSidecarSave(current.room, room, current.progress, current.definitions);
      if (edits.length) await updateMigratedRoomSubItemsProgressAtomic(projectId, current.room.id, edits);
      // No optimistic legacy parent write, no direct subItems overwrite.
    } finally {
      saveLock.current = false;
    }
  };
  return <RoomHighlightModal {...props} roomItem={current.room} structureReadOnly onSaveRoom={save} />;
}
