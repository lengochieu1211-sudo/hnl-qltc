# QLCT An Phú V6.2.6 – Legacy Project Discovery & Chat Reliability

## Mục tiêu
Sửa hai lỗi thực tế được tái hiện sau V6.2.5:

1. Tài khoản đã có quyền ENGINEER trên dự án Mizuki legacy nhưng `Danh sách dự án` không hiện dự án, trong khi Chat vẫn truy cập được.
2. Nút gửi Chat đôi lúc bấm không phản hồi/đợi rất lâu trên mạng yếu hoặc offline.

## 1. Khôi phục dự án legacy `default` / Mizuki

### Nguyên nhân
Các bản đầu của ứng dụng dùng project ID `default`. Project này có thể vẫn có member document hợp lệ tại:

`projects/default/members/{email}`

nhưng thiếu các index được bổ sung ở các bản mới:

- `users/{uid}.projects.default`
- `projectAccess/{...}`
- invitation cũ có thể đã bị xóa

Do đó Firestore Rules vẫn cho phép ENGINEER/VIEWER đọc/chat dự án nếu đã biết ID `default`, nhưng màn Danh sách dự án không có nguồn để khám phá ID đó.

### Sửa
- Thêm `readLocalProjectDiscoveryCandidates()` trong `src/lib/firebase.ts`.
- `construction_projects_list` và `active_project_id` chỉ được xem là **candidate**, tuyệt đối không tự cấp quyền.
- Project legacy `default` luôn được thử xác minh một lần với Firestore server.
- Candidate chỉ được đưa vào danh sách sau khi `getDocFromServer(project)` thành công theo Firestore Rules.
- Nếu user đã bị remove/không có quyền, `permission-denied` => candidate bị loại, không hiện dự án ma.
- Sau khi xác minh thành công, app gọi `fetchProjectUserRoleFromCloud()` để lấy đúng ADMIN/ENGINEER/VIEWER rồi tự phục hồi `users/{uid}.projects`.
- Vì `users/{uid}` là Cloud và UID Google ổn định giữa các thiết bị, sau lần phục hồi đầu tiên dự án sẽ được tìm thấy bình thường ở thiết bị khác cùng tài khoản.

### Tương thích
- Không đổi projectId `default`.
- Không clone/đổi tên project.
- Không migrate/xóa dữ liệu Mizuki.
- Không mở rộng Firestore Rules.
- Local candidate không bao giờ là bằng chứng cấp quyền; backend Rules vẫn là nguồn quyết định.

## 2. Chat gửi tin ổn định hơn

### Nguyên nhân 1 – round-trip thừa trước khi gửi
`sendProjectMessage()` trước đây gọi `getDoc(message)` trước mỗi lần gửi để kiểm tra trùng. Trên 4G yếu/offline, thao tác này có thể chờ mạng trước khi Firestore thậm chí xếp hàng local, làm người dùng cảm giác nút Gửi "không ăn".

### Sửa
- Bỏ `getDoc()` preflight.
- Vẫn giữ deterministic message ID từ `uid + clientMessageId`, nên retry cùng client ID vẫn ghi đúng cùng document.

### Nguyên nhân 2 – UI chờ `batch.commit()` tới backend
Firestore áp dụng write vào persistent local cache ngay, nhưng Promise của `batch.commit()` có thể chờ backend lâu khi mạng yếu/offline.

### Sửa
- Sau 350 ms, nếu backend chưa ACK thì coi tin đã **xếp hàng local** và trả quyền điều khiển về composer.
- Realtime listener tiếp tục hiển thị trạng thái `Đang gửi…` từ `hasPendingWrites`.
- Nếu batch bị backend từ chối sau khi UI đã trả quyền điều khiển, service phát `qlct-chat-send-error` để UI báo lỗi và hiện nút **Gửi lại**.

### Nguyên nhân 3 – pending serverTimestamp chưa có giá trị
Tin local đang pending có thể có `createdAt = null` cho tới khi server ACK, nên trước đây tin mới có thể bị sort về đầu danh sách hoặc trông như chưa xuất hiện.

### Sửa
- Thêm `clientCreatedAt` chỉ làm fallback hiển thị/sắp xếp khi `serverTimestamp` còn pending.
- `createdAt` server vẫn là thời gian authoritative sau khi đồng bộ.

### Nguyên nhân 4 – bấm gửi lặp
- Thêm state `isSending`.
- Disable nút Gửi và Enter trong lúc đang queue một tin.
- Hiển thị spinner rõ ràng.
- Tránh bấm nhanh nhiều lần làm tăng `messageCount` nhiều lần.

### Nguyên nhân 5 – typing write bị gọi 2 lần
`ChatTab.tsx` có hai dòng `setTyping(...)` giống hệt nhau cho mỗi lần gõ.

### Sửa
- Bỏ duplicate call.
- Giảm một nửa RTDB typing writes khi Presence được bật sau này.

### Ảnh chat
- Không thay đổi pipeline Blob/IndexedDB của V6.2.4.
- Khi đang chuẩn bị ảnh, nút Gửi bị khóa để tránh gửi text trước khi attachment hoàn tất.

## File thay đổi
- `src/lib/firebase.ts`
- `src/lib/chatService.ts`
- `src/features/chat/ChatTab.tsx`
- `src/config/appVersion.ts`
- `package.json`
- `package-lock.json`
- `QLCT-An-Phu-V6.2.6-REPORT.md`

## Schema mới
Message mới có thêm field optional:

`clientCreatedAt: number`

Dữ liệu cũ không có field này vẫn chạy; chỉ dùng fallback trong lúc `createdAt` server chưa resolve.

## Firestore Rules
Không cần mở thêm quyền trong V6.2.6. Cơ chế phục hồi `default` chỉ thử server read bằng Rules hiện hữu. Không có quyền => không hiện.

## Kiểm tra
- Static transpile/parse: 83 file TS/TSX/TS, 0 lỗi cú pháp.
- Duplicate typing write: còn đúng 1 call.
- `npm ci`: timeout trong môi trường container trước khi tải dependencies; do đó không ghi Vite Build PASS giả.

## Test bắt buộc sau deploy
1. Đăng nhập `ngochieu.anphu@gmail.com`.
2. Mở Danh sách dự án: phải thấy LTIA nếu còn VIEWER và Mizuki nếu còn ENGINEER.
3. Mizuki phải dùng đúng ID `default`, không tạo project mới.
4. User bị remove khỏi Mizuki phải không được phục hồi vì server read sẽ permission-denied.
5. Chat Mizuki: gửi liên tiếp 5 tin trên Wi‑Fi.
6. Chat Mizuki: gửi 5 tin trên 4G yếu; nút phải phản hồi, tin pending hiện `Đang gửi…` thay vì đứng im.
7. Tắt mạng, gửi 1 tin: tin phải xuất hiện local pending; bật mạng lại tự sync.
8. Bấm Gửi nhanh nhiều lần: một thao tác chỉ tạo một message.
9. Nếu backend từ chối quyền, UI phải hiện lỗi + `Gửi lại`, không im lặng.

## Commit message
`V6.2.6 - Restore legacy Mizuki access and harden chat sending`
