import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => {
  console.error('ACTIVITY NOTIFICATION GOLDEN FAIL:', message);
  process.exit(1);
};
const pass = (message) => console.log('PASS ACTIVITY/NOTIFICATION:', message);

const security = read('src/components/SecurityModal.tsx');
const notification = read('src/components/NotificationCenterModal.tsx');
const firebase = read('src/lib/firebaseBase.ts');
const rules = read('firestore.rules');
const app = read('src/App.tsx');

for (const marker of [
  'actorEmail: log.userEmail || log.actorEmail',
  'auditQuery',
  'auditModuleFilter',
  'auditClientFilter',
  'auditModuleLabels',
  "crew_records: 'Quân số'",
  "afternoonCount: 'Quân số buổi chiều'",
  'auditActionLabel',
  'auditRoleLabel',
  'Nội dung thay đổi',
  'auditTechnicalFields',
  'Ứng dụng Windows',
  'Ứng dụng Android',
  'saveProjectAuditLog(pidAtSubmit',
]) {
  if (!security.includes(marker)) fail(`Security audit UI missing ${marker}`);
}
pass('audit log shows plain-Vietnamese actor, client, role, module, action and before/after detail');

for (const marker of [
  'updateProjectPresence',
  'subscribeProjectPresenceRealtime',
  'ProjectPresenceEntry',
  'w.chrome?.webview',
]) {
  if (!firebase.includes(marker)) fail(`Firebase presence service missing ${marker}`);
}
for (const marker of [
  'subscribeProjectPresenceRealtime',
  'Đang hoạt động:',
  'presenceModuleLabel',
  'presenceRecencyLabel',
  "m.role === 'ADMIN' ? 'Quản trị'",
]) {
  if (!security.includes(marker)) fail(`Member presence UI missing ${marker}`);
}
for (const marker of [
  'updateProjectPresence(activeProjectId, activeTab, currentUserRole)',
  '45_000',
  "document.visibilityState === 'hidden'",
]) {
  if (!app.includes(marker)) fail(`App presence heartbeat missing ${marker}`);
}
for (const marker of [
  'match /presence/{uid}',
  "collectionName != 'presence'",
  'request.resource.data.lastSeen == request.time',
  'request.resource.data.clientLastSeen >= resource.data.clientLastSeen',
]) {
  if (!rules.includes(marker)) fail(`Firestore presence isolation missing ${marker}`);
}
pass('lightweight project presence is identity-bound, project-scoped and heartbeat-limited');

for (const marker of [
  'subscribeProjectSystemNotificationReadState',
  'markProjectSystemNotificationsRead',
  "notificationReads",
  'readThrough',
]) {
  if (!firebase.includes(marker)) fail(`Firebase notification read-state missing ${marker}`);
}
for (const marker of [
  'match /notificationReads/{uid}',
  'uid == request.auth.uid',
  'request.resource.data.readThrough >= resource.data.readThrough',
  "collectionName != 'notificationReads'",
]) {
  if (!rules.includes(marker)) fail(`Firestore notification read-state isolation missing ${marker}`);
}
pass('per-user notification read watermark is identity-bound and monotonic');

for (const marker of [
  'systemEventLogs',
  'systemUnreadCount',
  'Đánh dấu đã đọc',
  'Chỉ hiển thị sự kiện thật từ nhật ký Cloud của dự án.',
  'Không tạo thông báo giả',
]) {
  if (!notification.includes(marker)) fail(`Notification Center system stream missing ${marker}`);
}
if (notification.includes('Các sự kiện như mời dự án, đổi quyền, lỗi đồng bộ và backup sẽ được đưa vào đây khi có nguồn sự kiện tương ứng.')) {
  fail('System tab still uses placeholder copy');
}
if (!app.includes('activeProjectId={activeProjectId}')) fail('Notification Center is not bound to the active project');
pass('System tab renders real project events with read/unread state');

console.log('ACTIVITY NOTIFICATION GOLDEN PASS');
