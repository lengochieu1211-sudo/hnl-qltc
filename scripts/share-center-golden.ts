import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const mustContain = (source: string, marker: string, label: string) => {
  if (!source.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
};
const mustNotContain = (source: string, marker: string, label: string) => {
  if (source.includes(marker)) throw new Error(`Unexpected ${label}: ${marker}`);
};

const shareUtils = read('src/utils/shareUtils.ts');
const shareMenu = read('src/components/ShareEntityMenu.tsx');
const contactMenu = read('src/components/ContactMenu.tsx');
const defect = read('src/components/FloorPlanDefectTab.tsx');
const crew = read('src/components/CrewTab.tsx');
const config = read('src/components/GoogleConfigTab.tsx');
const android = read('android-wrapper/src/com/qlct/app/MainActivity.java');

mustContain(shareUtils, 'bridge.shareFiles', 'native file-share bridge call');
mustContain(shareUtils, 'navigator.canShare', 'Web Share file capability check');
mustContain(shareUtils, 'MAX_SHARE_FILES = 6', 'share file cap');
mustContain(shareMenu, 'Kèm hình ảnh', 'optional image toggle');
mustContain(shareMenu, 'setIncludeImages(false)', 'images default off');
mustContain(shareMenu, 'getEntityPhotos', 'entity photo metadata lookup');
mustContain(shareMenu, 'getPhotoDataUrl', 'real photo resolution');
mustContain(shareMenu, 'Zalo · Messenger · Telegram · Gmail · SMS', 'generic messaging explanation');
mustContain(contactMenu, 'Chia sẻ / Nhắn qua ứng dụng', 'generic contact share action');
mustNotContain(contactMenu, 'Mở Zalo', 'hard-coded Zalo primary action');
mustNotContain(contactMenu, 'openZalo', 'hard-coded Zalo helper import');
mustContain(defect, '<ShareEntityMenu', 'Defect share entry');
mustContain(defect, 'legacyImageUrls={[defect.imageUrl', 'Defect before/after legacy image support');
mustContain(crew, 'buildCrewRecordShareText', 'daily crew deterministic share text');
mustContain(crew, 'Lưu ý: Sáng/Chiều/Tối là quân số theo ca', 'crew shift semantic warning');
mustContain(crew, 'triggerLabel="Chia sẻ báo cáo"', 'daily crew share entry');
mustContain(config, '<details className="group rounded-2xl', 'collapsed diagnostics container');
mustContain(config, 'Nhấn để mở trạng thái đồng bộ, ảnh và công cụ chẩn đoán', 'diagnostics collapsed hint');
mustContain(android, 'public boolean shareFiles(String title, String text, String attachmentsJson)', 'Android shareFiles bridge');
mustContain(android, 'Intent.ACTION_SEND_MULTIPLE', 'Android multi-image share');
mustContain(android, 'Intent.FLAG_GRANT_READ_URI_PERMISSION', 'Android temporary attachment permission');

console.log('HNL QLTC share center golden: PASS');
