# V6.1.6.1 – Conditional Quick Sort & Unified List Controls

## Mục tiêu
Chuẩn hóa toàn app theo nguyên tắc: danh sách ngắn không cần chiếm chỗ bằng thanh **Sắp xếp nhanh**; danh sách đủ dài mới hiển thị. Tất cả nơi có sắp xếp dùng cùng một component, cùng câu chữ và cùng ý nghĩa biểu tượng.

## Quy tắc chung
- `0–5` mục: ẩn **Sắp xếp nhanh**.
- `6+` mục: hiện **Sắp xếp nhanh**.
- Ngưỡng mặc định được quản lý tập trung bằng `DEFAULT_QUICK_SORT_MIN_ITEMS = 6` trong `QuickSortBar.tsx`.
- Mỗi thanh đều có nút **Mặc định**.
- Ngày: **Mới nhất / Cũ nhất**.
- Deadline: **Gần nhất / Xa nhất**.
- Tên: **A → Z / Z → A**.
- Tầng: **Thấp → cao / Cao → thấp**.
- Số lượng/khối lượng: **Tăng dần / Giảm dần**.

## Biểu tượng thống nhất
- `ArrowUpDown`: Sắp xếp nhanh / đổi chiều sắp xếp.
- `ArrowUp`, `ArrowDown`: Di chuyển lên / xuống.
- `ArrowLeft`, `ArrowRight`: Di chuyển sang trái / phải.
- `GripVertical`: Kéo để sắp xếp thủ công.
- `ChevronUp`, `ChevronDown`: Thu gọn / Mở rộng.
- Không dùng chữ “Dời”.
- Không dùng ký tự UI thô `↑`, `↓`, `⇅`.

## Danh sách đã áp dụng Sắp xếp nhanh có điều kiện
1. Căn / Phòng trên Mặt bằng.
2. Danh sách Defect.
3. Danh sách tầng.
4. Danh sách vùng Căn / Phòng Smart PDF trước khi tạo.
5. Checklist.
6. Định mức vật tư.
7. Nhật ký nhập / xuất kho.
8. Khối lượng thi công.
9. Nhật ký quân số.
10. Danh sách đội thi công.
11. Thống kê đội theo tầng.
12. Defect của đội.
13. Nhật ký của đội.
14. Ảnh đính kèm khi có nhiều ảnh.
15. Thành viên dự án.
16. Nhật ký hoạt động / audit.
17. Trung tâm thông báo.
18. Xung đột dữ liệu khi đồng bộ/nhập.
19. Danh sách dự án ở các màn quản lý/chọn phạm vi.
20. Lịch sử autosave.
21. Lịch sử backup cloud.

## Ngoại lệ có chủ đích
Danh sách **hạng mục chính / hạng mục con đang chỉnh sửa trong một Căn / Phòng** là thứ tự quy trình nghiệp vụ. Chúng tiếp tục dùng `MoveOrderControls` để kéo/di chuyển thủ công, không tự sắp xếp A–Z theo mặc định, vì việc đổi thứ tự có thể làm mất ý nghĩa trình tự thi công. Nếu cần tra cứu rất nhiều hạng mục, nên bổ sung bộ lọc/tìm kiếm riêng mà không thay đổi thứ tự dữ liệu.

## Audit tĩnh
- `QuickSortBar`: 22 vị trí sử dụng.
- 22/22 có `itemCount` để tự ẩn khi dưới ngưỡng.
- 22/22 có `onReset` / **Mặc định**.
- Chuỗi “Sắp xếp nhanh” viết riêng ngoài component chuẩn: 0.
- Ký tự `↑`, `↓`, `⇅` trong component UI: 0.
- Từ “Dời/dời” trong component UI: 0.
- Parse/transpile: 74 file TS/TSX, 0 lỗi cú pháp.
- `tsc --noEmit` trong môi trường audit chỉ báo lỗi dependency/runtime thiếu `node_modules` (TS2307/TS2875 và type Node); không phát hiện mã lỗi TypeScript nội bộ khác.

## Phiên bản
V6.1.6.1
