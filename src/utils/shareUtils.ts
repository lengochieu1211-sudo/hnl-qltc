import { sharePreparedText, ShareResult } from './contactUtils';

export type ShareAttachmentPayload = {
  id: string;
  fileName: string;
  mimeType?: string;
  dataUrl: string;
};

export type ShareContentResult = {
  status: ShareResult;
  requestedFiles: number;
  sharedFiles: number;
  fallbackToText: boolean;
  failureReason?: 'native-share-failed' | 'native-file-limit' | 'browser-file-sharing-unavailable';
};

const MAX_SHARE_FILES = 6;
const MAX_NATIVE_SHARE_BYTES = 12 * 1024 * 1024;

function getAndroidContactBridge(): any | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).AndroidContact;
  return bridge && typeof bridge === 'object' ? bridge : null;
}

function decodeDataUrl(dataUrl: string): { mimeType: string; base64: string; bytes: number } | null {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const encoded = match[3] || '';
  try {
    if (match[2]) {
      const compact = encoded.replace(/\s/g, '');
      const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
      return {
        mimeType,
        base64: compact,
        bytes: Math.max(0, Math.floor(compact.length * 3 / 4) - padding),
      };
    }
    const decoded = decodeURIComponent(encoded);
    const bytes = new TextEncoder().encode(decoded);
    let binary = '';
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    return { mimeType, base64: btoa(binary), bytes: bytes.length };
  } catch (_) {
    return null;
  }
}

const shareFileExtensionForMime = (mimeType: string): string => {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '';
};

