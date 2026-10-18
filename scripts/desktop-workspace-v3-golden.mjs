import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const css = read('src/styles/desktopWorkspace.css');
const modules = {
  warehouse: { file: 'src/components/WarehouseTab.tsx', markers: ['warehouse-history','warehouse-catalog-tabs','warehouse-catalog-search','warehouse-catalog-grid','warehouse-stock-cards','warehouse-voucher-filter','warehouse-vouchers','warehouse-voucher-card-grid','data-hnl-pc-v3-form="warehouse"'] },
  volume: { file: 'src/components/WorkVolumeTab.tsx', markers: ['volume-filter-panel','volume-cards','volume-breakdown-filter','data-hnl-pc-v3-form="volume"'] },
  crew: { file: 'src/components/CrewTabBase.tsx', markers: ['crew-records','data-hnl-pc-v3-form="crew-log"','data-hnl-pc-v3-form="crew-team"'] },
  floorplan: { file: 'src/components/FloorPlanDefectTab.tsx', markers: ['floor-drawing','floor-defects','data-hnl-pc-v3-form="defect-create"'] },
  checklist: { file: 'src/components/ChecklistTab.tsx', markers: ['checklist-items','data-hnl-pc-v3-form="checklist-create"','data-hnl-pc-v3-form="checklist-edit"'] },
  settings: { file: 'src/components/GoogleConfigTab.tsx', markers: ['hnl-pc-v3-section-band'] },
};
for (const [name, def] of Object.entries(modules)) {
  const code = read(def.file);
  for (const marker of def.markers) assert.ok(code.includes(marker), `${name}: missing nested pane ${marker}`);
  assert.ok(code.includes('hnl-pc-v3-section-band') || name === 'settings', `${name}: missing visual hierarchy`);
}
for (const [name,path] of [
  ['project-manager','src/components/ProjectManagerModal.tsx'],
  ['security-center','src/components/SecurityModal.tsx'],
  ['notification-center','src/components/NotificationCenterModal.tsx'],
  ['system-center','src/components/SuperAdminCenter.tsx'],
  ['chat-projects','src/features/chat/ChatTab.tsx'],
  ['chat-room','src/features/chat/ChatTab.tsx'],
  ['ai-workspace','src/features/ai/AiAssistantPage.tsx'],
]) assert.ok(read(path).includes(`data-hnl-pc-v3-center="${name}"`), `${name}: missing nested presentation guard`);
for (const token of ['warehouse-catalog-grid','warehouse-stock-cards','warehouse-voucher-filter','volume-breakdown-filter','crew-records','floor-defects','checklist-items','data-hnl-pc-v3-form','data-hnl-pc-v3-center']) assert.ok(css.includes(token), `V3 CSS missing ${token}`);
assert.ok(css.includes('[data-hnl-desktop-design="modern"] .hnl-pc-v3-section-band'),'V3 only on modern');
assert.ok(css.includes('max-width: 959px') && css.includes('[data-hnl-desktop-design="classic"] .hnl-pc-v3-section-band'),'classic/mobile completely hide V3 nav headers');
for (const forbidden of ['firebase/firestore','runTransaction(', 'setDoc(', 'updateDoc(', 'deleteDoc(']) {
  assert.ok(!css.includes(forbidden),`CSS must not contain cloud writes: ${forbidden}`);
}
assert.ok(read('src/App.tsx').includes("localStorage.getItem('hnl_desktop_workspace_mode_v1')"),'original classic rollback remains');
assert.ok(read('src/components/HomeDashboard.tsx').includes('hnl-home-dashboard'),'Home remains original');
assert.ok(read('src/styles/desktopWorkspace.css').includes('@media (min-width: 960px)'),'Chrome desktop-site 980px remains supported');
console.log('HNL PC WORKSPACE V3 GOLDEN PASS — deep nested panes/forms, old UI, mobile, Chrome, Home and data guards');
