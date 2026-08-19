# UI Đồng bộ & Sao lưu – Compact Mobile

Đã chỉnh trực tiếp giao diện theo ảnh phản hồi:

- Đổi tên `Lưu & Đồng Bộ` thành `Đồng bộ & Sao lưu`.
- `Phạm vi sao lưu` thu gọn mặc định; chỉ mở khi cần xuất/khôi phục nhiều dự án.
- `Tự động sao lưu` giữ dạng thu gọn.
- `Lưu / Khôi Phục File Cục Bộ...` rút thành `Sao lưu & Khôi phục`.
- `Tài Khoản & Đồng Bộ Dự Án` rút thành `Đồng bộ dự án`.
- `Drive chính An Phú` rút gọn màn hình chính thành trạng thái + 3 số: ảnh, mặt bằng, chưa chuyển.
- URL Apps Script, dung lượng, thống kê kỹ thuật và migration đưa vào `Cài đặt & công cụ nâng cao`.
- `Firestore cũ` đổi thành `Ảnh cũ chưa chuyển`.
- Nút migration đổi thành `Chuyển ảnh cũ lên Drive` và vẫn chỉ hiện khi thực sự còn dữ liệu cần chuyển.
- Lịch sử bản lưu đám mây thu gọn mặc định.
- Không thay đổi logic Firebase realtime, Primary Drive Bridge, audit log, backup JSON, Android/Desktop wrapper.

Kiểm tra TypeScript bằng `tsc --noEmit`: không phát hiện lỗi cú pháp/JSX riêng ở hai file đã chỉnh; toàn project không type-check hoàn chỉnh vì ZIP không chứa node_modules và môi trường hiện thiếu dependency/type packages (React, Firebase, Express...).
