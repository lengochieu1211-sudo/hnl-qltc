import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { getImageQualityProfile } from './imageQualitySettings';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfDocumentInfo { pageCount: number; }
export interface PdfRenderOptions { pageNumber?: number; maxDimension?: number; quality?: number; hideAnnotations?: boolean; }

const readPdfBytes = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());

/** Load a PDF once so upload + room detection can reuse the same document on mobile. */
export const loadPdfDocument = async (file: File): Promise<any> =>
  pdfjsLib.getDocument({ data: await readPdfBytes(file) }).promise;

export async function getPdfDocumentInfo(file: File): Promise<PdfDocumentInfo> {
  const pdf = await loadPdfDocument(file);
  try {
    return { pageCount: pdf.numPages || 1 };
  } finally {
    try { await pdf.destroy?.(); } catch {}
  }
}

export async function renderPdfDocumentPageToImage(pdf: any, options: PdfRenderOptions = {}): Promise<string> {
  const pageNumber = Math.min(Math.max(1, options.pageNumber || 1), Math.max(1, pdf.numPages || 1));
  const page = await pdf.getPage(pageNumber);
  const profile = getImageQualityProfile('floorPlan');
  const maxDimension = Math.max(1200, options.maxDimension || profile.maxDimension);
  const quality = Math.min(0.98, Math.max(0.65, options.quality ?? profile.quality));
  const baseViewport = page.getViewport({ scale: 1 });
  const baseMax = Math.max(baseViewport.width, baseViewport.height, 1);
  let scale = Math.max(0.35, Math.min(6, maxDimension / baseMax));
  let viewport = page.getViewport({ scale });

  // Pixel-count cap protects Android WebView from very large CAD/PDF canvases. A
  // 6000x4000 canvas alone is ~96 MB in RGBA before JPEG/Base64 copies are made.
  const mobileLike = typeof window !== 'undefined' && (
    window.matchMedia?.('(max-width: 768px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '')
  );
  const maxPixels = mobileLike ? 14_000_000 : 28_000_000;
  const projectedPixels = Math.max(1, viewport.width * viewport.height);
  if (projectedPixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / projectedPixels);
    viewport = page.getViewport({ scale });
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Không tạo được vùng vẽ PDF trên thiết bị này.');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({
      canvasContext: context,
      viewport,
      canvas,
      ...(options.hideAnnotations && pdfjsLib.AnnotationMode ? { annotationMode: pdfjsLib.AnnotationMode.DISABLE } : {}),
    }).promise;
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    try { page.cleanup?.(); } catch {}
  }
}

export async function convertPdfToImage(file: File, options: PdfRenderOptions = {}): Promise<string> {
  const pdf = await loadPdfDocument(file);
  try {
    return await renderPdfDocumentPageToImage(pdf, options);
  } finally {
    try { await pdf.destroy?.(); } catch {}
  }
}

export function describePdfError(err: any): string {
  const name = String(err?.name || '');
  const message = String(err?.message || err || '');
  if (/PasswordException/i.test(name) || /password/i.test(message)) return 'PDF đang được bảo vệ bằng mật khẩu. Hãy bỏ mật khẩu hoặc xuất lại PDF không khóa rồi thử lại.';
  if (/InvalidPDFException/i.test(name) || /Invalid PDF/i.test(message)) return 'Tệp PDF không hợp lệ hoặc đã bị lỗi.';
  return 'Không thể đọc PDF trên thiết bị này. Hãy thử lại với PDF khác hoặc xuất PDF về phiên bản tiêu chuẩn.';
}
