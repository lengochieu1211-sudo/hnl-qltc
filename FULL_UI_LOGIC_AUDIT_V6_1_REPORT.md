# QLCT An Phú V6.1 – Full UI / Logic Audit

## Phạm vi
Bản này tiếp tục từ V6 FullSync + Audit + PDF + UI mobile và chỉnh toàn bộ các vấn đề UI/câu chữ/logic đã rà sâu trong cuộc trao đổi.

## 1. Đồng bộ / offline
- Bỏ cách diễn đạt khiến người dùng nghĩ phải bấm "Đồng bộ ngay".
- Khi có mạng lại: hiển thị "Đang tự đồng bộ...".
- Chỉ hiện nút "Thử lại" nếu đồng bộ tự động thất bại.
- Khi offline: mô tả rõ dữ liệu được lưu tạm trên thiết bị và tự đồng bộ khi có mạng lại.

## 2. Danh sách dự án / chống dự án rác
- Khi đã đăng nhập Google, danh sách project Cloud là nguồn sự thật.
- Bỏ logic tự ghép `unsyncedLocal` cũ vào danh sách Cloud.
- Cache local chỉ phản chiếu project mà tài khoản hiện tại được Firestore cho phép.
- Không còn tự sinh project demo tên "Tòa Nhà HH2 Sunrise Tower".
- Project mặc định chưa cấu hình hiển thị "Dự án chưa đặt tên".
- Bỏ contractor/inspector demo mặc định.

## 3. Bỏ dữ liệu demo
- Project `default` mới không còn tự nạp INITIAL_* demo cho phòng, mặt bằng, defect, checklist, quân số, vật tư, kho, khối lượng, đội thi công.
- Xuất Excel mặt bằng khi không có phòng không còn tự chèn 2 dòng phòng A101 giả.
- Bỏ fallback "KS. Nguyễn Văn Bình" trong form phòng/checklist/import.
- Import Excel vẫn nhận header cũ `Kỹ Sư Giám Sát` để tương thích file cũ, đồng thời hỗ trợ header mới `Kỹ sư phụ trách`.

## 4. Phân quyền / chủ dự án
- Đổi "Khôi Phục Quyền ADMIN" thành "Xác minh quyền chủ dự án".
- Mô tả rõ đây là xác minh tài khoản Google/chủ dự án, không phải nút tự nâng quyền.
- "Phân Quyền Thành Viên Theo Từng Dự Án" -> "Thành viên & phân quyền dự án".
- "Ma Trận Quyền Hạn..." -> "Quyền theo vai trò".

## 5. Nhật ký hoạt động
- Đổi tên UI thành "Nhật ký hoạt động".
- Thêm trạng thái cho biết nhật ký đồng bộ realtime theo dự án đang mở.
- Mỗi log thu gọn; mở chi tiết mới thấy metadata đầy đủ.
- Ghi rõ "Xóa cache máy" chỉ xóa cache thiết bị, không xóa log Firestore.

## 6. Mặt bằng / Defect
- "Ghim Defect" -> "Thêm Defect".
- "Pin Defect" -> "Vị trí Defect".
- "Thêm Căn" -> "Thêm căn".
- Công cụ `Vẽ tự do / Vẽ đa giác / Vẽ chữ nhật` đưa vào khối "Công cụ vẽ vùng căn / phòng" thu gọn mặc định.
- Chuẩn hóa nhãn `Mỗi căn 1 màu`, `Theo trạng thái`, `Chỉ hiện màu`, `Hiện tên căn`.

## 7. Quân số
- "Số Lượng Quân Số (Thợ)" -> "Số thợ".
- "Quân Số Định Biên Mặc Định" -> "Quân số định biên".
- "Khu Vực Làm Nhiều" -> "Khu vực đông nhất".
- Chuẩn hóa sentence case các tiêu đề chính.

## 8. Khối lượng
- Sửa lỗi câu "Ngày Hạn Định Completing (Deadline)" -> "Hạn hoàn thành".
- "Đã Thực Hiện (Nghiệm thu)" -> "Khối lượng đã thực hiện".
- Không tự tách field `đã thực hiện` / `đã nghiệm thu` vì source hiện chưa có schema độc lập an toàn cho hai giá trị; tránh làm hỏng dữ liệu cũ.
- Chuẩn hóa các nhãn `Khối lượng kế hoạch`, `Khối lượng đã làm`, `Khối lượng định mức`.

## 9. Định mức / kho
- "Số Lượng Định Mức" -> "Hao phí định mức".
- "Chọn Vật Tư Trong Danh Mục Định Mức" -> "Chọn vật tư".
- "Liên Kết Hạng Mục Thi Công Căn Hộ" -> "Liên kết hạng mục thi công căn / phòng".
- Không thay đổi key dữ liệu nội bộ.

