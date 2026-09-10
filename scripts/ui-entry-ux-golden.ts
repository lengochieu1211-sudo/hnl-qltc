import fs from 'node:fs';

// Regression contract for the unified project/sync/security entry UX.
const read = (path: string) => fs.readFileSync(path, 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const projectManager = read('src/components/ProjectManagerModal.tsx');
assert(!projectManager.includes('Top Tab Bar Switcher'), 'Project list must not expose Sync/Backup tab switcher');
assert(!projectManager.includes('setModalTab('), 'ProjectManager destination must stay fixed by caller initialTab');
assert(projectManager.includes("const modalTab: 'sync' | 'projects' = initialTab === 'sync' ? 'sync' : 'projects';"), 'Dedicated Project/Sync destination mode missing');
assert(projectManager.includes('Trung tâm đồng bộ & sao lưu dự án'), 'Sync Center title missing');
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

const header = read('src/components/GoogleAuthHeader.tsx');
assert(!header.includes('<Wifi'), 'Header Wi-Fi badge must stay removed');
assert(!header.includes('<WifiOff'), 'Header offline Wi-Fi badge must stay removed');
assert(!header.includes('GoogleAuthModal'), 'Header Google login shortcut/modal must stay removed');
assert(header.includes("onOpenProjectManager('projects')"), 'Header Project button must open Project List only');

const security = read('src/components/SecurityModal.tsx');
assert(security.includes('Tài khoản Google/Firebase'), 'Security Center must own Google/Firebase account entry');
assert(security.includes('handleAccountSignIn'), 'Security Center sign-in handler missing');
assert(security.includes('handleAccountSignOut'), 'Security Center sign-out handler missing');

const indicator = read('src/components/ExpandCollapseIndicator.tsx');
assert(!indicator.includes("expandLabel = 'Mở rộng'"), 'Settings disclosure must not render Mở rộng text labels');
assert(!indicator.includes("collapseLabel = 'Thu gọn'"), 'Settings disclosure must not render Thu gọn text labels');
assert(indicator.includes('<X aria-hidden="true"'), 'Opened settings page must expose X close affordance');
assert(indicator.includes("event.key !== 'Escape'"), 'PC Escape close behavior missing');
assert(indicator.includes("window.addEventListener('popstate'"), 'Android/browser Back close behavior missing');

const materialButton = read('src/components/ExpandCollapseButton.tsx');
assert(!materialButton.includes("isMaterialNeedPage ? 'Mở'"), 'Material Need must not render redundant Mở label');
assert(materialButton.includes('aria-label="Đóng Gợi ý vật tư tổng hợp"'), 'Material Need X close control missing');
assert(materialButton.includes("window.addEventListener('popstate'"), 'Material Need Android/browser Back close behavior missing');
const warehouse = read('src/components/WarehouseTab.tsx');
assert(warehouse.includes('aria-controls="material-need-details"'), 'Material Need row trigger missing');
assert(warehouse.includes('role="button"'), 'Material Need heading row must be tappable');

const config = read('src/components/GoogleConfigTab.tsx');
assert(config.includes('Trung tâm đồng bộ & sao lưu dự án'), 'Settings Sync Center entry missing');
assert(config.includes('<details id="system-sync-card"'), 'Health Center must remain collapsed by default in Settings');
assert(!config.includes('<details id="system-sync-card" open'), 'Health Center must not default-open');

console.log('PASS ui-entry-ux-golden: compact collapsed entry cards, close controls and platform Back/Escape rules are intact.');
