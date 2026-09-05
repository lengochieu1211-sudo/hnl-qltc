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

function dataUrlToFile(attachment: ShareAttachmentPayload): File | null {
  const decoded = decodeDataUrl(attachment.dataUrl);
  if (!decoded) return null;
  try {
    const binary = atob(decoded.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], attachment.fileName || `HNL-QLTC-${attachment.id}.jpg`, {
      type: attachment.mimeType || decoded.mimeType || 'image/jpeg',
    });
  } catch (_) {
    return null;
  }
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
        const payload = decoded.map(({ attachment, decoded: item }) => ({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType || item.mimeType || 'image/jpeg',
          base64: item.base64,
        }));
        const ok = bridge.shareFiles(title, [text, url].filter(Boolean).join('\n'), JSON.stringify(payload));
        if (ok !== false) {
          return { status: 'shared', requestedFiles: requested.length, sharedFiles: payload.length, fallbackToText: false };
        }
      } catch (_) {}
    }

    const files = requested.map(dataUrlToFile).filter((file): file is File => Boolean(file));
    if (files.length > 0 && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const shareData: ShareData = { title, text: text || undefined, url: url || undefined, files };
        const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files });
        if (canShareFiles) {
          await navigator.share(shareData);
          return { status: 'shared', requestedFiles: requested.length, sharedFiles: files.length, fallbackToText: false };
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return { status: 'cancelled', requestedFiles: requested.length, sharedFiles: 0, fallbackToText: false };
        }
      }
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
