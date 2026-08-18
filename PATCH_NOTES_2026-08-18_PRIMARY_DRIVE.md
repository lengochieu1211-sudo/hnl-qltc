# An Phu Tool - Primary Drive patch (2026-08-18)

## Tài khoản Drive chính
- `lengochieu1211@gmail.com`
- Mọi user vẫn đăng nhập Gmail/Firebase riêng.
- ADMIN/ENGINEER có quyền dự án có thể tải ảnh.
- VIEWER chỉ xem/tải ảnh.
- Apps Script chạy `Execute as me` dưới tài khoản Drive chính nên file do script tạo nằm trong Drive chính.
- Mỗi dự án có `BACKUP JSON/[AUTO]_LATEST.json` (rolling) và bản `[MANUAL]_yyyyMMdd_HHmmss.json` khi bấm tạo backup thủ công. JSON Drive không nhét Base64 ảnh vì ảnh đã là file riêng trong Drive; metadata giữ `drive fileId` để phục hồi/xem trên thiết bị khác.

## Cách lưu ảnh mới
1. App nén ảnh và lưu cache local để hiện ngay.
2. Nếu Drive Bridge đã cấu hình: app gửi Firebase ID token + ảnh qua Apps Script.
3. Apps Script xác minh token bằng Firebase Auth REST và kiểm tra quyền dự án qua Firestore REST.
4. Apps Script tạo ảnh trong Drive chính theo cây thư mục dự án.
5. Firestore chỉ lưu metadata + `drive:projectId:fileId`.
6. Sau khi metadata Drive đã ghi thành công, chunk Firestore cũ của ảnh đó mới bị xóa.
7. Nếu Drive lỗi/chưa cấu hình: app fallback sang chunk Firestore để không mất ảnh hiện trường.

## Đồng bộ thiết bị khác
- Realtime Firestore đồng bộ metadata ảnh.
- Khi thiết bị khác cần xem/xuất backup, app tải binary từ Drive Bridge và cache local.
- Ảnh cũ Firestore có thể tự di chuyển dần hoặc bấm `Chuyển ảnh cũ sang Drive` trong Lưu & Đồng Bộ.

## Dung lượng trong app
Thêm card `Drive chính An Phú`:
- số ảnh + dung lượng ảnh dự án;
- số ảnh đã ở Drive;
- số ảnh legacy còn ở Firestore;
- kiểm tra kết nối;
- ADMIN xem quota Google thật từ Drive API;
- tài khoản Drive chính có ô lưu URL Apps Script `/exec`.

## Cấu hình Firestore
Thêm `app_config/drive_primary`.
- mọi tài khoản Google đã đăng nhập được đọc endpoint;
- chỉ `lengochieu1211@gmail.com` được thay đổi endpoint.

## Một lần duy nhất sau deploy GitHub
Xem `apps-script/PrimaryDriveBridge/README.md` và triển khai Apps Script bằng đúng tài khoản `lengochieu1211@gmail.com`, sau đó dán URL `/exec` vào card Drive chính trong app.

## Kiểm tra đã thực hiện trong môi trường hiện tại
- Parse cú pháp toàn bộ TS/TSX: OK, 0 syntax errors.
- Parse cú pháp Apps Script Code.gs bằng V8-compatible JavaScript parser: OK.
- Không chạy được build Vite đầy đủ trong container vì npm dependencies không tải hoàn tất; GitHub Actions PR phải tiếp tục là kiểm tra build/typecheck bắt buộc trước khi merge.
