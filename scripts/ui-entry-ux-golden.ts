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
assert(!syncCenter.includes('<details'), 'Sync Center must show all function groups without collapsed details');
assert(!syncCenter.includes('<summary'), 'Sync Center must not expose disclosure summaries');
assert(!syncCenter.includes('ExpandCollapseIndicator'), 'Sync Center must not render expand/collapse controls');
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
assert(!indicator.includes('group-open:hidden'), 'Settings detail indicator must not render redundant open text');
assert(!indicator.includes('group-open:inline'), 'Settings detail indicator must not render redundant collapse text');

const materialButton = read('src/components/ExpandCollapseButton.tsx');
assert(!materialButton.includes("isMaterialNeedPage ? 'Mở'"), 'Material Need must not render redundant Mở label');
const warehouse = read('src/components/WarehouseTab.tsx');
assert(warehouse.includes('aria-controls="material-need-details"'), 'Material Need row trigger missing');
assert(warehouse.includes('role="button"'), 'Material Need heading row must be tappable');

console.log('PASS ui-entry-ux-golden: Project List, Sync Center, Security account and disclosure entry rules are intact.');
