import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/ShareEntityMenu.tsx', 'utf8');
const shared = fs.readFileSync('src/utils/shareUtils.ts', 'utf8');
assert(source.includes("const [imageFormat, setImageFormat] = useState<'report' | 'original'>('report')"), 'Report card must be the default image mode');
assert(source.includes("renderEntityShareCard({ title, text, entityType, attachments: items })"), 'Resolve card before user Share click');
assert(source.includes("allowTextFallback: !includeImages"), 'Do not silently drop requested media');
assert(source.includes('Kèm hình ảnh') && source.includes('Ảnh gốc'), 'Retain original image option');
assert(source.includes('transient user activation'), 'Share call must not wait for network/image generation');
assert(source.includes("text: includeImages && imageFormat === 'report' ? '' : text"), 'Report image shares must not duplicate its embedded text in Zalo');
assert(source.includes("url: includeImages && imageFormat === 'report' ? '' : shareUrl"), 'Report image shares must not repeat the embedded URL');
assert(!source.includes('Zalo · Messenger · Telegram · Gmail · SMS'), 'Remove redundant messaging app list');
assert(source.includes('Lưu ảnh để gửi thủ công') && source.includes('saveBlobToDownloads'), 'Keep an explicit image save path when native file share is unavailable');
assert(shared.includes('NotAllowedError') && shared.includes('navigator.userActivation'), 'Do not retry Web Share after user activation was denied');
assert(shared.includes('If it could not open') && shared.includes("status: 'failed'"), 'Native APK errors must not fake a Web Share success');
const native = fs.readFileSync('android-wrapper/src/com/qlct/app/MainActivity.java', 'utf8');
assert(native.includes('if (!safeText.trim().isEmpty()) share.putExtra(Intent.EXTRA_TEXT, safeText);'), 'Native report-card share must not emit an empty text bubble');
assert(shared.includes('bridge.shareFiles') && shared.includes('navigator.share'), 'Keep native and web share paths');

let context = null;
let canvasHeight = 0;
let rendered = [];
class MockCanvas {
  width = 0;
  height = 0;
  getContext() {
    return context ||= {
      font: '', fillStyle: '', lineWidth: 1,
      measureText(value) { return { width: String(value).length * 12 }; },
      fillRect() {},
      drawImage(image, ...position) { rendered.push({ image, position }); },
      fillText(value) { rendered.push(String(value)); },
    };
  }
  toDataURL(mime = 'image/png') { canvasHeight = this.height; return `data:${mime};base64,${'a'.repeat(500)}`; }
}
class MockImage {
  naturalWidth = 800;
  naturalHeight = 600;
  set src(value) { if (value.startsWith('data:image/')) this.onload?.(); else this.onerror?.(); }
}
globalThis.document = { createElement: (name) => name === 'canvas' ? new MockCanvas() : null };
globalThis.Image = MockImage;
const { renderEntityShareCard } = await import('../src/utils/entityShareCard.ts');
const picture = { id: 'pic', fileName: 'photo.jpg', dataUrl: 'data:image/png;base64,abcd' };
for (const [entityType, label] of [['defect', 'BÁO CÁO DEFECT'], ['crewRecord', 'NHẬT KÝ QUÂN SỐ']]) {
  rendered = [];
  context = null;
  const result = await renderEntityShareCard({ entityType, title: 'Tiến độ thi công', text: 'Nội dung gồm tầng 1, đội thi công và các ghi chú.', attachments: [picture, picture] });
  assert(result.dataUrl.startsWith('data:image/png;base64,'), 'Render PNG report like crew matrix');
  assert(result.fileName.endsWith('.png'), 'Image file extension matches its actual MIME');
  assert(canvasHeight > 600 && canvasHeight < 4096, 'Use bounded visible canvas');
  assert(rendered.includes(label) && rendered.some(x => typeof x === 'string' && x.includes('Nội dung gồm')), 'Report draws text inside the image');
  assert(rendered.filter(x => typeof x === 'object').length === 2, 'Report draws all two photos');
}
await assert.rejects(() => renderEntityShareCard({ entityType: 'defect', title: '', text: 'x', attachments: [] }), /Không có ảnh/);
await assert.rejects(() => renderEntityShareCard({ entityType: 'defect', title: '', text: 'x', attachments: [{...picture, dataUrl:'bad'}] }), /Không đọc được ảnh/);
console.log('HNL QLTC entity share card golden: PASS');
