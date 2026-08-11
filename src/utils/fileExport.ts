import * as XLSX from 'xlsx';

type AndroidExportBridge = {
  saveBase64File?: (fileName: string, mimeType: string, base64Data: string) => void;
  beginBase64File?: (sessionId: string, fileName: string, mimeType: string) => boolean;
  appendBase64Chunk?: (sessionId: string, base64Chunk: string) => boolean;
  finishBase64File?: (sessionId: string) => boolean;
  abortBase64File?: (sessionId: string) => void;
  saveHtmlPdf?: (fileName: string, htmlBase64: string) => void;
};

declare global {
  interface Window {
    AndroidExport?: AndroidExportBridge;
  }
}

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isAndroidExportBridgeAvailable() {
  return typeof window !== 'undefined'
    && typeof window.AndroidExport?.saveBase64File === 'function';
}

function sanitizeFileName(fileName: string) {
  return (fileName || `QLCT_${Date.now()}`)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function browserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = sanitizeFileName(fileName);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function utf8ToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function saveBlob(blob: Blob, fileName: string, mimeType = blob.type || 'application/octet-stream') {
  const safeName = sanitizeFileName(fileName);

  if (isAndroidExportBridgeAvailable()) {
    const base64Data = await blobToBase64(blob);
    const bridge = window.AndroidExport!;
    if (
      typeof bridge.beginBase64File === 'function'
      && typeof bridge.appendBase64Chunk === 'function'
      && typeof bridge.finishBase64File === 'function'
    ) {
      const sessionId = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const chunkSize = 256 * 1024;
      try {
        if (!bridge.beginBase64File(sessionId, safeName, mimeType)) {
          throw new Error('Android export session failed to start.');
        }
        for (let i = 0; i < base64Data.length; i += chunkSize) {
          if (!bridge.appendBase64Chunk(sessionId, base64Data.slice(i, i + chunkSize))) {
            throw new Error('Android export chunk failed.');
          }
        }
        if (!bridge.finishBase64File(sessionId)) {
          throw new Error('Android export failed to finish.');
        }
      } catch (err) {
        bridge.abortBase64File?.(sessionId);
        throw err;
      }
      return;
    }

    bridge.saveBase64File!(safeName, mimeType, base64Data);
    return;
  }

  browserDownload(blob, safeName);
}

export function saveTextFile(text: string, fileName: string, mimeType = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  return saveBlob(blob, fileName, mimeType);
}

export function saveWorkbookFile(workbook: XLSX.WorkBook, fileName: string) {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([data], { type: EXCEL_MIME });
  return saveBlob(blob, fileName, EXCEL_MIME);
}

export function saveHtmlPdf(html: string, fileName: string) {
  if (typeof window.AndroidExport?.saveHtmlPdf === 'function') {
    window.AndroidExport.saveHtmlPdf(sanitizeFileName(fileName), utf8ToBase64(html));
    return true;
  }

  return false;
}
