import fs from 'node:fs';

const replaceOnce = (path, oldText, newText) => {
  const text = fs.readFileSync(path, 'utf8');
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected 1 match, got ${count}`);
  fs.writeFileSync(path, text.replace(oldText, newText));
};

replaceOnce(
  'src/components/SuperAdminCenter.tsx',
  '  Stethoscope,\n',
  ''
);

replaceOnce(
  'src/components/SuperAdminCenter.tsx',
  `    {\n      title: 'Đồng bộ & R2',\n      description: \`Ảnh đang chờ: \${pendingPhotoCount}. Mở công cụ hệ thống để kiểm tra đồng bộ và chẩn đoán.\`,\n      icon: CloudCog,\n      onClick: () => openConfigSection('system-sync-card'),\n    },\n    {\n      title: 'Chẩn đoán hệ thống',\n      description: 'Mở trạng thái Firebase/R2, chẩn đoán, export diagnostic và công cụ phục hồi.',\n      icon: Stethoscope,\n      onClick: () => openConfigSection('system-diagnostics-card'),\n    },`,
  `    {\n      title: 'Đồng bộ, R2 & Chẩn đoán',\n      description: \`Ảnh đang chờ: \${pendingPhotoCount}. Mở HNL Health Center để kiểm tra Firebase/R2, ảnh, đồng bộ, chẩn đoán và phục hồi.\`,\n      icon: CloudCog,\n      onClick: () => openConfigSection('system-sync-card'),\n    },`
);

replaceOnce(
  'src/components/ProjectManagerModal.tsx',
  '    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-md z-50 flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">',
  '    <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-md z-[180] flex items-center justify-center p-3 md:p-4 animate-in fade-in duration-200">'
);

const golden = `import fs from 'node:fs';\n\nconst read = (path: string) => fs.readFileSync(path, 'utf8');\nconst check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };\n\nconst admin = read('src/components/SuperAdminCenter.tsx');\ncheck(admin.includes("sessionStorage.setItem('qlct_config_focus_target', targetId)"), 'Super Admin must persist Config focus intent before navigation.');\ncheck(admin.includes("openConfigSection('trash-recovery-card', onOpenHiddenHistory)"), 'Hidden/history card must target the trash recovery panel.');\ncheck(admin.includes("title: 'Đồng bộ, R2 & Chẩn đoán'"), 'Sync/R2/diagnostics must be presented as one admin action.');\ncheck(admin.includes("openConfigSection('system-sync-card')"), 'Merged Sync/R2/diagnostics card must target the Health Center owner panel.');\ncheck(!admin.includes("title: 'Đồng bộ & R2'"), 'Legacy duplicate Sync/R2 admin action must be removed.');\ncheck(!admin.includes("title: 'Chẩn đoán hệ thống'"), 'Legacy duplicate diagnostics admin action must be removed.');\ncheck(admin.includes('openUiSettingsPanel'), 'UI/module card needs a visible open-and-focus handler.');\ncheck(admin.includes('id=\\"superadmin-ui-settings-card\\"'), 'UI/module panel needs a stable focus id.');\ncheck(admin.includes('onClick: onOpenNotificationCenter'), 'Notification card must invoke the notification opener.');\n\nconst config = read('src/components/GoogleConfigTab.tsx');\ncheck(config.includes("sessionStorage.getItem('qlct_config_focus_target')"), 'Config tab must consume Super Admin focus intent.');\ncheck(config.includes('ownerDetails.open = true'), 'Requested Config details panel must open before focus.');\ncheck(config.includes('id=\\"system-sync-card\\"'), 'HNL Health Center owner panel needs a stable navigation id.');\ncheck(config.includes('id=\\"system-diagnostics-card\\"'), 'Diagnostics content remains inside the merged Health Center.');\ncheck(config.includes('id=\\"trash-recovery-card\\"'), 'Trash/history panel needs a stable navigation id.');\n\nconst projectManager = read('src/components/ProjectManagerModal.tsx');\ncheck(projectManager.includes('z-[180] flex items-center justify-center'), 'Project Manager/advanced sync modal must render above fullscreen Config details.');\n\nconst notifications = read('src/components/NotificationCenterModal.tsx');\ncheck(notifications.includes('z-[100]'), 'Notification modal must render above fullscreen admin/config details.');\n\nconsole.log('Super Admin section navigation golden PASS');\n`;
fs.writeFileSync('scripts/superadmin-navigation-golden.ts', golden);

console.log('Admin Sync Health patch applied');
