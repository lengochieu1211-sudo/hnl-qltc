import fs from 'node:fs';
import { buildCrewReportMatrices, buildCrewReportRows, buildCrewReportText } from '../src/utils/crewReportUtils';

// Regression contract for the unified project/sync/security/settings entry UX.
const read = (path: string) => fs.readFileSync(path, 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const projectManager = read('src/components/ProjectManagerModal.tsx');
assert(!projectManager.includes('Top Tab Bar Switcher'), 'Project list must not expose Sync/Backup tab switcher');
assert(!projectManager.includes('setModalTab('), 'ProjectManager destination must stay fixed by caller initialTab');
assert(projectManager.includes("const modalTab: 'sync' | 'projects' = initialTab === 'sync' ? 'sync' : 'projects';"), 'Dedicated Project/Sync destination mode missing');
assert(projectManager.includes('Trung tâm đồng bộ & sao lưu dự án'), 'Sync Center title missing');
assert(projectManager.includes('title="Đóng"'), 'Sync Center / Project Manager must keep an explicit X close affordance');
const syncStart = projectManager.indexOf("{modalTab === 'sync' && (");
const projectsStart = projectManager.indexOf("{modalTab === 'projects' && (", syncStart + 1);
assert(syncStart >= 0 && projectsStart > syncStart, 'Cannot isolate Sync Center JSX');
const syncCenter = projectManager.slice(syncStart, projectsStart);
assert(!syncCenter.includes('<details'), 'Opened Sync Center must show its function groups without nested collapsed details');
assert(!syncCenter.includes('<summary'), 'Opened Sync Center must not expose nested disclosure summaries');
assert(!syncCenter.includes('ExpandCollapseIndicator'), 'Opened Sync Center must not render nested expand/collapse controls');
assert(!syncCenter.includes('Mở rộng') && !syncCenter.includes('Thu gọn'), 'Sync Center must not render Mở rộng/Thu gọn text');
assert(syncCenter.includes('Cài đặt sao lưu nâng cao'), 'Advanced backup settings must remain visible');
assert(syncCenter.includes('Công cụ đồng bộ nâng cao'), 'Advanced sync tools must remain visible');
assert(syncCenter.includes('Đồng bộ lại dự án này'), 'Manual project re-sync action must remain available');
assert(syncCenter.includes('Xuất bản sao JSON') && syncCenter.includes('Khôi phục từ JSON'), 'JSON backup/restore actions must remain available');

assert(projectManager.includes('inline?: boolean;'), 'ProjectManager must expose an inline mode for the Settings sheet business content');
assert(projectManager.includes("inline ? 'w-full'"), 'Inline Sync Center content must not add its own fixed backdrop inside the shared Settings sheet');
assert(projectManager.includes('{!inline && <div className="flex items-center justify-between pb-3'), 'Inline Sync Center must suppress duplicate modal chrome/header');

const header = read('src/components/GoogleAuthHeader.tsx');
assert(!header.includes('<Wifi'), 'Header Wi-Fi badge must stay removed');
assert(!header.includes('<WifiOff'), 'Header offline Wi-Fi badge must stay removed');
assert(!header.includes('GoogleAuthModal'), 'Header Google login shortcut/modal must stay removed');
assert(header.includes("onOpenProjectManager('projects')"), 'Header Project button must open Project List only');

const security = read('src/components/SecurityModal.tsx');
assert(security.includes('Tài khoản Google/Firebase'), 'Security Center must own Google/Firebase account entry');
assert(security.includes('handleAccountSignIn'), 'Security Center sign-in handler missing');
assert(security.includes('handleAccountSignOut'), 'Security Center sign-out handler missing');
assert(security.includes('PIN được lưu theo dạng bảo mật một chiều'), 'PIN help text must explain one-way storage in plain Vietnamese.');
assert(security.includes('Không có mã PIN chung hoặc PIN đặc biệt để mở khóa.'), 'PIN help text must clearly state there is no master/common PIN.');
assert(security.includes('Quên PIN? Đặt lại bằng Google'), 'PIN recovery copy must use the plain Google-account wording.');
assert(!security.includes('Mã PIN chỉ dùng để khóa màn hình ứng dụng trên thiết bị và được băm 1 chiều PBKDF2 SHA-256.'), 'User-facing PIN help must not expose PBKDF2/SHA-256 jargon.');
const appLockOverlay = read('src/components/AppLockOverlay.tsx');
assert(appLockOverlay.includes('Quên PIN? Đặt lại bằng Google'), 'Locked-screen PIN recovery must match Security Center wording.');
assert(!appLockOverlay.includes('<span>Quên mã PIN? Đặt lại bằng Google Auth</span>'), 'Locked-screen PIN recovery must not expose Google Auth jargon.');

const windowsSyncBridge = read('src/components/WindowsDesktopSyncBridgeCard.tsx');
assert(windowsSyncBridge.includes('Hệ thống tự kiểm tra:'), 'Windows pending-file help must explain checks in plain language.');
assert(windowsSyncBridge.includes('Nếu có lỗi:'), 'Windows pending-file help must explain fail-safe behavior in plain language.');
assert(windowsSyncBridge.includes('thử lại tối đa 50 mục mỗi lần'), 'Windows pending-file help must retain the 50-item retry limit.');
for (const jargon of ['Cấu trúc staging:', 'Fail-closed:', 'attemptToken/photoId', 'không tạo ACK', 'Cloud-verified', 'Firebase Auth/RBAC + R2 upload']) {
  assert(!windowsSyncBridge.includes(jargon), `Windows user help still exposes technical jargon: ${jargon}`);
}

const signOutPrompt = 'Bạn có chắc muốn đăng xuất tài khoản Google/Firebase không?';
const globalConfirm = read('src/components/GlobalConfirmModal.tsx');
const confirmAsyncSource = read('src/utils/confirmAsync.ts');
const firebaseFacade = read('src/lib/firebase.ts');
const securityUtils = read('src/utils/securityUtils.ts');
assert(firebaseFacade.includes('export async function signOutGoogle(): Promise<void>'), 'Firebase facade must centralize sign-out confirmation');
assert(firebaseFacade.includes(signOutPrompt), 'Central Firebase sign-out guard prompt missing');
assert(firebaseFacade.includes("confirmLabel: 'Đăng xuất'"), 'Central sign-out guard must expose an explicit Đăng xuất action');
assert(firebaseFacade.includes('if (!consumeForcedSignOut())'), 'Central sign-out guard must preserve forced security sign-out bypass');
assert(firebaseFacade.includes('await signOutGoogleBase();'), 'Central sign-out guard must delegate to the original Firebase sign-out implementation');
assert(firebaseFacade.includes('export const signOutFirebaseAccount = signOutGoogle;'), 'Firebase account alias must share the centralized sign-out guard');
assert(confirmAsyncSource.includes('options: ConfirmOptions = {}'), 'confirmAsync must remain backwards compatible while supporting action labels');
assert(confirmAsyncSource.includes('markNextSignOutAsForced'), 'One-shot forced sign-out marker missing');
assert(confirmAsyncSource.includes('consumeForcedSignOut'), 'One-shot forced sign-out consumer missing');
assert(securityUtils.includes('markNextSignOutAsForced();'), 'Remote SUPER ADMIN PIN reset must mark the next sign-out as forced');
assert(globalConfirm.includes("confirmData.title || 'Xác nhận'"), 'Global confirmation modal must support a sign-out-specific title');
assert(globalConfirm.includes("confirmData.confirmLabel || 'Đồng ý'"), 'Global confirmation modal must support a sign-out-specific confirm label');
assert(globalConfirm.includes("confirmData.cancelLabel || 'Hủy'"), 'Global confirmation modal must support a sign-out-specific cancel label');
const appSource = read('src/App.tsx');
assert(appSource.includes("SUPER ADMIN đã đặt lại mã PIN"), 'Forced security sign-out flow after SUPER ADMIN PIN reset must remain intact');
assert(appSource.includes('void signOutGoogle();'), 'Forced security sign-out must remain automatic after a remote PIN reset');

const settingsAccordion = read('src/components/SettingsAccordionCard.tsx');
const featureSheet = read('src/components/SettingsFeatureSheet.tsx');
assert(settingsAccordion.includes('<details'), 'Shared Settings entry must retain semantic details anchor for existing navigation');
assert(settingsAccordion.includes('<summary'), 'Shared Settings entry must retain a compact semantic trigger');
assert(settingsAccordion.includes('rounded-2xl border border-slate-200 bg-white shadow-sm'), 'Settings cards must share the same white/border/radius/shadow design system');
assert(settingsAccordion.includes('ChevronDown'), 'Settings cards must use the shared chevron icon');
assert(settingsAccordion.includes("open ? 'rotate-180' : ''"), 'Settings chevron must follow shared sheet open state');
assert(settingsAccordion.includes('duration-200 ease-out'), 'Settings open/close affordance must use one transition timing');
assert(settingsAccordion.includes("import { SettingsFeatureSheet } from './SettingsFeatureSheet';"), 'Settings cards must delegate sheet chrome to SettingsFeatureSheet');
assert(settingsAccordion.includes('<SettingsFeatureSheet'), 'Settings cards must render through SettingsFeatureSheet');
assert(settingsAccordion.includes("lazy = false"), 'Shared Settings entry must support lazy heavy content');

assert(featureSheet.includes('createPortal'), 'SettingsFeatureSheet must render through a body portal');
assert(featureSheet.includes('data-hnl-settings-sheet-backdrop'), 'Shared feature sheet backdrop contract missing');
assert(featureSheet.includes('data-hnl-settings-sheet={sheetKey}'), 'Shared feature sheet dialog contract missing');
assert(featureSheet.includes('role="dialog"') && featureSheet.includes('aria-modal="true"'), 'Shared feature sheet accessibility dialog contract missing');
assert(featureSheet.includes('fixed inset-x-0 bottom-0 top-[8dvh]'), 'Shared feature sheet must use the rounded mobile viewport geometry');
assert(featureSheet.includes("document.body.style.overflow = 'hidden'"), 'Shared feature sheet must lock background scroll while open');
assert(featureSheet.includes("window.addEventListener('popstate'"), 'Shared feature sheet Android/browser Back behavior missing');
assert(featureSheet.includes("event.key !== 'Escape'"), 'Shared feature sheet Escape close behavior missing');
assert(featureSheet.includes('window.history.pushState'), 'Shared feature sheet history marker behavior missing');
assert(featureSheet.includes('flushSync'), 'Shared feature sheet Back close must synchronously remove stale backdrop interception');
assert(featureSheet.includes('env(safe-area-inset-bottom'), 'Shared feature sheet Android safe-area padding missing');
assert(featureSheet.includes('rounded-xl bg-indigo-50 p-2') && featureSheet.includes('h-5 w-5'), 'Shared feature sheet header icon must match the Material Norm 36px/20px title-icon contract');
assert(featureSheet.includes('lg:bottom-[5dvh]') && featureSheet.includes('lg:top-[5dvh]') && featureSheet.includes('lg:rounded-[28px]'), 'Shared feature sheet desktop layout must keep visible top/bottom margins and four rounded corners');
assert(featureSheet.includes('data-hnl-settings-sheet-scrollbody') && featureSheet.includes('scroll-pb-6'), 'Shared feature sheet must expose an independently scrollable body that can reach the final content');
assert(featureSheet.includes('px-7'), 'Shared feature sheet mobile padding must stay at 28px');
assert(featureSheet.includes('text-[17px] font-semibold'), 'Shared feature sheet title must use compact medium-weight typography');
assert(featureSheet.includes('<X className="h-6 w-6"'), 'Shared feature sheet close affordance must be the icon-only X');
assert(!featureSheet.includes('rounded-full border border-slate-200 bg-white'), 'Shared feature sheet X must not regress to a large circular button');

const warehouse = read('src/components/WarehouseTab.tsx');

assert(warehouse.includes("${hasImportAccess ? 'grid-cols-2' : 'grid-cols-1'}"), 'Warehouse Excel actions must collapse to one column when import is not allowed');
assert(!warehouse.includes('<span>Chỉ ADMIN được nhập</span>'), 'Warehouse must hide unavailable bulk-import action instead of rendering a disabled ADMIN-only placeholder');
assert(warehouse.includes('<span>Tải Excel để chỉnh sửa</span>'), 'Warehouse download action keeps one consistent user-facing label across roles');
assert(warehouse.includes('aria-controls="material-need-details"'), 'Material Need row trigger missing');
assert(warehouse.includes('role="button"'), 'Material Need heading row must be tappable');
assert(warehouse.includes('Gợi ý vật tư tổng hợp'), 'Material Need summary card missing');
assert(warehouse.includes("import { SettingsFeatureSheet } from './SettingsFeatureSheet';"), 'Material Need must use the same SettingsFeatureSheet shell as Settings');
assert(warehouse.includes('sheetKey="material-need-details"'), 'Material Need shared sheet key missing');
assert(
  warehouse.includes('description={normalizedStructureConfig.enabled ?')
  && warehouse.includes("'Theo tầng · Theo căn · Theo hạng mục đã khai · Theo đội'"),
  'Material Need shared sheet subtitle must retain the legacy fallback and add Khu/Khối only when enabled'
);
assert(warehouse.includes('icon={PackageSearch}'), 'Material Need shared sheet icon contract missing');
assert(warehouse.includes('materialNeedRoomIds') && warehouse.includes('roomIds: materialNeedRoomIds'), 'Material Need multi-room filter contract missing');
assert(warehouse.includes('materialNeedWorkCategoryIds') && warehouse.includes('workCategoryIds: materialNeedWorkCategoryIds'), 'Material Need declared work-category filter contract missing');
const materialNeedSortStart = warehouse.indexOf('<QuickSortBar<MaterialNeedSortKey>');
const materialNeedSortEnd = warehouse.indexOf('/>', materialNeedSortStart);
assert(materialNeedSortStart >= 0 && materialNeedSortEnd > materialNeedSortStart, 'Cannot isolate Material Need QuickSortBar');
const materialNeedSortBlock = warehouse.slice(materialNeedSortStart, materialNeedSortEnd + 2);
assert(materialNeedSortBlock.includes("{ key: 'material', label: 'Vật tư', kind: 'alpha', defaultOrder: 'asc' }") && materialNeedSortBlock.includes("{ key: 'category', label: 'Nhóm vật tư', kind: 'alpha', defaultOrder: 'asc' }") && materialNeedSortBlock.includes("{ key: 'remaining', label: 'Còn cần', kind: 'number', defaultOrder: 'desc' }") && materialNeedSortBlock.includes("{ key: 'deficit', label: 'Thiếu', kind: 'number', defaultOrder: 'desc' }") && materialNeedSortBlock.includes("{ key: 'stock', label: 'Tồn kho', kind: 'number', defaultOrder: 'desc' }") && materialNeedSortBlock.includes("setMaterialNeedSortBy('default'); setMaterialNeedSortOrder('asc')"), 'Material Need QuickSortBar must use intrinsic need-line semantics: Vật tư · Nhóm vật tư · Còn cần · Thiếu · Tồn kho · Mặc định');
assert(!materialNeedSortBlock.includes("key: 'date'") && !materialNeedSortBlock.includes("label: 'Ngày'") && !materialNeedSortBlock.includes("key: 'location'") && !materialNeedSortBlock.includes("label: 'Vị trí / Tầng'") && !materialNeedSortBlock.includes("key: 'handler'") && !materialNeedSortBlock.includes("label: 'Người thực hiện'") && !materialNeedSortBlock.includes("label: 'Mới nhất'"), 'Material Need must not sort aggregate need rows by unrelated warehouse transaction date/location/handler/latest metadata');
assert(!warehouse.includes('<ExpandCollapseButton'), 'Material Need must not activate the legacy custom floating-sheet implementation');
assert(warehouse.includes('defaultHandler?: string;') && warehouse.includes("defaultHandler = ''"), 'Warehouse must accept project engineer as its default handler.');
assert(warehouse.includes('materialPickerSearch') && warehouse.includes('filteredMaterialNorms'), 'Warehouse create flow must provide searchable material selection.');
assert(warehouse.includes('Tìm vật tư theo tên, nhóm hoặc đơn vị...') && warehouse.includes('Tìm thiết bị...'), 'Warehouse material/equipment search placeholders are missing.');
assert(warehouse.includes('normalizeMaterialSearch') && warehouse.includes(".normalize('NFD')"), 'Warehouse material search must ignore Vietnamese accents/case.');
assert(warehouse.includes('filteredMaterialNorms.slice(0, 20).map') && warehouse.includes('onClick={() => {') && warehouse.includes("setMaterialPickerSearch('');"), 'Warehouse material search must render clickable autocomplete results instead of only filtering a native select.');
assert(warehouse.includes('Lưu & thêm tiếp') && warehouse.includes("value=\"continue\""), 'Warehouse create flow must support save-and-continue multi-item entry.');
assert(warehouse.includes('Vị trí kho / tầng <span className="font-medium text-slate-400">(không bắt buộc)</span>'), 'Warehouse location is visibly optional and must not silently block submit.');
assert(warehouse.includes('Người Giao / Nhận <span className="font-medium text-slate-400">(không bắt buộc)</span>'), 'Warehouse handler is visibly optional when no responsible engineer is configured.');
assert(warehouse.includes('location: location.trim()') && warehouse.includes('handler: handler.trim()'), 'Warehouse optional text fields are normalized before persistence.');
assert(warehouse.includes('const keepOpen = !editingInventory'), 'Warehouse save-and-continue must keep one create session open.');
assert(!warehouse.includes("useState('Kho Tầng 1')"), 'Warehouse must not hard-code Kho Tầng 1 as a fake location default.');
assert(!warehouse.includes("useState('Nguyễn Văn Hùng (Thủ kho)')"), 'Warehouse must not hard-code a fake warehouse handler.');
assert(warehouse.includes("row['handler'] || defaultHandler || ''"), 'Warehouse Excel import must fall back to the configured project engineer, not a fake keeper.');
assert(appSource.includes('defaultHandler={inspectorName}'), 'App must bind Cài đặt → Kỹ sư phụ trách to Warehouse Người Giao / Nhận.');


const config = read('src/components/GoogleConfigTab.tsx');
assert(config.includes('title="Trung tâm đồng bộ & sao lưu"'), 'Settings Sync Center title missing');
assert(config.includes('description="Đồng bộ dữ liệu · R2/ảnh · sao lưu · khôi phục và đối chiếu dữ liệu."'), 'Settings Sync Center description missing');
assert(config.includes('id="sync-backup-card"'), 'Sync Center needs a stable Settings navigation id');
assert(config.includes('id="system-sync-card"'), 'Health Center needs a stable navigation id');
assert(config.includes('id="trash-recovery-card"'), 'Trash/history card needs a stable navigation id');
assert((config.match(/<SettingsAccordionCard/g) || []).length === 5, 'Settings must render exactly five cards through the shared feature-sheet component');
assert(config.includes('syncCenterContent'), 'Sync Center must reuse the existing ProjectManager business engine inside the Settings sheet');
assert(!config.includes('>Trạng thái đồng bộ</div>'), 'Sync Center must not duplicate sync diagnostics already shown in HNL Health Center');
assert(!config.includes('bg-emerald-50/70 p-4 text-left'), 'Old green Sync Center banner styling must be removed');
assert(config.includes('Chất lượng ảnh & dung lượng'), 'Image quality Settings entry missing');
assert(config.includes('Dữ liệu đã ẩn & lịch sử'), 'Hidden data/history Settings entry missing');
assert(config.includes("title={t('formatting_settings')}"), 'Number/date formatting Settings entry missing');
assert(config.includes("label: 'Offline'") && config.includes("label: 'Đang đồng bộ'") && config.includes("label: 'Cần đồng bộ'") && config.includes("label: 'Đã đồng bộ'"), 'Sync Center status badge states are incomplete');

const appSourceForInlineSync = read('src/App.tsx');
assert(appSourceForInlineSync.includes('syncCenterContent={('), 'App must inject the existing Sync Center engine into Settings');
assert(appSourceForInlineSync.includes('<ProjectManagerModal') && appSourceForInlineSync.includes('inline'), 'App must render ProjectManager business content in inline mode inside the shared Settings feature sheet');

const defectUi = read('src/components/FloorPlanDefectTab.tsx');
assert(!defectUi.includes('label="📷 Ảnh Báo Lỗi Ban Đầu (Trước Sửa)"'), 'Defect before-photo label must not duplicate the camera icon with an emoji');
assert(!defectUi.includes('label="🛠️ Ảnh Bằng Chứng Sau Khi Sửa (Tùy Chọn)"'), 'Defect after-photo label must not duplicate picker iconography with an emoji');
assert((defectUi.match(/label="Ảnh Báo Lỗi Ban Đầu \(Trước Sửa\)"/g) || []).length >= 2, 'Defect before-photo label must remain available in create/detail flows');
assert((defectUi.match(/label="Ảnh Bằng Chứng Sau Khi Sửa \(Tùy Chọn\)"/g) || []).length >= 2, 'Defect after-photo label must remain available in create/detail flows');

assert(!defectUi.includes('✓ Bắt Đầu Cấu Hình'), 'Floor-plan action must not show a second check symbol beside the Edit icon.');
assert(!defectUi.includes('<span>💡 <strong>Kéo Vẽ tự do:'), 'Freehand banner must not show a second leading symbol beside the Pencil icon.');
assert(!defectUi.includes('📐 <strong>Đang vẽ lại vùng cho căn'), 'Redraw banner must not show a second leading symbol beside its Lucide icon.');
assert(!defectUi.includes('<span>📋 Dán thường') && !defectUi.includes('<span>📝 Dán đè'), 'Paste actions must use one icon system, not Lucide plus emoji.');
const checklistUi = read('src/components/ChecklistTab.tsx');
const workVolumeUi = read('src/components/WorkVolumeTab.tsx');
const crewUiForPc = read('src/components/CrewTabBase.tsx');
const roomHighlightUiForPc = read('src/components/RoomHighlightModal.tsx');
const photoAttachmentUiForPc = read('src/components/PhotoAttachmentPicker.tsx');
assert(
  crewUiForPc.includes('handleLogSubmit} className="flex-1 min-h-0 p-4 lg:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 overflow-y-auto overscroll-contain'),
  'PC crew log must use the fourth column for Khu/Khối and keep the body scrollable inside the viewport'
);
assert(
  crewUiForPc.includes('md:col-span-2 lg:col-span-4') && crewUiForPc.includes('Quân số theo ca'),
  'PC crew shift/work blocks must span the full four-column form width'
);
assert(
  crewUiForPc.includes("const crewModalRailInsetClass = isDesktopRuntime ? 'left-[84px]' : 'left-0 lg:left-[84px]'"),
  'Crew modals must reserve the 84px desktop/EXE navigation rail instead of being covered by it'
);
assert(
  crewUiForPc.includes('max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]')
    && crewUiForPc.includes('flex-1 min-h-0 p-4 lg:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4')
    && !crewUiForPc.includes('overflow-y-auto max-h-[80vh]'),
  'Crew add/edit modal must fit the real viewport height and scroll only its body on laptop/EXE'
);
assert(
  roomHighlightUiForPc.includes('xl:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.85fr)_minmax(330px,1fr)]'),
  'PC/laptop room inspection rows must use the aligned three-region desktop layout'
);
assert(
  roomHighlightUiForPc.includes('Team stays directly below the sub-item name on PC/laptop/EXE') && roomHighlightUiForPc.includes('Hạng mục con &amp; đội thi công'),
  'PC/laptop room inspection must place the construction team directly below the sub-item name so long team names remain visible'
);
assert(
  roomHighlightUiForPc.includes('className="mt-1.5 flex justify-end"') && roomHighlightUiForPc.includes('className="w-full font-bold border border-slate-200 rounded-lg'),
  'Room inspection Contact action must sit below the full-width team selector instead of squeezing the team name'
);

assert(workVolumeUi.includes('lg:max-w-[1100px]') && workVolumeUi.includes('left-0 lg:left-[84px]'), 'Work Volume editor must use desktop width while reserving the left rail');
assert(warehouse.includes('lg:max-w-[1100px]') && warehouse.includes('left-0 lg:left-[84px]'), 'Warehouse editor must use desktop width while reserving the left rail');
assert(roomHighlightUiForPc.includes('lg:max-w-[1200px]') && roomHighlightUiForPc.includes('left-0 lg:left-[84px]'), 'Room inspection editor must use the wide desktop/EXE sheet without covering the navigation rail');
assert(defectUi.includes('title="Sửa tên / Nhân bản / Xóa"') && defectUi.includes('Mặt bằng</span>'), 'Floor manager must keep the fixed overflow actions and show a safe thumbnail fallback');
assert(defectUi.includes('Tầng chưa gán nhóm hiển thị tại') && !defectUi.includes('Khu/Khối mặc định cho tầng chưa phân nhóm') && !defectUi.includes('legacy chưa có <code>structureGroupId</code>'), 'Floor manager must hide the default-group control when grouping is off and avoid technical legacy wording in the UI');

assert((defectUi.match(/grid grid-cols-1 lg:grid-cols-2 gap-3 items-start/g) || []).length >= 2, 'PC/laptop floor-plan room and defect lists must use two columns while mobile stays one column');
assert((crewUiForPc.match(/grid grid-cols-1 lg:grid-cols-2 gap-3 items-start/g) || []).length >= 2, 'PC/laptop crew daily logs and team room cards must use two columns while mobile stays one column');
assert(crewUiForPc.includes('grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch'), 'Team directory paired cards must stretch to equal height on PC/laptop/EXE');
assert(crewUiForPc.includes('h-full flex flex-col bg-white border border-slate-200') && crewUiForPc.includes('className="w-full mt-auto flex items-center justify-center'), 'Team directory actions must align at the card bottom when paired cards have different content lengths');
assert(crewUiForPc.split('grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start').length - 1 >= 2, 'PC/laptop Team Info defect and work-log lists must use two columns while mobile/APK stays one column');
assert(crewUiForPc.includes('hidden 2xl:grid 2xl:grid-cols-2 gap-2 border-b'), 'Team Info overview widgets must stay hidden on ordinary laptop/EXE widths so tabs are not pushed below the fold');
assert(!crewUiForPc.includes('Lọc đội theo ${normalizedStructureConfig.label}'), 'Team directory must not show the redundant Khu/Khối selector on web/mobile/APK');
assert(!crewUiForPc.includes('aria-label={`Lọc quân số theo ${normalizedStructureConfig.label}`}'), 'Crew daily view must not expose a global Khu/Khối filter');
assert(crewUiForPc.includes("const selectedStructureGroupId = 'all';"), 'Crew stats and reports must stay project-wide after hiding the global Khu/Khối filter');
assert(crewUiForPc.includes("{ key: 'structure', label: normalizedStructureConfig.enabled ? normalizedStructureConfig.label : 'Khu/Khối', kind: 'alpha' }"), 'Team Quick Sort must retain Khu/Khối ordering when the team list reaches the six-item threshold');
assert(warehouse.includes('grid grid-cols-1 lg:grid-cols-2 gap-3 items-start'), 'PC/laptop warehouse transaction history must use two columns while mobile stays one column');
assert(workVolumeUi.includes('grid grid-cols-1 lg:grid-cols-2 gap-3 items-start'), 'PC/laptop work-volume cards must use two columns while mobile stays one column');
assert(workVolumeUi.includes('h-6 text-slate-700 font-bold mb-1 flex items-center') && workVolumeUi.includes('min-h-11 border border-slate-200 rounded-xl'), 'PC/laptop Work Volume floor and category fields must align to the same label/control row height');
assert(
  warehouse.indexOf('{/* Material / Equipment Search + Select */}', warehouse.indexOf('{/* Type Toggle */}')) > warehouse.indexOf('{/* Type Toggle */}') &&
  warehouse.indexOf('{/* Material / Equipment Search + Select */}', warehouse.indexOf('{/* Type Toggle */}')) < warehouse.indexOf("{type === 'out' && (", warehouse.indexOf('{/* Type Toggle */}')) &&
  warehouse.includes('space-y-1.5 lg:col-span-6') &&
  warehouse.includes('grid grid-cols-1 lg:grid-cols-2 gap-3 items-end'),
  'Warehouse material/equipment search and selector must sit directly below receipt type in one aligned desktop row'
);
assert(warehouse.includes('title="Danh mục kho"') && warehouse.includes("(['material', 'equipment'] as InventoryItemKind[]).map"), 'Warehouse must expose the combined Danh mục kho view with separate Vật tư/Thiết bị tabs without renaming material norms');
assert(warehouse.includes('warehouseCatalogStockRows') && warehouse.includes('totalIn: Number(summary?.totalIn || 0)') && warehouse.includes("normQuantity: expectedKind === 'material' ? Number(summary?.normQuantity || 0) : null") && warehouse.includes('currentStock: Number(summary?.currentStock || 0)'), 'Danh mục kho must derive Nhập/Xuất/Định mức/Tồn read-only from the existing warehouse ledger/norm summaries');
assert(warehouse.includes('Khối lượng định mức') && warehouse.includes("warehouseCatalogTab === 'material' ? formatDecimal(item.normQuantity || 0) : '—'"), 'Danh mục kho must show material norm quantity while equipment stays outside norm logic');
assert(warehouse.includes('<span className="text-right">Tồn kho</span>') && warehouse.includes('formatDecimal(item.currentStock)'), 'Danh mục kho must show current stock on both desktop and mobile layouts');
assert(warehouse.includes('min-w-[760px]') && warehouse.includes('grid-cols-[minmax(180px,1.6fr)_120px_52px_64px_64px_104px_76px]'), 'Danh mục kho must keep all seven columns available on mobile via horizontal scrolling: Tên, Nhóm, ĐVT, Nhập, Xuất, Định mức, Tồn kho.');
assert(warehouse.includes('Tổng hợp vật tư và thiết bị theo Nhập, Xuất, Tồn kho; vật tư hiển thị thêm Khối lượng định mức.'), 'Danh mục kho subtitle must explain material/equipment stock data without implying equipment has a norm.');
assert(warehouse.includes('text-[11px] font-bold text-slate-600') && !warehouse.includes('font-extrabold uppercase tracking-wide text-slate-500'), 'Danh mục kho table headings must use sentence case instead of forced uppercase.');
assert(warehouse.includes("'Nhập kho' : 'Xuất kho'") && warehouse.includes("item.itemKind === 'equipment' ? 'Thiết bị'") && warehouse.includes("> Nhập kho") && warehouse.includes("> Xuất kho"), 'Warehouse visible status labels must use sentence case consistently.');
assert(warehouse.includes('QuickSortBar<WarehouseCatalogSortKey>') && warehouse.includes("{ key: 'totalIn', label: 'Nhập', kind: 'number', defaultOrder: 'desc' }") && warehouse.includes("{ key: 'currentStock', label: 'Tồn kho', kind: 'number', defaultOrder: 'desc' }"), 'Danh mục kho must provide quick sorting for name and ledger-derived stock columns.');
assert(warehouse.includes("{ key: 'category', label: 'Nhóm', kind: 'alpha', defaultOrder: 'asc' }") && warehouse.includes("{ key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' }"), 'Danh mục kho must expose Group and Unit as explicit columns and quick-sort dimensions.');
assert(warehouse.includes('min-w-[760px]') && warehouse.includes('grid-cols-[minmax(180px,1.6fr)_120px_52px_64px_64px_104px_76px]'), 'Danh mục kho must keep Group, Unit, Nhập, Xuất, Định mức and Tồn kho visible through horizontal scrolling.');
assert(warehouse.includes("warehouseCatalogTab === 'material'") && warehouse.includes("key: 'normQuantity' as const"), 'Danh mục kho must expose norm sorting only for materials.');
assert(warehouse.includes("{ key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' }") && warehouse.includes('<th className="p-2 text-left">Nhóm vật tư</th><th className="p-2 text-left">ĐVT</th>'), 'Gợi ý vật tư must show Group and Unit as separate explicit columns.');
assert(warehouse.includes('min-w-[900px]') && warehouse.includes('{line.category}</td>') && warehouse.includes('{line.unit}</td>'), 'Gợi ý vật tư must preserve separate Group and Unit data on responsive tables.');
assert(!warehouse.includes('Danh mục &amp; tồn kho'), 'Bảng tổng tồn kho must not duplicate the Danh mục kho navigation button.');
assert(warehouse.includes('whitespace-normal break-words font-bold leading-snug text-slate-800'), 'Danh mục kho must show complete material/equipment names instead of truncating them.');
assert(warehouse.includes("itemKind === 'equipment' ? 'Tên thiết bị' : 'Tên vật tư'"), 'Warehouse form must use dynamic Vật tư/Thiết bị labels');
assert(warehouse.includes('Thêm thiết bị mới') && warehouse.includes('Chọn thiết bị có sẵn'), 'Equipment must be reusable after first declaration without a Tên khác flow');
assert(warehouse.includes("itemKind === 'material' && (") && warehouse.includes('Tên vật tư khác'), 'Custom Tên vật tư khác input must stay material-only');
assert(warehouse.includes("itemKind === 'material' && issuePurpose === 'project-work' && finalIssueWorkCategoryId"), 'Equipment must never persist material work-category linkage');
assert(warehouse.includes('Thiết bị được dùng lại ở các phiếu nhập/xuất nhưng không tham gia Định mức vật tư hoặc Gợi ý vật tư.'), 'Warehouse catalog must state the equipment/material-norm separation');
assert(!crewUiForPc.includes('value={logStructureGroupId}'), 'Crew add/edit form must keep the Khu/Khối selector hidden');
assert(crewUiForPc.includes('hnl-crew-date-input') && crewUiForPc.includes('aria-label="Chọn ngày quân số"'), 'Crew date must remain directly clickable while hiding the redundant browser dropdown icon');
const globalThemeCss = read('src/index.css');
assert(read('src/components/HomeDashboard.tsx').includes('hnl-home-dashboard'), 'Home dashboard must opt into the centralized dark surface override');
assert(globalThemeCss.includes('.hnl-home-dashboard') && globalThemeCss.includes('.hnl-crew-date-input'), 'Global theme must cover Home dark mode and the Crew date control centrally');

assert(!defectUi.includes('text-[9px] font-bold text-slate-500">Tên cấp Khu/Khối</div>'), 'Floor manager must not repeat the Khu/Khối level name in a separate card');
assert(photoAttachmentUiForPc.includes('compactViewerButton?: boolean;') && photoAttachmentUiForPc.includes('Mở ảnh hiện trường toàn màn hình'), 'Crew field-photo button must open the shared full-screen viewer directly without expanding thumbnails');
assert(workVolumeUi.includes('<Download className="w-3.5 h-3.5" /> Tải Excel để chỉnh sửa'), 'Work Volume download action keeps one consistent label across roles');
assert(workVolumeUi.includes('{hasStructureManageAccess && ('), 'Work Volume must hide ADMIN-only import/create actions from Engineer/Viewer');

const multiProjectAccessUi = read('src/components/MultiProjectAccessPanel.tsx');
const securityModalUi = read('src/components/SecurityModal.tsx');
const multiProjectOverviewUi = read('src/components/MultiProjectOverview.tsx');
const homeDashboardUi = read('src/components/HomeDashboard.tsx');
const navSource = read('src/components/BottomNav.tsx');
assert(multiProjectAccessUi.includes('Nhiều dự án'), 'Security Center must expose central multi-project access management');
assert(securityModalUi.includes('Thành viên & phân quyền') && securityModalUi.includes('Theo dự án') && securityModalUi.includes('Nhiều dự án'), 'Security Center must unify member access under project and multi-project tabs');
assert(securityModalUi.includes('value={selectedPid}') && securityModalUi.includes('setSelectedPid'), 'Per-project member view must retain project switching');
assert(multiProjectAccessUi.includes('Không cấp quyền'), 'Central access manager must support explicit per-project revoke state');
assert(multiProjectAccessUi.includes('Áp dụng cho dự án đã chọn'), 'Central access manager must support batch role drafting without visiting each project');
assert(multiProjectAccessUi.includes('applyProjectMemberAccessChangesAtomically'), 'Central access manager must commit canonical membership through the atomic multi-project engine');
assert(multiProjectAccessUi.includes("liveActorRole.verification !== 'verified'"), 'Central access manager must fail closed when live ADMIN verification is unavailable');
assert(!appSource.includes('!isOnline || authorizedChatProjects.length < 2'), 'Verified cached multi-project overview must remain available during offline startup');
assert(multiProjectOverviewUi.includes('Tổng quan dự án'), 'Secondary multi-project overview must remain available');
assert(multiProjectOverviewUi.includes('Mở dự án'), 'Multi-project overview must offer an explicit project entry action');
assert(homeDashboardUi.includes('Tổng quan công trường') && !homeDashboardUi.includes('Trung tâm điều hành HNL QLTC'), 'Home must use the compact non-duplicated command-center heading');
assert(homeDashboardUi.includes('Mở thẳng dự án này khi khởi động'), 'Home must expose an explicit quick-start project preference');
assert(homeDashboardUi.includes('Chưa tải được dữ liệu quân số'), 'Home must clearly mark unavailable project manpower data without inventing metrics');
assert(!homeDashboardUi.includes('Firebase / R2 / projectId / RBAC không thay đổi.'), 'Home must not expose implementation/audit notes to end users');
assert(appSource.includes("useState<TabType>('home')"), 'Home must be the default navigation destination');
assert(appSource.includes("new URLSearchParams(window.location.search).get('app') === 'desktop'") && appSource.includes("isDesktopRuntime ? 'pl-[84px]' : 'lg:pl-[84px]'") && appSource.includes('forceDesktopRail={isDesktopRuntime}'), 'Windows EXE runtime must reserve the left rail even when its viewport becomes narrower than the browser desktop breakpoint');
assert(navSource.includes("'home' | 'warehouse'"), 'Navigation type must include Home');
assert(navSource.includes('forceDesktopRail') && navSource.includes("forceDesktopRail ? 'flex' : 'hidden lg:flex'") && navSource.includes("forceDesktopRail ? 'hidden' : 'lg:hidden'") && navSource.includes('bg-white text-slate-700'), 'Windows EXE must keep the desktop left rail at narrow widths while browser/mobile keeps responsive bottom navigation');
assert(!navSource.includes('APP_VERSION') && !navSource.includes('HNL QLTC · Trang chủ'), 'Desktop rail must not duplicate the header logo or persistent version label');
assert(navSource.includes("label: 'Trang chủ'"), 'Visible Home navigation label must be Vietnamese: Trang chủ');
assert(homeDashboardUi.includes('Báo cáo quân số nhiều dự án'), 'Trang chủ must expose multi-project manpower reporting');
assert(homeDashboardUi.includes('fetchProjectCrewReportData'), 'Trang chủ must load only targeted manpower/team data for other projects');
assert(homeDashboardUi.includes('Chia sẻ báo cáo quân số'), 'Trang chủ manpower report must expose the agreed share-report action');
assert(homeDashboardUi.includes('buildCrewReportMatrices') && homeDashboardUi.includes('colSpan={4}') && homeDashboardUi.includes('Tổng QS/ngày') && homeDashboardUi.includes('TỔNG'), 'Trang chủ manpower report must render date rows, team column groups, daily totals and a final column-total row');
assert(homeDashboardUi.includes('relative isolate max-h-[440px] overflow-auto overscroll-contain') && homeDashboardUi.includes('<tr className="h-8">') && homeDashboardUi.includes('sticky top-[31px]'), 'Trang chủ crew table sticky header must stay contained and overlap by 1px so no scroll seam can show through');
const crewUi = read('src/components/CrewTabBase.tsx');
const crewShareUi = read('src/components/CrewReportShareModal.tsx');
assert(crewUi.includes('Chia sẻ báo cáo quân số') && !crewUi.includes('1 ngày / nhiều ngày · nội dung / ảnh'), 'Crew screen must expose the concise consolidated share-report entry');
assert(crewUi.includes('workVolumeAppliesToFloor') && crewUi.includes('crew-category-options-') && crewUi.includes('Chọn hạng mục đã khai báo hoặc nhập khác') && crewUi.includes('crew-subitem-options-') && crewUi.includes('Chọn công đoạn đã khai báo hoặc nhập khác'), 'Crew entry must suggest declared work categories/sub-items while preserving custom text entry');
assert(crewUi.includes('openRoomOnFloorPlan') && crewUi.includes('openDefectOnFloorPlan') && crewUi.includes('qlct_diagnostic_navigation_request') && crewUi.includes('qlct_pending_defect_navigation'), 'Team detail must drill down to exact room/defect entities on the floor plan');
assert(crewUi.includes('Xem các Căn/Phòng đội đang làm') && crewUi.includes('Mở Defect trên mặt bằng') && crewUi.includes('Căn/Phòng:'), 'Team KPI, room and defect cards must expose direct-view affordances and linked room labels');
assert(crewUi.includes("'__teamId': item.id") && crewUi.includes("'Tên Đội Thi Công': item.name") && crewUi.includes("key === '__teamId' ? { hidden: true } : {}"), 'Team Excel download must keep human team name visible and technical teamId hidden');
assert(crewUi.includes("const teamNameAliases = new Set([") && crewUi.includes("if (!normalized || normalized.startsWith('__')) return false;") && crewUi.includes("if (rawTeamId && nameStr === rawTeamId)"), 'Team Excel re-import must never resolve __teamId as the human-facing team-name column');
assert(defectUi.includes('activeDefectRoomName') && defectUi.includes('🏠 Căn/Phòng:'), 'Defect list/detail must show linked Căn/Phòng when roomId resolves');
assert(!defectUi.includes('⚡ Chọn Nhanh Bằng 1 Click:') && !defectUi.includes('✅ Đội Defect đang chọn:') && !defectUi.includes('🏢 Đội trên mặt bằng tầng:') && !defectUi.includes('📋 Đội đã khai báo:'), 'Defect assignee editor must not duplicate the canonical team selector with repeated quick-pick blocks');
assert(defectUi.includes('buildDefectShareText(defect, defectRoomName)') && defectUi.includes('buildDefectShareText(activeDefectDetail, activeDefectRoomName)'), 'Defect share must use the linked Căn/Phòng name in list and detail flows');
assert(crewShareUi.includes('Sao chép nội dung') && crewShareUi.includes('Chia sẻ ảnh') && crewShareUi.includes('Tải ảnh'), 'Crew report sharing must support content, image share and image download');
assert(!crewShareUi.includes('Tải ảnh PNG') && !crewShareUi.includes('JPEG'), 'Crew report UI must not expose image file-format jargon');
assert(crewShareUi.includes('colSpan={4}') && crewShareUi.includes('— = chưa báo') && crewShareUi.includes('Tổng QS/ngày') && crewShareUi.includes('TỔNG'), 'Crew report preview must preserve matrix semantics and expose daily/column totals');
assert(crewShareUi.includes('relative isolate max-h-[42vh] overflow-auto overscroll-contain') && crewShareUi.includes('<tr className="h-8">') && crewShareUi.includes('sticky top-[31px]'), 'Crew share preview sticky header must stay contained and overlap by 1px so no scroll seam can show through');

const crewReportRows = buildCrewReportRows([{
  projectId: 'p1', projectName: 'DA 1',
  teams: [
    { id: 't1', name: 'Đội A', leader: '', defaultCount: 0 },
    { id: 't2', name: 'Đội B', leader: '', defaultCount: 0 },
  ],
  records: [
    {
      id: 'r1', teamId: 't1', teamName: 'Đội A', leaderName: '', date: '2026-09-22',
      workerCount: 0, morningCount: 0, afternoonCount: 0, eveningCount: 0, taskDescription: '',
    },
    {
      id: 'r2', teamId: 't1', teamName: 'Đội A', leaderName: '', date: '2026-09-23',
      workerCount: 3, morningCount: 3, afternoonCount: 2, eveningCount: 1, taskDescription: '',
    },
    {
      id: 'r3', teamId: 't2', teamName: 'Đội B', leaderName: '', date: '2026-09-23',
      workerCount: 2, morningCount: 2, afternoonCount: 2, eveningCount: 0, taskDescription: '',
    },
  ],
}], '2026-09-22', '2026-09-23');
const zeroReport = crewReportRows.find((row) => row.teamId === 't1' && row.date === '2026-09-22');
const missingReport = crewReportRows.find((row) => row.teamId === 't2' && row.date === '2026-09-22');
assert(Boolean(zeroReport?.reported) && zeroReport?.morning === 0 && zeroReport?.dailyHeadcount === 0, 'Crew report must preserve an explicit zero as reported, not missing');
assert(missingReport?.reported === false && missingReport?.morning === null, 'Crew report must distinguish missing daily report from zero');
const matrices = buildCrewReportMatrices(crewReportRows);
assert(matrices.length === 1 && matrices[0].teams.length === 2 && matrices[0].dates.length === 2, 'Crew report matrix must group teams into columns and dates into rows');
assert(matrices[0].dates[0].cells['id:t1']?.reported === true && matrices[0].dates[0].cells['id:t2']?.reported === false, 'Crew report matrix must preserve reported-zero versus missing semantics');
assert(matrices[0].dates[0].totalDailyHeadcount === 0 && matrices[0].dates[1].totalDailyHeadcount === 5, 'Crew report matrix must sum QS ngày across teams for each date');
assert(matrices[0].teamTotals['id:t1']?.morning === 3 && matrices[0].teamTotals['id:t1']?.afternoon === 2 && matrices[0].teamTotals['id:t1']?.evening === 1 && matrices[0].teamTotals['id:t1']?.dailyHeadcount === 3, 'Crew report final row must sum every Team A shift/QS-day column');
assert(matrices[0].teamTotals['id:t2']?.morning === 2 && matrices[0].teamTotals['id:t2']?.afternoon === 2 && matrices[0].teamTotals['id:t2']?.dailyHeadcount === 2, 'Crew report final row must sum Team B independently');
assert(matrices[0].grandDailyHeadcount === 5, 'Crew report bottom-right total must equal total person-days across the selected range');
const crewReportText = buildCrewReportText({ rows: crewReportRows, startDate: '2026-09-22', endDate: '2026-09-23' });
assert(crewReportText.includes('Đội A: Sáng 0') && crewReportText.includes('Đội B: Chưa báo'), 'Crew report text must preserve 0 vs Chưa báo semantics');
assert(crewReportText.includes('Tổng QS/ngày: 5 người') && crewReportText.includes('TỔNG') && crewReportText.includes('Tổng lượt người-ngày: 5'), 'Crew report text must include per-day totals and the final multi-day total block');
const warehouseUi = read('src/components/WarehouseTab.tsx');
const offlineBannerUi = read('src/components/OfflineSyncBanner.tsx');
const roomHighlightUi = read('src/components/RoomHighlightModal.tsx');
assert(workVolumeUi.includes('Tổng hợp tiến độ khối lượng & giá trị') && workVolumeUi.includes('Chưa khai báo đơn giá') && workVolumeUi.includes('Giá trị đã thực hiện') && workVolumeUi.includes('Object.entries(totals.byUnit)'), 'Work Volume summary must show the same physical quantities for every role and add financial values only as supplementary ADMIN information');
for (const source of [checklistUi, workVolumeUi]) {
  assert(!source.includes('🚨 Quá hạn') && !source.includes('⏰ Hạn hôm nay') && !source.includes('🔔 Còn {diffDays} ngày'), 'Due-date badges must not duplicate Lucide status icons with emoji.');
}
assert(!warehouseUi.includes('🚨 Cảnh Báo Vật Tư') && !warehouseUi.includes('⚠️ Cảnh báo định mức nhập kho'), 'Warehouse warning headings must not duplicate warning icons with emoji.');
assert(!offlineBannerUi.includes("'📶 Đã có kết nối Internet trở lại!'"), 'Reconnect banner must not duplicate the Wifi icon with an emoji.');
assert(!roomHighlightUi.includes('📐 Tùy chỉnh kích thước &amp; tọa độ'), 'Room dimension settings must not duplicate the section icon with an emoji.');
assert(!projectManager.includes('🔗 Chọn Tệp Trên Máy Để Liên Kết Auto-Save'), 'Project Manager link action must not duplicate its Lucide icon with an emoji.');

const hostedBrowserGolden = read('scripts/dev-hosted-browser-golden.mjs');
assert(hostedBrowserGolden.includes('five Settings cards share one design system'), 'Hosted browser Golden must verify all five Settings cards share one design system');
assert(hostedBrowserGolden.includes('five Settings entries open in shared feature sheets'), 'Hosted browser Golden must verify all five Settings entries open as feature sheets');
assert(hostedBrowserGolden.includes('Settings sheet close contract'), 'Hosted browser Golden must cover shared close behavior');
assert(hostedBrowserGolden.includes('X + Back + Escape + backdrop'), 'Hosted browser Golden must cover X, Android/browser Back, Escape and backdrop close paths');
assert(hostedBrowserGolden.includes('data-hnl-settings-sheet'), 'Hosted browser Golden must inspect the shared Settings sheet dialog');
assert(hostedBrowserGolden.includes('data-hnl-settings-sheet-backdrop'), 'Hosted browser Golden must inspect the Settings backdrop');
assert(hostedBrowserGolden.includes('must open as a fixed feature sheet'), 'Hosted browser Golden must lock feature-sheet geometry');
assert(hostedBrowserGolden.includes('Sync Center feature sheet keeps existing business controls'), 'Hosted browser Golden must retain Sync Center business/RBAC coverage');
assert(hostedBrowserGolden.includes('Settings page returns to normal responsive navigation after sheets close'), 'Hosted browser Golden must restore the correct desktop-left/mobile-bottom navigation after close');
assert(hostedBrowserGolden.includes("const syncSelector = '#sync-backup-card'"), 'Hosted browser Golden must target the stable Sync Center card');
assert(hostedBrowserGolden.includes("const restrictedBackupNotice = sheet.getByText('Sao lưu/khôi phục dữ liệu:'"), 'Hosted browser Golden must keep VIEWER fail-closed RBAC coverage inside the Sync Center sheet');
assert(!hostedBrowserGolden.includes('must expand inline, not become a fixed page/sheet'), 'Hosted browser Golden must not regress to the removed inline-expansion contract');

console.log('PASS ui-entry-ux-golden: shared Settings feature sheets, Material Need semantic quick-sort, Sync Center engine reuse, close/backdrop/history contract, Defect photo icon de-duplication and role-aware Runtime Golden rules are intact.');