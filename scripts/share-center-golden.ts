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
const crew = fs.existsSync('src/components/CrewTabBase.tsx')
  ? `${read('src/components/CrewTab.tsx')}\n${read('src/components/CrewTabBase.tsx')}`
  : read('src/components/CrewTab.tsx');
const config = read('src/components/GoogleConfigTab.tsx');
const android = read('android-wrapper/src/com/qlct/app/MainActivity.java');

mustContain(shareUtils, 'bridge.shareFiles', 'native file-share bridge call');
mustContain(shareUtils, 'navigator.canShare', 'Web Share file capability check');
mustContain(shareUtils, 'MAX_SHARE_FILES = 6', 'share file cap');
mustContain(shareUtils, 'tryWebFileShare', 'Android browser multi-strategy Web Share helper');
mustContain(shareUtils, '{ files }', 'files-only Web Share retry for OEM browsers');
mustContain(shareUtils, 'files.length > 1', 'single-file fallback when multi-file Web Share fails');
mustContain(shareMenu, 'Kèm hình ảnh', 'optional image toggle');
mustContain(shareMenu, 'setIncludeImages(false)', 'images default off');
mustContain(shareMenu, 'getEntityPhotos', 'entity photo metadata lookup');
mustContain(shareMenu, 'getPhotoDataUrl', 'real photo resolution');
mustContain(shareMenu, 'preparedAttachments', 'preloaded attachment cache');
mustContain(shareMenu, 'transient user activation', 'Web Share activation safeguard');
mustContain(shareMenu, 'attachments: includeImages ? preparedAttachments : []', 'click-time share uses preloaded files');
mustContain(shareMenu, 'Đã chuẩn bị ${items.length} ảnh', 'prepared image readiness feedback');
mustContain(shareMenu, 'Zalo · Messenger · Telegram · Gmail · SMS', 'generic messaging explanation');
mustContain(contactMenu, 'Chia sẻ / Nhắn qua ứng dụng', 'generic contact share action');
mustNotContain(contactMenu, 'Mở Zalo', 'hard-coded Zalo primary action');
mustNotContain(contactMenu, 'openZalo', 'hard-coded Zalo helper import');
mustContain(defect, '<ShareEntityMenu', 'Defect share entry');
mustContain(defect, 'legacyImageUrls={[defect.imageUrl', 'Defect before/after legacy image support');
mustContain(crew, 'buildCrewRecordShareText', 'daily crew deterministic share text');
mustContain(crew, 'Lưu ý: Sáng/Chiều/Tối là quân số theo ca', 'crew shift semantic warning');
mustContain(crew, 'triggerLabel="Chia sẻ báo cáo"', 'daily crew share entry');
mustContain(config, 'id="system-sync-card"', 'Health Center settings accordion');
mustContain(config, 'title="Trung tâm kiểm tra dữ liệu (Health Center)"', 'Health Center accordion title');
mustContain(config, 'Chẩn đoán hệ thống · cảnh báo đồng bộ/ảnh/quyền · kiểm tra dữ liệu & liên kết.', 'Health Center collapsed diagnostic hint');
mustContain(config, 'Trung tâm kiểm tra dữ liệu (Health Center)', 'unified Health Center title');
mustContain(android, 'public boolean shareFiles(String title, String text, String attachmentsJson)', 'Android shareFiles bridge');
mustContain(android, 'Intent.ACTION_SEND_MULTIPLE', 'Android multi-image share');
mustContain(android, 'Intent.FLAG_GRANT_READ_URI_PERMISSION', 'Android temporary attachment permission');
mustContain(android, 'private boolean openNativeShareChooser', 'Android chooser launch acknowledgement');
mustContain(android, 'finished.await(8, TimeUnit.SECONDS) && opened.get()', 'Do not report success before Android dispatched chooser');
mustContain(android, 'return openNativeShareChooser(Intent.createChooser(share, safeTitle)', 'File share must use launch acknowledgement');

const crewReportModal = read('src/components/CrewReportShareModal.tsx');
const homeDashboard = read('src/components/HomeDashboard.tsx');
const crewTabBase = read('src/components/CrewTabBase.tsx');
const fileExport = read('src/utils/fileExport.ts');
// Both "Trang chủ" and "Quân số" must invoke this same modal (one fixed path).
mustContain(homeDashboard, '<CrewReportShareModal', 'Home crew report export entry');
mustContain(crewTabBase, '<CrewReportShareModal', 'Crew tab crew report export entry');
mustContain(crewReportModal, 'isAndroidExportBridgeAvailable()', 'APK download path detects the native export bridge');
mustContain(crewReportModal, "await saveBlobToDownloads(new Blob([bytes], { type: 'image/png' }), fileName, 'image/png')", 'APK report PNG uses native Downloads saving');
mustContain(crewReportModal, 'await downloadDataUrl(attachment.dataUrl, attachment.fileName)', 'APK report files save sequentially');
mustContain(crewReportModal, 'Đã lưu ${savedCount} ảnh báo cáo vào Tải xuống/QLTC', 'APK success only after native write completes');
mustContain(crewReportModal, 'Không tải được ảnh báo cáo:', 'APK export failure must be shown to the user');
mustContain(fileExport, 'bridge.finishBase64File(sessionId)', 'Android download export finishes the chunked native file');
mustContain(android, 'saveFileToDownloads(export.fileName, export.mimeType, export.tempFile)', 'Android native layer commits export to MediaStore');
mustContain(android, 'Environment.DIRECTORY_DOWNLOADS + "/QLTC"', 'APK download target is Download/QLTC');


console.log('HNL QLTC share center golden: PASS');
