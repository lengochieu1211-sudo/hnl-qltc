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

async function tryWebFileShare(title: string, text: string, url: string, files: File[]): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (files.length === 0 || typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'unsupported';
  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files })) return 'unsupported';
  } catch (_) {
    return 'unsupported';
  }

  const shareText = [text, url].filter(Boolean).join('\n');
  const attempts: ShareData[] = [
    { title, text: shareText || undefined, files },
    // Some OEM Chromium/WebView builds accept file sharing but reject text + files.
    { files },
  ];

  for (const shareData of attempts) {
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
      // Retry a more conservative payload for DataError/NotAllowedError/TypeError.
    }
  }

  // A few Android browsers reject multi-file shares even when canShare({files}) returns true.
  if (files.length > 1) {
    try {
      const first = files[0];
      if (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [first] })) {
        await navigator.share({ title, text: shareText || undefined, files: [first] });
        return 'shared';
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  return 'unsupported';
}

export async function sharePreparedContent(params: {
  title?: string;
  text: string;
  url?: string;
  attachments?: ShareAttachmentPayload[];
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
    if (decoded.length > 0 && totalBytes <= MAX_NATIVE_SHARE_BYTES && bridge && typeof bridge.shareFiles === 'function') {
      try {
        const payload = decoded.map(({ attachment, decoded: item }) => {
          const actualMimeType = item.mimeType || attachment.mimeType || 'image/jpeg';
          return {
            fileName: normalizeShareFileName(attachment.fileName, actualMimeType, attachment.id),
            mimeType: actualMimeType,
            base64: item.base64,
          };
        });
        const ok = bridge.shareFiles(title, [text, url].filter(Boolean).join('\n'), JSON.stringify(payload));
        if (ok !== false) {
          return { status: 'shared', requestedFiles: requested.length, sharedFiles: payload.length, fallbackToText: false };
        }
      } catch (_) {}
    }

    const files = requested.map(dataUrlToFile).filter((file): file is File => Boolean(file));
    const webShare = await tryWebFileShare(title, text, url, files);
    if (webShare === 'shared') {
      // Multi-file retry may have fallen back to one file. Report conservatively if canShare is flaky.
      return { status: 'shared', requestedFiles: requested.length, sharedFiles: files.length > 0 ? Math.min(files.length, requested.length) : 0, fallbackToText: false };
    }
    if (webShare === 'cancelled') {
      return { status: 'cancelled', requestedFiles: requested.length, sharedFiles: 0, fallbackToText: false };
    }
  }

  const status = await sharePreparedText({ title, text, url });
  return {
    status,
    requestedFiles: requested.length,
    sharedFiles: 0,
    fallbackToText: requested.length > 0,
  };
}
