import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const admin = read('src/components/SuperAdminCenter.tsx');
check(admin.includes("sessionStorage.setItem('qlct_config_focus_target', targetId)"), 'Super Admin must persist Config focus intent before navigation.');
check(admin.includes("openConfigSection('trash-recovery-card', onOpenHiddenHistory)"), 'Hidden/history card must target the trash recovery panel.');
check(admin.includes("title: 'Đồng bộ, R2 & Chẩn đoán'"), 'Sync/R2/diagnostics must be presented as one admin action.');
check(admin.includes("openConfigSection('system-sync-card')"), 'Merged Sync/R2/diagnostics card must target the Health Center owner panel.');
check(!admin.includes("title: 'Đồng bộ & R2'"), 'Legacy duplicate Sync/R2 admin action must be removed.');
check(!admin.includes("title: 'Chẩn đoán hệ thống'"), 'Legacy duplicate diagnostics admin action must be removed.');
check(admin.includes('openUiSettingsPanel'), 'UI/module card needs a visible open-and-focus handler.');
check(admin.includes('id=\"superadmin-ui-settings-card\"'), 'UI/module panel needs a stable focus id.');
check(admin.includes('onClick: onOpenNotificationCenter'), 'Notification card must invoke the notification opener.');

const config = read('src/components/GoogleConfigTab.tsx');
check(config.includes("sessionStorage.getItem('qlct_config_focus_target')"), 'Config tab must consume Super Admin focus intent.');
check(config.includes('ownerDetails.open = true'), 'Requested Config details panel must open before focus.');
check(config.includes('id=\"system-sync-card\"'), 'HNL Health Center owner panel needs a stable navigation id.');
check(config.includes('id=\"system-diagnostics-card\"'), 'Diagnostics content remains inside the merged Health Center.');
check(config.includes('id=\"trash-recovery-card\"'), 'Trash/history panel needs a stable navigation id.');

const projectManager = read('src/components/ProjectManagerModal.tsx');
check(projectManager.includes('z-[180] flex items-center justify-center'), 'Project Manager/advanced sync modal must render above fullscreen Config details.');

const notifications = read('src/components/NotificationCenterModal.tsx');
check(notifications.includes('z-[100]'), 'Notification modal must render above fullscreen admin/config details.');

console.log('Super Admin section navigation golden PASS');