const normalizeShareFileName = (fileName: string, mimeType: string, id: string): string => {
  const extension = shareFileExtensionForMime(mimeType);
  const fallback = `HNL-QLTC-${id || 'image'}${extension || '.jpg'}`;
  const cleaned = String(fileName || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  if (!cleaned) return fallback;
  if (!extension) return cleaned;
  const base = cleaned.replace(/\.[a-z0-9]{1,8}$/i, '');
  return `${base || `HNL-QLTC-${id || 'image'}`}${extension}`;
};

function dataUrlToFile(attachment: ShareAttachmentPayload): File | null {
  const decoded = decodeDataUrl(attachment.dataUrl);
  if (!decoded) return null;
  try {
    const binary = atob(decoded.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

    // The actual binary/data URL is authoritative. HNL compresses photos to JPEG before
    // storing them, while legacy metadata can still keep the camera's original MIME/name.
    const actualMimeType = decoded.mimeType || attachment.mimeType || 'image/jpeg';
    const actualFileName = normalizeShareFileName(attachment.fileName, actualMimeType, attachment.id);
    return new File([bytes], actualFileName, { type: actualMimeType, lastModified: Date.now() });
  } catch (_) {
    return null;
  }
}

type WebFileShareResult = { status: 'shared' | 'cancelled' | 'unsupported'; sharedFiles: number };

async function tryWebFileShare(title: string, text: string, url: string, files: File[]): Promise<WebFileShareResult> {
  const unsupported: WebFileShareResult = { status: 'unsupported', sharedFiles: 0 };
  if (files.length === 0 || typeof navigator === 'undefined' || typeof navigator.share !== 'function') return unsupported;
  const canSend = (selected: File[]): boolean => {
    try { return typeof navigator.canShare !== 'function' || navigator.canShare({ files: selected }); }
    catch (_) { return false; }
  };
  const shareText = [text, url].filter(Boolean).join('\n');

  // Some Android browsers do not accept ACTION_SEND_MULTIPLE from Web Share.
  // Crucially: do NOT return early when canShare({files}) is false for 2+ files.
  // Try one file on this SAME click, before losing transient user activation.
  const groups = canSend(files) ? [files] : [];
  if (files.length > 1 && canSend([files[0]])) groups.push([files[0]]);
  if (!groups.length) return unsupported;

  for (const group of groups) {
    const attempts: ShareData[] = [
      { title, text: shareText || undefined, files: group },
      { files: group }, // Some OEM browsers reject combined text + files.
    ];
    for (const payload of attempts) {
      try {
        await navigator.share(payload);
        return { status: 'shared', sharedFiles: group.length };
      } catch (error: any) {
        if (error?.name === 'AbortError') return { status: 'cancelled', sharedFiles: 0 };
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return unsupported;
        // No second call if transient user activation was already consumed.
        if (typeof navigator.userActivation?.isActive === 'boolean' && !navigator.userActivation.isActive) return unsupported;
      }
    }
  }
  return unsupported;
}

export async function sharePreparedContent(params: {
  title?: string;
  text: string;
  url?: string;
  attachments?: ShareAttachmentPayload[];
  // Already-constructed browser Files keep user activation on the Share click.
  // Used only for the selected attachments; Android native bridge still uses data URLs.
  browserFiles?: File[];
  allowTextFallback?: boolean;
}): Promise<ShareContentResult> {
  const title = String(params.title || 'HNL QLTC').trim() || 'HNL QLTC';
  const text = String(params.text || '').trim();
  const url = String(params.url || '').trim();
  const requested = (params.attachments || []).slice(0, MAX_SHARE_FILES);

  if (requested.length > 0) {
    const decoded = requested
      .map((attachment) => ({ attachment, decoded: decodeDataUrl(attachment.dataUrl) }))
      .filter((item): item is { attachment: ShareAttachmentPayload; decoded: NonNullable<ReturnType<typeof decodeDataUrl>> } => Boolean(item.decoded));

    const totalBytes = decoded.reduce((sum, item) => sum + item.decoded.bytes, 0);
    const bridge = getAndroidContactBridge();
    const nativeAvailable = Boolean(bridge && typeof bridge.shareFiles === 'function');
    if (decoded.length > 0 && nativeAvailable) {
      const nativeShare = (items: typeof decoded): boolean => {
        const size = items.reduce((sum, item) => sum + item.decoded.bytes, 0);
        if (size > MAX_NATIVE_SHARE_BYTES) return false;
        const payload = items.map(({ attachment, decoded: item }) => {
          const actualMimeType = item.mimeType || attachment.mimeType || 'image/jpeg';
          return {
            fileName: normalizeShareFileName(attachment.fileName, actualMimeType, attachment.id),
            mimeType: actualMimeType,
            base64: item.base64,
          };
        });
        return bridge.shareFiles(title, [text, url].filter(Boolean).join('\n'), JSON.stringify(payload)) !== false;
      };
      try {
        if (nativeShare(decoded)) {
          return { status: 'shared', requestedFiles: requested.length, sharedFiles: decoded.length, fallbackToText: false };
        }
        // Some Android OEM share sheets reject ACTION_SEND_MULTIPLE, but accept
        // ACTION_SEND. Retry ONE image only if the initial native chooser failed.
        // The UI must say 1/N, never imply every original photo was shared.
        if (decoded.length > 1 && nativeShare([decoded[0]])) {
          return { status: 'shared', requestedFiles: requested.length, sharedFiles: 1, fallbackToText: false };
        }
      } catch (_) { /* Native chooser errors must not fake a successful share. */ }
      // The app-owned native bridge already attempted startActivity; falling back
      // to Web Share in the APK can lose user activation or launch two choosers.
      if (params.allowTextFallback === false) {
        return { status: 'failed', requestedFiles: requested.length, sharedFiles: 0, fallbackToText: false,
          failureReason: totalBytes > MAX_NATIVE_SHARE_BYTES ? 'native-file-limit' : 'native-share-failed' };
      }
    }

    const files = params.browserFiles?.length === requested.length && params.browserFiles.every((file) => file instanceof File)
      ? params.browserFiles
      : requested.map(dataUrlToFile).filter((file): file is File => Boolean(file));
    const webShare = await tryWebFileShare(title, text, url, files);
    if (webShare.status === 'shared') {
      // Never claim all photos were sent if the browser only accepted one.
      return { status: 'shared', requestedFiles: requested.length, sharedFiles: webShare.sharedFiles, fallbackToText: false };
    }
    if (webShare.status === 'cancelled') {
      return { status: 'cancelled', requestedFiles: requested.length, sharedFiles: 0, fallbackToText: false };
    }
  }

  if (requested.length > 0 && params.allowTextFallback === false) {
    return {
      status: 'failed',
      requestedFiles: requested.length,
      sharedFiles: 0,
      fallbackToText: false,
      failureReason: 'browser-file-sharing-unavailable',
    };
  }

  const status = await sharePreparedText({ title, text, url });
  return {
    status,
    requestedFiles: requested.length,
    sharedFiles: 0,
    fallbackToText: requested.length > 0,
  };
}
