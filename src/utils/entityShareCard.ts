import type { ShareAttachmentPayload } from './shareUtils';

/** A self-contained image: recipients can read the report even if their messenger drops EXTRA_TEXT. */
export async function renderEntityShareCard(params: {
  title: string;
  text: string;
  entityType: 'defect' | 'crewRecord';
  attachments: Array<ShareAttachmentPayload & { caption?: string }>;
}): Promise<ShareAttachmentPayload> {
  if (typeof document === 'undefined') throw new Error('Thiết bị không hỗ trợ tạo ảnh báo cáo.');
  const sources = params.attachments.slice(0, 6);
  if (!sources.length) throw new Error('Không có ảnh để tạo báo cáo.');

  const images = await Promise.all(sources.map((source) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
      ? resolve(image) : reject(new Error('Ảnh chia sẻ bị rỗng.'));
    image.onerror = () => reject(new Error('Không đọc được ảnh gốc để tạo báo cáo.'));
    image.src = source.dataUrl;
  })));

  const canvas = document.createElement('canvas');
  const width = 1080;
  const padding = 48;
  const contentWidth = width - padding * 2;
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('Không khởi tạo được bộ tạo ảnh báo cáo.');
  measure.font = '500 25px Arial, sans-serif';
  const lines: string[] = [];
  const reportText = String(params.text || '').replace(/\r\n?/g, '\n');
  for (const paragraph of reportText.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      const joined = current ? `${current} ${word}` : word;
      if (measure.measureText(joined).width <= contentWidth) {
        current = joined;
      } else {
        if (current) lines.push(current);
        current = word;
        // Long IDs/URLs may have no spaces; wrap by characters rather than clipping.
        while (current && measure.measureText(current).width > contentWidth) {
          let end = 1;
          while (end < current.length && measure.measureText(current.slice(0, end + 1)).width <= contentWidth) end++;
          lines.push(current.slice(0, end));
          current = current.slice(end);
        }
      }
    }
    lines.push(current);
  }
  const textLines = lines.slice(0, 46);
  const shortened = lines.length > textLines.length;
  const lineHeight = 35;
  const textStart = 184;
  const textBottom = textStart + (textLines.length + (shortened ? 2 : 0)) * lineHeight;
  const photoTop = textBottom + 46;
  const gap = 16;
  const tileWidth = Math.floor((contentWidth - gap) / 2);
  const tileHeight = 354;
  const rows = Math.ceil(images.length / 2);
  const height = photoTop + rows * (tileHeight + 38 + gap) + 62;
  if (height > 4096) throw new Error('Báo cáo quá dài để tạo ảnh an toàn. Hãy dùng Sao chép nội dung.');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không khởi tạo được vùng vẽ báo cáo.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(0, 0, width, 12);
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillText('HNL QLTC', padding, 67);
  ctx.font = '700 29px Arial, sans-serif';
  const heading = params.entityType === 'defect' ? 'BÁO CÁO DEFECT' : 'NHẬT KÝ QUÂN SỐ';
  ctx.fillText(heading, padding, 119);
  ctx.font = '600 21px Arial, sans-serif';
  ctx.fillStyle = '#475569';
  let headingText = String(params.title || '').trim();
  while (headingText && ctx.measureText(headingText).width > contentWidth) headingText = headingText.slice(0, -1);
  ctx.fillText(headingText, padding, 157);
  ctx.font = '500 25px Arial, sans-serif';
  ctx.fillStyle = '#1e293b';
  textLines.forEach((line, index) => { if (line) ctx.fillText(line, padding, textStart + index * lineHeight); });
  if (shortened) {
    ctx.font = '600 22px Arial, sans-serif';
    ctx.fillStyle = '#b45309';
    ctx.fillText('Nội dung dài: dùng Sao chép để xem đầy đủ phần chữ.', padding, textBottom - 28);
  }
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(padding, photoTop - 22, contentWidth, 3);
  images.forEach((image, index) => {
    const x = padding + (index % 2) * (tileWidth + gap);
    const y = photoTop + Math.floor(index / 2) * (tileHeight + 38 + gap);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(x, y, tileWidth, tileHeight);
    const scale = Math.min(tileWidth / image.naturalWidth, tileHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (tileWidth - drawWidth) / 2, y + (tileHeight - drawHeight) / 2, drawWidth, drawHeight);
    ctx.font = '600 19px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(`${sources[index].caption || `Ảnh ${index + 1}`} (${index + 1}/${images.length})`, x + 8, y + tileHeight + 29);
  });
  ctx.font = '500 19px Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Ảnh báo cáo chia sẻ · Không thay đổi ảnh gốc hoặc dữ liệu dự án', padding, height - 25);

  // Favor lossless PNG like the crew summary, but keep a bounded JPEG escape hatch
  // for photo-heavy reports that exceed the 12 MiB native Android share bridge cap.
  let dataUrl = canvas.toDataURL('image/png');
  let mimeType = 'image/png';
  if (dataUrl.length * 3 / 4 > 10 * 1024 * 1024) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    mimeType = 'image/jpeg';
  }
  if (!dataUrl.startsWith(`data:${mimeType};base64,`) || dataUrl.length <= 100) {
    throw new Error('Tạo ảnh báo cáo thất bại.');
  }
  if (dataUrl.length * 3 / 4 > 11 * 1024 * 1024) {
    throw new Error('Ảnh báo cáo quá lớn để chia sẻ; hãy chọn Ảnh gốc.');
  }
  const suffix = mimeType === 'image/png' ? 'png' : 'jpg';
  const safeId = params.entityType === 'defect' ? 'Defect' : 'Quan-so';
  return {
    id: `report-${params.entityType}`,
    fileName: `HNL-QLTC-${safeId}-bao-cao.${suffix}`,
    mimeType,
    dataUrl,
  };
}
