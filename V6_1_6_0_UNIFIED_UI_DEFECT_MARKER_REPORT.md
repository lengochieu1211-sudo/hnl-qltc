# V6.1.6.0 — Unified UI / Sort-Move / Defect Marker Audit

## Mục tiêu
Bản này gom các chỉnh sửa từ V6.1.5.8–V6.1.5.9 và hardening thêm trên nền V6.1.5.7 đang deploy, tập trung vào tính thống nhất giao diện và khả năng đọc vị trí Defect trên mobile/PDF.

## Đã chỉnh
- Một component `QuickSortBar` dùng chung cho Kho, Khối lượng, Checklist, Định mức, Căn/Phòng, Defect, Tầng và Thống kê đội.
- Quy ước icon duy nhất: `ArrowUpDown` = sắp xếp; `ArrowUp/Down` = di chuyển; `GripVertical` = kéo sắp xếp; `ChevronUp/Down` = thu gọn/mở rộng.
- Tất cả QuickSortBar có nút `Mặc định`; filter Defect tách riêng khỏi reset sắp xếp.
- Header Căn/Phòng mobile: checkbox + tên + nút thu gọn ở hàng chính; điều khiển sắp thứ tự + Chỉnh sửa + Xóa ở hàng thao tác, giảm nhầm giữa hai loại mũi tên.
- Card thu gọn không cộng chéo các đơn vị khác nhau; hiển thị tổng theo từng ĐVT.
- Checklist dùng semantic `deadline` để hiển thị `Gần nhất/Xa nhất` thay vì `Cũ nhất/Mới nhất`.
- Defect trên mặt bằng luôn có chấm neo tại `x/y` thật; label được dời ra và có leader line nối về chấm thật.
- Mã Defect hiển thị trực tiếp được rút gọn, không vẽ timestamp/suffix dài trên bản vẽ; ID dữ liệu thật không thay đổi.
- Preview cấu hình PDF được đơn giản hóa: một vùng Căn/Phòng, một chấm Defect thật, một leader ngắn, một nhãn; không còn các đường dẫn chéo rối.
- Khi chọn `Số ngắn`, preview/map/bảng Defect trong PDF dùng `01, 02...`; khi chọn `Mã ngắn`, dùng `DF-01, DF-02...`.
- Legend PDF của Căn/Phòng lấy đúng ĐVT riêng từng hạng mục từ `categoryVolumeUnits` nếu có.
- HTML/PDF legend escape thêm dữ liệu người dùng và chuẩn hóa ngày hoàn thành.
- Câu chữ visible được đưa về sentence case ở các khu vực vừa audit.

## Kiểm tra kỹ thuật
- 74 file TS/TSX parse/transpile: 0 lỗi cú pháp.
- `tsc --noEmit`: 0 lỗi nội bộ sau khi loại nhóm lỗi môi trường do container không có node_modules/@types node.
- `Sắp xếp nhanh:` chỉ còn khai báo tại component dùng chung `QuickSortBar`.
- Không còn chuỗi `Dời ...`, `Đồng Ý`, `Đang Làm`, `Chưa Làm`, `Nạp Thay Thế`, `Tọa Độ`, `Điểm Góc` trong UI component đã audit.

## Lưu ý build
GitHub Actions vẫn là kiểm tra production cuối cùng vì môi trường audit này không cài đủ dependency runtime. Sau khi Push cần chờ Build và Deploy đều xanh.
