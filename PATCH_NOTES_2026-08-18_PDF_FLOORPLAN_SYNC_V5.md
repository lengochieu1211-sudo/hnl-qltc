# An Phu Tool - V5 PDF Defect + Floor-plan Image Sync

## Tài khoản Drive chính
- Đã sửa đúng thành: `lengochieu1211@gmail.com`.
- Toàn bộ cấu hình mới dùng thống nhất tài khoản Drive chính này.

## 1. Đồng bộ ảnh mặt bằng nhiều thiết bị
- Bổ sung `src/lib/floorPlanImageSync.ts`.
- Ảnh mặt bằng mới / ảnh mặt bằng thay thế có revision riêng, không re-upload khi chỉ đổi tên tầng.
- Ưu tiên upload binary lên Google Drive chính qua Apps Script.
- Nếu Drive chưa cấu hình / lỗi tạm thời: tự fallback sang Firestore chunks ~560 KB/chunk.
- Firestore `floor_plans` chỉ giữ metadata + cloud reference, tránh nhét Base64 lớn vào document.
- Máy khác nhận metadata realtime sẽ tự tải binary về tuần tự, không tải đồng thời toàn bộ ảnh gây tăng RAM.
- Khi Drive auto-backup JSON: không nhét lại Base64 mặt bằng nếu binary đã lưu riêng; JSON giữ metadata/ref.
- Card `Drive chính An Phú` hiển thị thêm `Ảnh mặt bằng: đã ở Drive / tổng` và nút `Đồng bộ toàn bộ ảnh lên Drive`.

## 2. PDF Defect / trạng thái / highlight
- Dùng một danh sách defect duy nhất đã sort để cấp marker ổn định; marker / legend / bảng dùng chung sequence.
- Mặt bằng ưu tiên marker nhỏ + số; không đặt tên defect dài trực tiếp lên bản vẽ.
- Collision avoidance 8 hướng + nhiều vòng bán kính + local grid fallback.
- Nếu không tìm được vị trí an toàn: không ép nhãn vào vùng chật; chi tiết vẫn ở legend.
- Defect gần như cùng tọa độ được cluster ở origin và fan-out marker số.
- Marker/room badge sát mép được clamp trong khung.
- Room badge tránh defect origin và tránh room badge khác; nếu không còn chỗ sẽ ẩn badge trên bản vẽ, tên vẫn có trong legend.
- Leader line mảnh 0.18.
- Highlight PDF: polygon/rect stroke 0.25; polyline hở stroke 0.35; join round; fill opacity giảm 0.16 để không che bản vẽ nền.
- Badge trạng thái: wrap, word-break, overflow-wrap, line-height 1.25, center; row tự tăng chiều cao.
- Cột bảng PDF dùng phần trăm responsive; không hard-code 95/110 px cho mọi khổ.
- Thêm chọn A4/A3 và Portrait/Landscape trong modal PDF.

## Kiểm thử đã thực hiện trong môi trường sửa source
- TS/TSX syntax transpile: PASS (67 file, 0 syntax error).
- Apps Script `Code.gs` JavaScript syntax: PASS.
- PDF collision algorithm synthetic test: PASS (0 overlap/clamp failure trong bộ test khó).
- Visual regression harness đã kiểm tra A4/A3 portrait/landscape; A4 portrait render ở 100/150/200 DPI đọc được, marker/room/status/long text không chồng trong bộ test.

## Trạng thái cần phân biệt
- `npm build`: CHƯA TEST ĐƯỢC cục bộ vì môi trường hiện tại không có bộ `node_modules` hoàn chỉnh; phải để GitHub Actions chạy `npm ci` + build.
- PDF generation từ chính UI app với dữ liệu thật của dự án: CHƯA TEST ĐƯỢC trong runtime app ở đây.
- PDF visual inspection của harness mô phỏng case khó: PASS.
- Defect overlap algorithm test: PASS.
- Highlight thickness harness: PASS.
- Dữ liệu thật sau deploy: cần xuất 1 PDF thật từ app và kiểm tra lại 100/150/200% trước khi kết luận hoàn tất.
