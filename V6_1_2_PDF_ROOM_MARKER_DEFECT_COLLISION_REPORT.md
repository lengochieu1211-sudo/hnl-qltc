# QLCT An Phú V6.1.2 — PDF Room Marker / Defect Collision Fix

## Mục tiêu
Sửa marker căn/phòng trong PDF sau phản hồi thực tế:
- căn #11 bị vòng tròn bó chữ, khó đọc;
- badge nằm giữa căn dễ che chữ/nét CAD;
- phải đảm bảo marker căn/phòng không trùng điểm hoặc marker Defect.

## Thay đổi

### 1. Marker căn/phòng trên bản vẽ
- Bỏ ký tự `#` trên bản vẽ: `#11` -> `11`.
- Legend vẫn giữ `#11` để tham chiếu.
- Không dùng vòng tròn đặc cố định nữa.
- Dùng pill/oval nhỏ:
  - 1 chữ số: gần tròn, rộng 1.75.
  - 2 chữ số: rộng 2.35.
  - 3 chữ số: rộng 2.85.
- Cao 1.70.
- Nền trắng 96%, viền theo màu căn, chữ cùng màu viền.
- Viền mảnh 0.22.
- Font 0.96; 3 chữ số dùng 0.88.
- Ít che nét CAD hơn marker nền màu đặc.

### 2. Vị trí marker căn/phòng
Thuật toán cũ đặt mặc định ở centroid/tâm căn. Kiến trúc CAD thường có chữ, hatch, kích thước ở vùng trung tâm.

V6.1.2 ưu tiên:
1. góc trên-trái bên trong highlight;
2. góc trên-phải;
3. góc dưới-trái;
4. góc dưới-phải;
5. các midpoint mép;
6. tâm chỉ là lựa chọn cuối.

Nếu căn quá nhỏ / vùng bên trong bị chiếm:
- fan-out quanh căn;
- nếu cần đặt ngoài vùng sẽ dùng leader line;
- nếu không thể tìm vị trí an toàn thì không cố đè marker, thông tin vẫn còn trong legend.

### 3. Không trùng Defect
- Marker phòng né toàn bộ điểm gốc Defect với vùng an toàn lớn hơn.
- Marker Defect tiếp tục tính sau marker phòng và xem mọi room badge đã đặt là obstacle.
- Kích thước obstacle room thay đổi theo 1/2/3 chữ số.
- Do đó có bảo vệ hai chiều:
  - room badge không đè Defect origin;
  - defect number badge không đè room badge.

### 4. Phân biệt ký hiệu
- Room: nền trắng + viền màu + `11`.
- Defect: circle màu đặc + `01`, `02`, ... + leader line.
- Không dùng cùng hình thức để tránh nhầm room với Defect.

### 5. Giữ nguyên
- số room trong legend: `#1`, `#11`, ...
- stable Defect numbering.
- Defect cluster / fan-out.
- clamp mép bản vẽ.
- room highlight polygon/polyline/rectangle.
- V6 FullSync/Audit/Primary Drive.
- V6.1.1 Project Recovery/LTIA fix.
- Android wrapper / Desktop wrapper / Apps Script / GitHub Actions / Firebase files.

## Kiểm tra
- `pdfMapUtils.ts` compile standalone: PASS.
- TypeScript scan các file chỉnh: không phát hiện lỗi code riêng ngoài dependency packages khi `node_modules` không có.
- Test case Defect đúng tại centroid căn #11: PASS, room marker tự dời sang vùng khác.
- Stress test 250 layout ngẫu nhiên:
  - room badge vs Defect origin: PASS.
  - room badge vs Defect numbered marker: PASS.
- Kiểm tra source: marker room trên map không còn `#`; legend vẫn còn `#`.
- PDF generation với dữ liệu LTIA thực tế: CHƯA TEST ĐƯỢC trong môi trường này.
- Visual inspection A4/A3 từ trình duyệt thật: cần kiểm tra sau deploy.
