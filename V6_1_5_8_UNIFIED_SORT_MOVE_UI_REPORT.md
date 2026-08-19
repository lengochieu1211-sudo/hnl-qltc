# V6.1.5.8 — Unified Sort / Move UI Audit

## Mục tiêu
Chuẩn hóa toàn app để người dùng không còn phải đoán ý nghĩa icon hoặc cách sắp xếp ở từng màn hình.

## Chuẩn ký hiệu dùng chung
- `ArrowUpDown`: chỉ dùng cho **Sắp xếp nhanh / đổi chiều sắp xếp**.
- `ArrowUp` / `ArrowDown`: chỉ dùng cho **Di chuyển lên / Di chuyển xuống** trong danh sách.
- `ArrowLeft` / `ArrowRight`: chỉ dùng cho **Di chuyển sang trái / sang phải** khi thứ tự hiển thị theo chiều ngang.
- `GripVertical`: chỉ dùng cho **Kéo để đổi thứ tự**.
- `ChevronUp` / `ChevronDown`: chỉ dùng cho **Thu gọn / Mở rộng** nội dung; không dùng làm nút di chuyển nữa.

## Chuẩn câu chữ
- `Sắp xếp nhanh:` là tiêu đề duy nhất cho thanh sắp xếp.
- Tiêu chí và chiều sắp xếp được tách thành hai nút riêng; không còn gắn `↑` / `↓` vào tên tiêu chí.
- Ngày: `Mới nhất` / `Cũ nhất`.
- Hạn xử lý: `Gần nhất` / `Xa nhất`.
- Tên: `A → Z` / `Z → A`.
- Tầng: `Thấp → cao` / `Cao → thấp`.
- Số: `Tăng dần` / `Giảm dần`.
- Checklist trạng thái: `Lỗi → đạt` / `Đạt → lỗi`.
- `Mặc định`: khôi phục sắp xếp mặc định.
- `Thứ tự thủ công`: quay về thứ tự người dùng sắp xếp.
- Di chuyển dùng đúng câu: `Di chuyển lên`, `Di chuyển xuống`, `Di chuyển tầng sang trái`, `Di chuyển tầng sang phải`, `Kéo để đổi thứ tự`.

## Các màn hình đã đồng bộ Sắp xếp nhanh
1. Kho vật tư — Nhật ký nhập/xuất.
2. Khối lượng thi công.
3. Checklist.
4. Quản lý định mức vật tư.
5. Mặt bằng — danh sách Căn / Phòng.
6. Mặt bằng — danh sách Defect.
7. Quản lý tầng.
8. Quân số — thống kê Căn / Phòng theo tầng.
9. Quân số — Defect theo tầng.
10. Quân số — lịch sử nhật ký theo Ngày / Tầng.

## Các màn hình đã đồng bộ Di chuyển / Sắp thứ tự
- Căn / Phòng trên Mặt bằng.
- Danh sách tầng.
- Hạng mục chính trong Căn / Phòng.
- Hạng mục con trong Căn / Phòng.
- Thanh tầng theo chiều ngang.

## Responsive mobile
- Thanh Sắp xếp nhanh dùng `flex-wrap`, không còn phụ thuộc cuộn ngang để thấy nút cuối.
- Bộ lọc Defect được tách khỏi Sắp xếp nhanh để đúng ý nghĩa UI.
- Nút chiều sắp xếp luôn có chữ rõ nghĩa thay vì chỉ icon `↑↓`.
- Cụm Di chuyển có cùng kích thước, viền, icon và tooltip trên các danh sách.

## Kiểm tra tĩnh
- 74 file TS/TSX parse/transpile: 0 lỗi cú pháp.
- `tsc --noEmit`: không phát hiện lỗi TypeScript nội bộ ngoài lỗi thiếu dependency/node_modules của môi trường audit.
- Số thanh `Sắp xếp nhanh:` viết riêng ngoài component chuẩn: 0.
- Chuỗi `Dời ...`: 0.
- Ký tự `↑` / `↓` dùng trực tiếp trong UI source: 0.
- Nút `Di chuyển...` dùng Chevron: 0.

## Phiên bản
VITE_APP_VERSION = V6.1.5.8
