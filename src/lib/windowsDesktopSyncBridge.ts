import { getCurrentRealFirebaseUser } from './firebase';
import { refreshProjectPhotoMetadataFromCloud, uploadPhotoToCloud, verifyPhotoBinaryReadyInCloud } from './photoCloudSync';
import { savePhotoAttachment, type PhotoAttachment } from '../utils/photoStorage';
import type { UserRole } from '../utils/securityUtils';

type BridgeEntityType = PhotoAttachment['entityType'];
type BridgeCategory = NonNullable<PhotoAttachment['category']>;

export interface WindowsDesktopBridgeItem {
  queueKey: string;
  relativePath: string;
  sourceSha256: string;
  projectId: string;
  entityType: BridgeEntityType;
  entityId: string;
  category: BridgeCategory;
  fileName: string;
  mimeType: string;
  ackName: string;
}

interface WindowsDesktopBridgeManifest {
  schema: 'hnl-qltc-desktop-sync-v1';
  generatedAt: string;
  cloudAuthority: string;
  items: WindowsDesktopBridgeItem[];
}

export interface WindowsDesktopBridgeResult {
  manifestItems: number;
  projectItems: number;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

let sessionWorkspaceHandle: any = null;

export function windowsDesktopBridgeSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function' && Boolean(window.crypto?.subtle);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function getDirectory(root: any, parts: string[], create = false): Promise<any> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}

async function getFileHandleByRelativePath(root: any, relativePath: string): Promise<any> {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('BRIDGE_PATH_INVALID');
  let dir = root;
  for (let i = 0; i < parts.length - 1; i += 1) dir = await dir.getDirectoryHandle(parts[i]);
  return dir.getFileHandle(parts[parts.length - 1]);
}

async function readManifest(root: any): Promise<WindowsDesktopBridgeManifest> {
  const bridge = await root.getDirectoryHandle('DesktopBridge');
  const fileHandle = await bridge.getFileHandle('ready.json');
  const file = await fileHandle.getFile();
  const parsed = JSON.parse(await file.text()) as WindowsDesktopBridgeManifest;
  if (parsed?.schema !== 'hnl-qltc-desktop-sync-v1' || !Array.isArray(parsed.items)) throw new Error('BRIDGE_MANIFEST_INVALID');
  return parsed;
}

function validateItem(item: WindowsDesktopBridgeItem): void {
  if (!item?.queueKey || !item?.relativePath || !item?.sourceSha256 || !item?.projectId || !item?.entityId || !item?.ackName) throw new Error('BRIDGE_ITEM_INCOMPLETE');
  if (!['defect', 'crewRecord', 'chat'].includes(item.entityType)) throw new Error('BRIDGE_ENTITY_TYPE_INVALID');
  const allowedCategory: Record<BridgeEntityType, BridgeCategory[]> = {
    defect: ['defect_before', 'defect_after'],
    crewRecord: ['crew_progress'],
    chat: ['chat_attachment'],
  };
  if (!allowedCategory[item.entityType].includes(item.category)) throw new Error('BRIDGE_CATEGORY_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(item.sourceSha256)) throw new Error('BRIDGE_SHA256_INVALID');
  if (!/^[a-f0-9]{64}-[a-f0-9]{16}\.ack$/i.test(item.ackName)) throw new Error('BRIDGE_ACK_NAME_INVALID');
}

async function writeAck(root: any, item: WindowsDesktopBridgeItem, photoId: string): Promise<void> {
  const ackDir = await getDirectory(root, ['DesktopBridge', 'acks'], true);
  const ackFile = await ackDir.getFileHandle(item.ackName, { create: true });
  const writable = await ackFile.createWritable();
  try {
    await writable.write(JSON.stringify({
      schema: 'hnl-qltc-desktop-sync-ack-v1',
      queueKey: item.queueKey,
      sourceSha256: item.sourceSha256.toLowerCase(),
      projectId: item.projectId,
      photoId,
      cloudVerified: true,
      acknowledgedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    await writable.close();
  }
}

async function chooseWorkspace(): Promise<any> {
  if (sessionWorkspaceHandle) {
    try {
      const permission = await sessionWorkspaceHandle.queryPermission?.({ mode: 'readwrite' });
      if (permission === 'granted') return sessionWorkspaceHandle;
    } catch (_) {}
  }
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'hnl-qltc-windows-workspace' });
  const permission = await handle.requestPermission?.({ mode: 'readwrite' });
  if (permission && permission !== 'granted') throw new Error('BRIDGE_WORKSPACE_PERMISSION_DENIED');
  sessionWorkspaceHandle = handle;
  return handle;
}

export async function runWindowsDesktopSyncBridge(
  activeProjectId: string,
  userRole: UserRole,
  onProgress?: (message: string) => void,
): Promise<WindowsDesktopBridgeResult> {
  if (!windowsDesktopBridgeSupported()) throw new Error('Trình duyệt này chưa hỗ trợ File System Access API. Hãy dùng Edge/Chrome trên Windows.');
  if (!activeProjectId) throw new Error('Chưa chọn dự án.');
  if (userRole === 'VIEWER') throw new Error('VIEWER chỉ đọc, không được đồng bộ ảnh từ Windows.');
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('Cần đăng nhập Firebase trước khi đồng bộ từ Windows.');

  const root = await chooseWorkspace();
  const manifest = await readManifest(root);
  const result: WindowsDesktopBridgeResult = { manifestItems: manifest.items.length, projectItems: 0, uploaded: 0, skipped: 0, failed: 0, errors: [] };
  const projectItems = manifest.items.filter((item) => item.projectId === activeProjectId);
  result.projectItems = projectItems.length;

  for (let index = 0; index < projectItems.length; index += 1) {
    const item = projectItems[index];
    try {
      validateItem(item);
      onProgress?.(`Windows Sync ${index + 1}/${projectItems.length}: kiểm tra ${item.fileName}`);
      const fileHandle = await getFileHandleByRelativePath(root, item.relativePath);
      const file = await fileHandle.getFile();
      if (file.size <= 0) throw new Error('BRIDGE_FILE_EMPTY');
      const sourceSha256 = await sha256Hex(file);
      if (sourceSha256.toLowerCase() !== item.sourceSha256.toLowerCase()) throw new Error('BRIDGE_SOURCE_SHA256_MISMATCH');

      const saved = await savePhotoAttachment({
        projectId: activeProjectId,
        entityType: item.entityType,
        entityId: item.entityId,
        category: item.category,
        fileName: item.fileName || file.name,
        mimeType: item.mimeType || file.type || 'image/jpeg',
        fileSize: file.size,
        createdByUid: user.uid,
      }, file);

      onProgress?.(`Windows Sync ${index + 1}/${projectItems.length}: upload Cloud ${item.fileName}`);
      await uploadPhotoToCloud(activeProjectId, saved);
      const ready = await verifyPhotoBinaryReadyInCloud(activeProjectId, saved.id);
      if (!ready) throw new Error('BRIDGE_CLOUD_VERIFY_FAILED');
      await writeAck(root, item, saved.id);
      result.uploaded += 1;
    } catch (error: any) {
      result.failed += 1;
      result.errors.push(`${item.fileName || item.relativePath}: ${error?.message || String(error)}`);
    }
  }

  if (result.uploaded > 0) await refreshProjectPhotoMetadataFromCloud(activeProjectId).catch(() => {});
  onProgress?.(result.failed > 0 ? `Windows Sync xong: ${result.uploaded} thành công, ${result.failed} lỗi.` : `Windows Sync xong: ${result.uploaded} ảnh đã Cloud-ready.`);
  return result;
}
