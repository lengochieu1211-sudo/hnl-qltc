# Quản Lý Thi Công An Phú — V6.1.4

## Phạm vi chỉnh sửa

Bản V6.1.4 nối tiếp V6.1.3, tập trung chuẩn hóa logic hiển thị, ngôn từ và thao tác mobile/PC. Không thay đổi cấu trúc dữ liệu nghiệp vụ, công thức khối lượng hay dữ liệu Firebase.

### 1. Mặt bằng
- Khóa 3 tên dùng xuyên suốt: `Mặt bằng tổng hợp`, `Mặt bằng thi công`, `Mặt bằng Defect`.
- Chỉ còn 2 nút chuyển nhanh: `Mặt bằng thi công` và `Mặt bằng Defect`.
- Nhấn lại nút đang chọn sẽ trở về `Mặt bằng tổng hợp`.
- Ở tổng hợp hiển thị đồng thời Căn / Phòng và Defect.
- `Thêm Defect` chuyển sang chế độ chọn vị trí: phải bấm nút trước, sau đó chạm đúng vị trí trên mặt bằng; chạm thông thường không tự tạo Defect.
- Marker Defect trên mặt bằng dùng mã ngắn ổn định dạng `DF-...`, không hiện chuỗi ID/tên dài che bản vẽ. Bấm marker vẫn mở đầy đủ chi tiết.

### 2. Căn / Phòng
- Chuẩn hóa các nhãn `Căn hộ`, `Căn Hộ`, `Căn hộ / Phòng` thành `Căn / Phòng` ở các màn hình chính.
- Danh sách nghiệm thu có `Thu gọn tất cả` / `Mở rộng tất cả`.
- Nếu một tầng có trên 5 Căn / Phòng, mặc định hiển thị dạng thu gọn để giảm cuộn dài trên điện thoại.
- Mỗi Căn / Phòng có nút mở/thu gọn riêng.
- Khi mở một Căn / Phòng, từng hạng mục chính có thể thu gọn riêng để ẩn hạng mục con.
- Trạng thái mở/thu gọn chỉ là UI cục bộ, không ghi Firebase.

### 3. Thống kê đội
- Nút ngoài và tiêu đề modal cùng dùng một tên: `Thống kê Căn / Phòng & Defect`.
- Các KPI thống nhất: `Căn / Phòng & khối lượng`, `Defect tồn đọng`, `Tổng công đã làm`.
- Tab dùng: `Căn / Phòng đang làm`, `Danh sách Defect`, `Lịch sử nhật ký`.

### 4. Ngôn từ & ký hiệu
- Chuẩn hóa sentence case cho các màn hình chính.
- `Sắp xếp nhanh` dùng cùng icon `ArrowUpDown` ở Kho, Khối lượng, Mặt bằng, Checklist, Định mức và Thống kê đội.
- Chuẩn hóa `Defect`, `Danh sách Defect`, `Defect tồn đọng`; bỏ các nhãn lẫn `Lỗi Defect`.
- Chuẩn hóa các nhãn Căn / Phòng trong modal nghiệm thu và Excel mẫu mặt bằng. Import vẫn giữ alias cũ để đọc file Excel trước đây.

### 5. Phiên bản
- Phiên bản UI/deploy nâng lên `V6.1.4`.
- Cập nhật `VITE_APP_VERSION=V6.1.4` trong `.env.example` và hai workflow Firebase Hosting.
- Giữ bản sửa typecheck V6.1.3 của `ProjectManagerModal.tsx`.

## Kiểm tra
- Parse/transpile toàn bộ 67 file TypeScript/TSX: **OK, không có lỗi cú pháp**.
- Kiểm tra tĩnh không còn các nhãn gây nhầm chính: `Bản Vẽ Tiến Độ`, `Bản Vẽ Vị Trí Lỗi`, `Thống kê thi công`, `Xem Thống kê Căn Đang Làm & Defect`, `Danh Sách Lỗi Defect`: **OK trong UI chính**.
- Kiểm tra các vị trí `Sắp xếp nhanh`: đều dùng `ArrowUpDown`: **OK**.

### Giới hạn kiểm tra tại môi trường này
`npm run lint` đầy đủ không chạy được vì thư mục dependency đi kèm môi trường hiện tại chỉ có cấu trúc `node_modules/@types` nhưng thiếu nội dung package type. GitHub Actions của repo vẫn là bước xác nhận cuối cùng sau khi push: `npm ci` → `npm run lint` → `npm run build`.
