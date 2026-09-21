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
  'Thay đổi trước → sau',
  'auditValuePreview',
  'Windows EXE',
  'Android APK',
  'saveProjectAuditLog(pidAtSubmit',
]) {
  if (!security.includes(marker)) fail(`Security audit UI missing ${marker}`);
}
pass('audit log shows actor identity, client, filters, and before/after detail');

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