## 10. Checklist
- `Đã nghiệm thu (Đạt)` -> `Đạt`.
- `Có Defect (Lỗi)` -> `Không đạt / Có Defect`.
- `Chưa nghiệm thu (Chờ)` -> `Chờ nghiệm thu`.
- Không thay đổi enum/status nội bộ để giữ tương thích dữ liệu.

## 11. Đồng bộ & sao lưu / restore
- Tiếp tục giữ bố cục compact đã chỉnh ở V6.
- `Thêm vào máy (Giữ ID gốc)` -> `Khôi phục vào dự án hiện có (giữ ID)`.
- `Hợp nhất thông minh` -> `Hợp nhất theo ID & dữ liệu mới hơn`.
- `Giữ dữ liệu máy` -> `Giữ dữ liệu hiện tại`.
- `Ghi đè bằng tệp` -> `Khôi phục từ bản sao lưu`.
- `Dọn Dẹp Dữ Liệu Rác & Dự Án Cũ` -> `Bảo trì dữ liệu`.
- Lịch sử bản lưu đổi theo hướng "Khôi phục phiên bản đám mây".

## 12. PDF
- Nút dài "Xuất / In Báo Cáo PDF..." -> "Xuất PDF".
- Bỏ câu debug "Chuẩn định dạng tiếng Việt 100% có dấu".
- Chuẩn hóa nhiều tiêu đề PDF về sentence case.
- `Portrait/Landscape` -> `Dọc/Ngang` ở phần hiển thị.
- `Highlight` -> `Vùng đánh dấu` ở phần hiển thị.
- Giữ marker nhỏ và collision logic của V6.

## 13. Thanh điều hướng mobile
- 6 tab ngang -> 5 vị trí chính để tránh chật ở 360–430 px.
- Giữ `Kho`, `Khối lượng`, `Mặt bằng`, `Quân số`.
- `Checklist` và `Cấu hình` chuyển vào nút `Thêm`.
- Badge Defect vẫn giữ trên Mặt bằng.

## 14. Sentence case / câu chữ
- Chuẩn hóa hàng loạt tiêu đề/nút đã audit: Tạo dự án mới, Xác nhận xóa, Hoàn tác, Nhật ký quân số, Danh sách đội thi công, Quản lý kho vật tư...
- Giữ tên kỹ thuật/enum/key nội bộ để không phá import, Firebase và dữ liệu đã có.

## 15. Những phần cố ý KHÔNG thay schema
- Không tự tách `khối lượng đã thực hiện` và `khối lượng đã nghiệm thu` thành hai field mới vì cần migration dữ liệu + UI + Excel + PDF + Firestore đồng bộ.
- Không xóa toàn bộ module dịch cũ dù app đang cố định tiếng Việt, vì một số component vẫn gọi `t()`; chỉ sửa câu chữ hiển thị an toàn.
- Không thay ID/key Excel nội bộ.

## Kiểm tra kỹ thuật
- `tsc --noEmit` bằng TypeScript global: không còn lỗi cú pháp/JSX hoặc lỗi code riêng do các file chỉnh.
- Các lỗi còn lại là dependency/type package chưa cài (`react`, `firebase`, `express`, `@types/node`...) khi không có `node_modules`.
- `npm ci`: không hoàn tất trong môi trường hiện tại (treo/timeout khi truy cập dependency registry).
- `npm run build`: CHƯA XÁC NHẬN PASS vì `npm ci` không hoàn tất.
- PDF generation với dữ liệu thật: CHƯA TEST ĐƯỢC.
- PDF visual A4/A3 dọc/ngang với dữ liệu thật: CHƯA TEST ĐƯỢC.

## File chính đã sửa
- src/App.tsx
- src/components/BottomNav.tsx
- src/components/OfflineSyncBanner.tsx
- src/components/SecurityModal.tsx
- src/components/ProjectManagerModal.tsx
- src/components/FloorPlanDefectTab.tsx
- src/components/RoomHighlightModal.tsx
- src/components/CrewTab.tsx
- src/components/WorkVolumeTab.tsx
- src/components/WarehouseTab.tsx
- src/components/MaterialNormModal.tsx
- src/components/ChecklistTab.tsx
- src/components/GoogleConfigTab.tsx
- src/components/ExportPdfModal.tsx
- src/utils/language.ts
- src/utils/excelExport.ts

## Giữ nguyên
- Firestore realtime/full sync V6.
- Audit Log Cloud append-only.
- Primary Drive Bridge + tài khoản Drive chính.
- android-wrapper/
- desktop-wrapper/
- apps-script/
- .github/
- firestore.rules
- firebase.json
