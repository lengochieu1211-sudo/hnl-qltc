# QLCT An Phú V6.2.1 – Audit & Fix Report

## Kết luận
Audit lại V6.2.0 phát hiện một số lỗi quyền và đồng bộ danh sách dự án có thể ảnh hưởng trực tiếp Viewer/Engineer. Các lỗi chắc chắn đã được sửa trong V6.2.1.

## Lỗi đã sửa

### 1. Dự án ma sau khi Viewer/Engineer bị remove
`subscribeCurrentUserProjectsRealtime()` trước đây vẫn fallback sang hint trong `users/{uid}.projects` khi đọc project bị `permission-denied`. Vì user index có thể còn dữ liệu cũ, project đã mất quyền vẫn có thể xuất hiện ở UI.

Sửa: `permission-denied` được coi là authoritative và project bị loại khỏi danh sách Cloud được phép.

### 2. Chat dùng nhầm danh sách cache local
`ChatTab` trước đây nhận `getProjectsList()`, bao gồm project local/recovery. Điều này không đồng nghĩa user hiện tại còn quyền Cloud.

Sửa: thêm `authorizedChatProjects`, chỉ lấy từ realtime project list đã được Firestore xác thực. Project recovery vẫn còn trong Project Manager nhưng không được dùng như quyền Chat.

### 3. Project Cloud bị revoke có thể quay lại dưới dạng recovery local
Project đã từng sync Cloud có thể bị thêm lại bởi nhánh `recoverableLocal` sau khi quyền bị thu hồi.

Sửa: project có `createdAtSource === 'cloud'` không được chuyển ngược thành local recovery khi nó biến mất khỏi danh sách được phép.

### 4. Viewer/Engineer nhận lời mời nhưng project có thể biến mất
Khi đăng nhập, invitation được chuyển thành member và invitation bị xóa, nhưng `users/{uid}.projects` chưa được ghi. Sau khi invitation biến mất, realtime project index có thể không còn nguồn để tìm project.

Sửa: user nhận lời mời tự ghi project vào `users/{uid}.projects` trước khi xóa invitation.

### 5. Mention có thể gợi ý member đã inactive
`findMentionableMembers()` chưa loại `active=false`.

Sửa: member inactive không còn xuất hiện trong @mention.

### 6. Conversation summary quá rộng quyền ghi
Member có thể update document summary conversation với dữ liệu tùy ý, làm sai unread/messageCount.

Sửa Rules: create/update summary phải giữ đúng project/conversation, `lastSenderUid == auth.uid`, `lastMessageAt == request.time`, và `messageCount` chỉ tăng đúng 1. Có compatibility cho summary cũ chưa có `messageCount`.

### 7. Khôi phục Owner theo Gmail bị Rules chặn
Client có chức năng phục hồi ownerUid khi Gmail owner đúng nhưng project update rule trước đây bắt ownerUid bất biến.

Sửa: đúng Gmail owner được phép đổi riêng `ownerUid` + `updatedAt`; không được sửa các field khác qua nhánh recovery.

### 8. Claim orphan project bị Rules chặn
Project legacy không có owner không thể claim dù client có hàm hỗ trợ.

Sửa: cho claim khi cả ownerUid/ownerEmail thực sự trống, và diff chỉ được gồm ownerUid, ownerEmail, updatedAt.

### 9. Tạo metadata project từ claim thiếu createdAt
Project create rules yêu cầu `createdAt` nhưng nhánh claim project mới chưa ghi field này.

Sửa: dùng `serverTimestamp()` cho createdAt và updatedAt.

### 10. Gọi setIsExportPdfOpen(true) lặp hai lần
Không gây mất dữ liệu nhưng là code duplicate không cần thiết.

Sửa: giữ một lần gọi.

## Presence / Typing
Chưa bật vào `firebase.json`. `database.rules.json` hiện không thể cấp quyền xem presence của các member khác theo membership Firestore một cách an toàn bằng client-only Rules. Không mở `.read` rộng để tránh lộ trạng thái user ngoài dự án.

## Build / kiểm tra
Môi trường hiện tại vẫn không cài được dependencies qua `npm ci` (container client error), do đó không ghi Build PASS giả. Các file thay đổi đã được rà lại thủ công và ZIP được kiểm tra CRC sau đóng gói.

## File thay đổi trong PATCH
- `src/App.tsx`
- `src/lib/firebase.ts`
- `src/lib/chatService.ts`
- `src/config/appVersion.ts`
- `firestore.rules`
- `package.json`
- `package-lock.json`
- `UPDATE_V6_2_1.txt`

## Version
V6.2.1 – Chat Permission Hardening
