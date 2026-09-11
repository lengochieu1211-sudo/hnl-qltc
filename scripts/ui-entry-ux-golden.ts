import fs from 'node:fs';

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
assert(settingsAccordion.includes('<details'), 'Shared Settings entry must retain semantic details anchor for existing navigation');
assert(settingsAccordion.includes('<summary'), 'Shared Settings entry must retain a compact semantic trigger');
assert(settingsAccordion.includes('rounded-2xl border border-slate-200 bg-white shadow-sm'), 'Settings cards must share the same white/border/radius/shadow design system');
assert(settingsAccordion.includes('ChevronDown'), 'Settings cards must use the shared chevron icon');
assert(settingsAccordion.includes("open ? 'rotate-180' : ''"), 'Settings chevron must follow shared sheet open state');
assert(settingsAccordion.includes('duration-200 ease-out'), 'Settings open/close affordance must use one transition timing');
assert(settingsAccordion.includes('createPortal'), 'Settings content must render through the shared body portal');
assert(settingsAccordion.includes('data-hnl-settings-sheet-backdrop'), 'Settings feature sheet backdrop contract missing');
assert(settingsAccordion.includes('data-hnl-settings-sheet={sheetKey}'), 'Settings feature sheet dialog contract missing');
assert(settingsAccordion.includes('role="dialog"') && settingsAccordion.includes('aria-modal="true"'), 'Settings feature sheet accessibility dialog contract missing');
assert(settingsAccordion.includes('fixed inset-x-0 bottom-0 top-[8dvh]'), 'Settings feature sheet must use the shared rounded-sheet viewport geometry');
assert(settingsAccordion.includes("document.body.style.overflow = 'hidden'"), 'Settings sheet must lock background scroll while open');
assert(settingsAccordion.includes("window.addEventListener('popstate'"), 'Settings sheet Android/browser Back behavior missing');
assert(settingsAccordion.includes("event.key !== 'Escape'"), 'Settings sheet Escape close behavior missing');
assert(settingsAccordion.includes('window.history.pushState'), 'Settings sheet history marker behavior missing');
assert(settingsAccordion.includes('flushSync'), 'Settings Back close must synchronously remove stale backdrop interception');
assert(settingsAccordion.includes('env(safe-area-inset-bottom'), 'Settings sheet Android safe-area padding missing');
assert(settingsAccordion.includes('h-10 w-10') && settingsAccordion.includes('h-5 w-5'), 'Settings sheet header icon must stay compact');
assert(settingsAccordion.includes('h-11 w-11') && settingsAccordion.includes('<X className="h-5 w-5"'), 'Settings sheet close control must stay compact');
assert(settingsAccordion.includes('text-[17px] font-semibold'), 'Settings sheet title must use compact medium-weight typography');
assert(settingsAccordion.includes("lazy = false"), 'Shared Settings entry must support lazy heavy content');

const materialButton = read('src/components/ExpandCollapseButton.tsx');
assert(!materialButton.includes("isMaterialNeedPage ? 'Mở'"), 'Material Need must not render redundant Mở label');
assert(materialButton.includes('aria-label="Đóng Gợi ý vật tư tổng hợp"'), 'Material Need X close control missing');
assert(materialButton.includes("window.addEventListener('popstate'"), 'Material Need Android/browser Back close behavior missing');
assert(materialButton.includes("top-[8dvh]"), 'Material Need mobile header must use the same rounded-sheet offset as Settings panels');
assert(materialButton.includes("var(--hnl-dark-surface, #f8fafc)"), 'Material Need panel must be dark-mode aware');
assert(materialButton.includes("env(safe-area-inset-bottom"), 'Material Need Android safe-area padding missing');
assert(materialButton.includes('const onToggleRef = useRef(onToggle)'), 'Material Need panel must not recreate history/backdrop because the inline toggle callback changes identity');
const warehouse = read('src/components/WarehouseTab.tsx');
assert(warehouse.includes('aria-controls="material-need-details"'), 'Material Need row trigger missing');
assert(warehouse.includes('role="button"'), 'Material Need heading row must be tappable');
assert(warehouse.includes('Gợi ý vật tư tổng hợp'), 'Material Need summary card missing');

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

const hostedBrowserGolden = read('scripts/dev-hosted-browser-golden.mjs');
assert(hostedBrowserGolden.includes('five Settings cards share one design system'), 'Hosted browser Golden must verify all five Settings cards share one design system');
assert(hostedBrowserGolden.includes('five Settings entries open in shared feature sheets'), 'Hosted browser Golden must verify all five Settings entries open as feature sheets');
assert(hostedBrowserGolden.includes('Settings sheet close contract'), 'Hosted browser Golden must cover shared close behavior');
assert(hostedBrowserGolden.includes('X + Back + Escape + backdrop'), 'Hosted browser Golden must cover X, Android/browser Back, Escape and backdrop close paths');
assert(hostedBrowserGolden.includes('data-hnl-settings-sheet'), 'Hosted browser Golden must inspect the shared Settings sheet dialog');
assert(hostedBrowserGolden.includes('data-hnl-settings-sheet-backdrop'), 'Hosted browser Golden must inspect the Settings backdrop');
assert(hostedBrowserGolden.includes('must open as a fixed feature sheet'), 'Hosted browser Golden must lock feature-sheet geometry');
assert(hostedBrowserGolden.includes('Sync Center feature sheet keeps existing business controls'), 'Hosted browser Golden must retain Sync Center business/RBAC coverage');
assert(hostedBrowserGolden.includes('Settings page returns to normal scroll/navigation after sheets close'), 'Hosted browser Golden must restore Settings page scroll/navigation after close');
assert(hostedBrowserGolden.includes("const syncSelector = '#sync-backup-card'"), 'Hosted browser Golden must target the stable Sync Center card');
assert(hostedBrowserGolden.includes("const restrictedBackupNotice = sheet.getByText('Sao lưu/khôi phục dữ liệu:'"), 'Hosted browser Golden must keep VIEWER fail-closed RBAC coverage inside the Sync Center sheet');
assert(!hostedBrowserGolden.includes('must expand inline, not become a fixed page/sheet'), 'Hosted browser Golden must not regress to the removed inline-expansion contract');

console.log('PASS ui-entry-ux-golden: five shared Settings feature sheets, Sync Center engine reuse, close/backdrop/history contract, Defect photo icon de-duplication and role-aware Runtime Golden rules are intact.');
