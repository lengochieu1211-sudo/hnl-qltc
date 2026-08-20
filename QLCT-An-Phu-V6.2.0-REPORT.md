# QLCT An Phú V6.2.0 – Audit & Change Report

Base: `QLCT-An-Phu-V6.1.6.1-Conditional-Quick-Sort-FullSource.zip`.

## Đã làm
- Chat dự án theo `projectId`, phòng `general`, realtime 50 tin gần nhất + tải thêm bằng cursor.
- Tin nhắn dùng `serverTimestamp()`, `clientMessageId`, reply, sửa tin của mình, soft delete.
- Unread dùng `messageCount + lastReadMessageCount`, có badge và in-app toast; self-message không toast.
- `@mention` thành viên dự án; `@mọi người` chỉ ADMIN ở UI và Firestore Rules.
- Ảnh chat tái sử dụng photo pipeline hiện có; message chỉ giữ `photoId`, không Base64.
- Trung tâm thông báo tách `Công việc / Tin nhắn / Hệ thống`.
- `Trao đổi` thêm trong menu `Thêm`, không làm BottomNav chính quá đông.
- Firestore Rules tách riêng chat khỏi dữ liệu thi công; Viewer chat được nhưng không ghi business data.
- Member `active=false` mất quyền; member cũ thiếu field `active` vẫn tương thích.
- Chuẩn bị `presenceService`/`typing` bằng RTDB `.info/connected` + `onDisconnect()` + deviceId, nhưng để optional để không phá deploy hiện tại.
- Version tập trung tại `src/config/appVersion.ts`, package `6.2.0`.

## Schema thêm
- `projects/{projectId}/conversations/general`
- `projects/{projectId}/conversations/general/messages/{messageId}`
- `projects/{projectId}/conversations/general/members/{uid}`
- Photo metadata optional: `entityType='chat'`, `category='chat_attachment'`.

## Kiểm tra
- Static parse/transpile: **83 file, 0 lỗi cú pháp**.
- `npm run lint`: chưa chạy hoàn chỉnh vì `npm ci` trong sandbox không cài xong dependency; `tsc` dừng ở các type package thiếu (`TS2688`).
- `npm run build`: chưa PASS trong sandbox; lỗi môi trường `vite: not found` do dependency chưa cài. Không ghi PASS giả.
- Source mới cho chat/presence: khoảng **36,660 bytes** trước minify. Chưa đo được bundle dist trước/sau vì Vite chưa chạy được.

## Rủi ro/giới hạn còn lại
1. Presence/Typing của **thành viên khác** chưa bật production. RTDB Rules không thể trực tiếp kiểm tra Firestore member active; nếu cho mọi authenticated user đọc presence sẽ không đủ riêng tư. `database.rules.json` hiện chỉ cho user đọc/ghi chính UID mình và **chưa gắn vào `firebase.json`**.
2. Push FCM khi app đóng chưa bật; không có server credential/private key trong client. In-app notification đã có.
3. Chat riêng 1-1 chưa triển khai; bản đầu ưu tiên project general.
4. “4 người đã xem” chưa hiển thị; read-state per UID đã có nền.
5. Admin soft-delete tin người khác + audit log chưa triển khai.
6. Tab Hệ thống chưa tạo sự kiện giả; cần nối invitation/role/sync/backup thực tế.
7. Mention nền chỉ theo project đang mở để tránh tăng reads theo số dự án.

## Hiệu năng/chi phí
- 1 tin text: 1 write message + 1 write conversation summary; mở/đọc cập nhật read-state.
- Chỉ listen 50 tin gần nhất; không onSnapshot toàn bộ lịch sử.
- Ảnh dùng thumbnail/local blob/cloud pipeline sẵn có.
- Không thêm dependency mới.
- Chat không đưa vào `Backup_TatCa` mặc định.

## File sửa/thêm
- `.env.example`
- `database.rules.json`
- `firestore.rules`
- `package.json`
- `package-lock.json`
- `UPDATE_V6_2_0.txt`
- `src/App.tsx`
- `src/components/BottomNav.tsx`
- `src/components/GoogleConfigTab.tsx`
- `src/components/NotificationCenterModal.tsx`
- `src/components/PhotoAttachmentPicker.tsx`
- `src/lib/firebase.ts`
- `src/lib/chatService.ts`
- `src/lib/presenceService.ts`
- `src/config/appVersion.ts`
- `src/features/chat/types.ts`
- `src/features/chat/ChatTab.tsx`
- `src/features/chat/PresenceIndicator.tsx`
- `src/features/chat/UnreadBadge.tsx`
- `src/utils/photoStorage.ts`


## Update GitHub
Giải nén PATCH → copy nội dung → Replace vào repo → GitHub Desktop → Commit → Push origin → kiểm tra Build + Deploy.

Commit message:
`V6.2.0 - Add project chat, unread notifications and secure messaging foundation`
