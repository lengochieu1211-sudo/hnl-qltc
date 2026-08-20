# QLCT An Phú V6.2.5 – Project Access Recovery

## Lỗi P0 được xử lý
Tài khoản đã tồn tại trong `projects/{projectId}/members/{email}` với role VIEWER/ENGINEER nhưng sau khi đăng nhập lại có thể thấy `Danh sách dự án (0)`.

### Nguyên nhân gốc
1. Invitation cũ có thể bị xóa dù `users/{uid}.projects` chưa ghi thành công.
2. `subscribeCurrentUserProjectsRealtime()` chỉ có thể tìm project qua user index/invitation/owner; nếu invitation đã mất và user index bị thiếu, member email vẫn hợp lệ nhưng app không biết projectId để đọc.
3. Luồng materialize member UID của invitee gọi ghi cả document email và UID; document email là ADMIN-only nên invitee có thể bị chặn trước khi tạo UID member.
4. Realtime project list chỉ listen `invitedEmail`, chưa hỗ trợ invitation legacy chỉ có field `email`.
5. GitHub workflow cho phép Firestore Rules deploy lỗi nhưng vẫn tiếp tục (`continue-on-error: true`).

## Thay đổi V6.2.5

### 1. Durable project access discovery index
Thêm collection Cloud nhẹ:
`projectAccess/{projectId}__{encodedEmail}`

Field:
- projectId
- email
- role
- projectName
- active
- updatedAt

Index này chỉ dùng để tìm project; nó KHÔNG cấp quyền đọc dữ liệu. Quyền thật vẫn kiểm tra bằng `projects/{projectId}/members` + Firestore Rules.

### 2. Tự phục hồi `users/{uid}.projects`
Khi user đọc được projectAccess của chính email, client tự ghi lại project tương ứng vào `users/{uid}.projects`.

### 3. Admin/Owner tự repair member cũ
Owner khi mở app sẽ tự tạo projectAccess cho toàn bộ member active của project.
Trong Security Modal, ADMIN cũng chạy repair khi xác nhận role Cloud ADMIN.

### 4. Không xóa invitation quá sớm
Invitation chỉ được xóa sau khi:
- member UID được materialize thành công; và
- `users/{uid}.projects` được ghi thành công.

Nếu có lỗi mạng/quyền tạm thời, invitation được giữ lại để user vẫn còn đường tìm project.

### 5. Materialize UID member an toàn
Firestore Rules cho phép invitee tự tạo/update CHÍNH document `members/{auth.uid}` khi:
- đã có member document theo email active;
- email == auth email;
- role mới == role của member email;
- uid == auth.uid.

Không thể tự nâng VIEWER -> ENGINEER/ADMIN.

### 6. Hỗ trợ invitation legacy
Realtime project list listen cả:
- `invitedEmail == currentEmail`
- `email == currentEmail`

### 7. Remove member cleanup
Khi remove member, xóa thêm projectAccess tương ứng.

### 8. Firestore Rules deployment bắt buộc
Bỏ `continue-on-error: true` khỏi GitHub Actions deploy Firestore Rules.
Nếu Rules deploy thất bại, workflow phải báo lỗi để không có tình trạng Hosting mới + Rules cũ.

### 9. Version
V6.2.5 – Project Access Recovery

## Files changed
- src/lib/firebase.ts
- src/components/SecurityModal.tsx
- firestore.rules
- src/config/appVersion.ts
- package.json
- package-lock.json
- .github/workflows/firebase-hosting-merge.yml
- .github/workflows/firebase-hosting-pull-request.yml

## Kiểm tra đã chạy
- Static parse 81 TS/TSX: 0 syntax errors.
- GitHub workflow YAML: parse PASS.
- firestore.rules: braces/parens balanced.
- Full Firebase CLI rules compile chưa chạy trong container vì firebase-tools không được cài sẵn.

## Test sau deploy
1. Đăng nhập Owner/Admin và mở LTIA một lần.
2. Kiểm tra GitHub Actions: Build xanh + `Deploy Firestore rules` xanh.
3. Trên tài khoản `ngochieu.anphu@gmail.com`, giữ app mở hoặc refresh.
4. `Danh sách dự án` phải xuất hiện LTIA, role VIEWER.
5. Viewer mở project được, xem dữ liệu được, chat được; không sửa business data.
6. Remove Viewer trên Admin: project phải biến mất khỏi Viewer realtime.
7. Add lại Viewer: project phải xuất hiện lại không cần logout/login.
