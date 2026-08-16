import * as XLSX from 'xlsx';

type AndroidExportBridge = {
  saveBase64File?: (fileName: string, mimeType: string, base64Data: string) => void;
  beginBase64File?: (sessionId: string, fileName: string, mimeType: string) => boolean;
  appendBase64Chunk?: (sessionId: string, base64Chunk: string) => boolean;
  finishBase64File?: (sessionId: string) => boolean;
  finishBase64FileWithPicker?: (sessionId: string, requestId: string) => boolean;
  finishBase64FileToAutoSaveFolder?: (sessionId: string, requestId: string) => boolean;
  abortBase64File?: (sessionId: string) => void;
  beginTextFile?: (sessionId: string, fileName: string, mimeType: string) => boolean;
  appendTextChunk?: (sessionId: string, textChunk: string) => boolean;
  finishTextFile?: (sessionId: string) => boolean;
  finishTextFileWithPicker?: (sessionId: string, requestId: string) => boolean;
  finishTextFileToAutoSaveFolder?: (sessionId: string, requestId: string) => boolean;
  abortTextFile?: (sessionId: string) => void;
  saveHtmlPdf?: (fileName: string, htmlBase64: string) => void;
  pickAutoSaveFolder?: (requestId: string) => boolean;
  hasAutoSaveFolder?: () => boolean;
  getAutoSaveFolderName?: () => string;
  forgetAutoSaveFolder?: () => void;
};

declare global {
  interface Window {
    AndroidExport?: AndroidExportBridge;
  }
}

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ANDROID_TEXT_CHUNK_SIZE = 32 * 1024;

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

function hasAndroidTextBridge() {
  return typeof window !== 'undefined'
    && typeof window.AndroidExport?.beginTextFile === 'function'
    && typeof window.AndroidExport?.appendTextChunk === 'function'
    && typeof window.AndroidExport?.finishTextFile === 'function';
}

function createExportSessionId() {
  return `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createAndroidRequestId(kind: string) {
  return `${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function waitForAndroidResult(eventName: string, requestId: string, timeoutMs = 120000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener(eventName, onResult as EventListener);
      clearTimeout(timer);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; success?: boolean; message?: string }>).detail || {};
      if (detail.requestId !== requestId) return;
      cleanup();
      if (detail.success) {
        resolve();
      } else {
        reject(new Error(detail.message || 'Android file action was cancelled or failed.'));
      }
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error('Android file action timed out.'));
    }, timeoutMs);
    window.addEventListener(eventName, onResult as EventListener);
  });
}

function* chunkText(text: string, chunkSize = ANDROID_TEXT_CHUNK_SIZE) {
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    const lastCode = text.charCodeAt(end - 1);
    if (end < text.length && lastCode >= 0xd800 && lastCode <= 0xdbff) {
      end -= 1;
    }
    yield text.slice(i, end);
    i = end;
  }
}

function* jsonRecordChunks(data: Record<string, string>) {
  const entries = Object.entries(data);
  yield '{\n';

  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index];
    yield `  ${JSON.stringify(key)}: `;
    yield* chunkText(JSON.stringify(value ?? ''));
    yield index === entries.length - 1 ? '\n' : ',\n';
  }

  yield '}';
}

async function saveTextChunksToAndroid(chunks: Iterable<string>, fileName: string, mimeType: string, destination: 'picker' | 'downloads' | 'autosave' = 'picker') {
  const bridge = window.AndroidExport!;
  const sessionId = createExportSessionId();

  try {
    if (!bridge.beginTextFile!(sessionId, fileName, mimeType)) {
      throw new Error('Android text export session failed to start.');
    }

    for (const part of chunks) {
      for (const chunk of chunkText(part)) {
        if (!bridge.appendTextChunk!(sessionId, chunk)) {
          throw new Error('Android text export chunk failed.');
        }
      }
    }

    if (destination === 'autosave') {
      if (typeof bridge.finishTextFileToAutoSaveFolder !== 'function') {
        throw new Error('Android autosave folder bridge is not available.');
      }
      const requestId = createAndroidRequestId('autosave');
      if (!bridge.finishTextFileToAutoSaveFolder(sessionId, requestId)) {
        throw new Error('Android autosave failed to finish.');
      }
      await waitForAndroidResult('android-autosave-result', requestId);
      return;
    }

    if (destination === 'picker' && typeof bridge.finishTextFileWithPicker === 'function') {
      const requestId = createAndroidRequestId('text_export');
      if (!bridge.finishTextFileWithPicker(sessionId, requestId)) {
        throw new Error('Android text export picker failed to open.');
      }
      await waitForAndroidResult('android-export-result', requestId);
      return;
    }

    if (!bridge.finishTextFile!(sessionId)) {
      throw new Error('Android text export failed to finish.');
    }
  } catch (err) {
    bridge.abortTextFile?.(sessionId);
    throw err;
  }
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
      const sessionId = createExportSessionId();
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
        if (typeof bridge.finishBase64FileWithPicker === 'function') {
          const requestId = createAndroidRequestId('blob_export');
          if (!bridge.finishBase64FileWithPicker(sessionId, requestId)) {
            throw new Error('Android export picker failed to open.');
          }
          await waitForAndroidResult('android-export-result', requestId);
        } else if (!bridge.finishBase64File(sessionId)) {
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
  const safeName = sanitizeFileName(fileName);
  if (hasAndroidTextBridge()) {
    return saveTextChunksToAndroid(chunkText(text), safeName, mimeType, 'picker');
  }

  const blob = new Blob([text], { type: mimeType });
  return saveBlob(blob, safeName, mimeType);
}

export async function saveJsonRecordFile(data: Record<string, string>, fileName: string) {
  const safeName = sanitizeFileName(fileName);
  const mimeType = 'application/json;charset=utf-8';

  if (hasAndroidTextBridge()) {
    await saveTextChunksToAndroid(jsonRecordChunks(data), safeName, mimeType, 'picker');
    return;
  }

  const blob = new Blob([...jsonRecordChunks(data)], { type: mimeType });
  await saveBlob(blob, safeName, mimeType);
}

export async function writeJsonRecordToWritable(writable: { write: (data: string) => Promise<void> | void }, data: Record<string, string>) {
  for (const chunk of jsonRecordChunks(data)) {
    await writable.write(chunk);
  }
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

export function isAndroidAutoSaveAvailable() {
  return typeof window !== 'undefined'
    && hasAndroidTextBridge()
    && typeof window.AndroidExport?.pickAutoSaveFolder === 'function'
    && typeof window.AndroidExport?.finishTextFileToAutoSaveFolder === 'function';
}

export function hasAndroidAutoSaveFolder() {
  if (!isAndroidAutoSaveAvailable()) return false;
  try {
    return Boolean(window.AndroidExport?.hasAutoSaveFolder?.());
  } catch {
    return false;
  }
}

export function getAndroidAutoSaveFolderName() {
  if (!isAndroidAutoSaveAvailable()) return '';
  try {
    return window.AndroidExport?.getAutoSaveFolderName?.() || '';
  } catch {
    return '';
  }
}

export async function pickAndroidAutoSaveFolder() {
  if (!isAndroidAutoSaveAvailable()) {
    throw new Error('Android autosave folder bridge is not available.');
  }
  const requestId = createAndroidRequestId('folder');
  if (!window.AndroidExport!.pickAutoSaveFolder!(requestId)) {
    throw new Error('Khong the mo hop chon thu muc tu dong luu.');
  }
  await waitForAndroidResult('android-folder-result', requestId);
  return getAndroidAutoSaveFolderName();
}

export function clearAndroidAutoSaveFolder() {
  if (isAndroidAutoSaveAvailable()) {
    window.AndroidExport?.forgetAutoSaveFolder?.();
  }
}

export async function saveTextFileToAndroidAutoFolder(text: string, fileName: string, mimeType = 'application/json;charset=utf-8') {
  if (!isAndroidAutoSaveAvailable()) {
    throw new Error('Android autosave folder bridge is not available.');
  }
  if (!hasAndroidAutoSaveFolder()) {
    throw new Error('Chua chon thu muc tu dong luu JSON tren Android.');
  }
  await saveTextChunksToAndroid(chunkText(text), sanitizeFileName(fileName), mimeType, 'autosave');
}
