# QLCT An Phú V6.2.3 – Mobile UI & Export Logic Cleanup

## Nền nâng cấp
- Nâng trực tiếp từ V6.2.2 – Defect Zoom Marker Scaling.
- Không đổi Firebase project, Hosting URL, repo hay GitHub Actions.
- Không migration phá dữ liệu cũ.

## Lỗi logic đã sửa trực tiếp
1. **Nghiệm thu mâu thuẫn với tiến độ**
   - Không cho tạo mới trạng thái `Đạt nghiệm thu` khi công đoạn chưa `Đã hoàn thành`.
   - Nếu công đoạn đã Đạt NT nhưng bị chuyển ngược về `Đang làm/Chưa làm`, inspection tự trở về `Chưa nghiệm thu`.
   - Dữ liệu cũ vẫn đọc được; dashboard không còn coi `Đạt NT` là đồng nghĩa với `Xong`.

2. **Dashboard Mặt bằng báo 100% sai**
   - `doneSteps/workDoneCount` chỉ tính `status === Đã hoàn thành`.
   - `inspectedSteps/inspectedCount` chỉ tính khi **đồng thời** `Đã hoàn thành + Đạt nghiệm thu`.
   - Loại bỏ logic cũ `Xong OR Đạt NT` gây trường hợp “Đang làm nhưng dashboard báo 2/2 xong”.

3. **Thống kê đội / Excel đội – KL hoàn thành có thể lớn hơn KL phụ trách**
   - Sửa engine `calculateTeamStatistics()`.
   - Toàn bộ assigned/done frame/done board/inspection sử dụng cùng denominator của category/sub-item.
   - Một đội chỉ làm Khung không còn được tính toàn bộ KL của cả Khung + Tấm.
   - KL Xong Khung/Tấm/NT được chặn về bản chất bởi phần việc thực sự của đội.
   - Trạng thái trong sheet chi tiết đội được suy ra từ đúng sub-item đội phụ trách, không lấy trạng thái tổng của cả Căn/Phòng.

4. **Ngày Defect legacy bị đảo DD/MM ↔ MM/DD**
   - Bổ sung parser riêng cho dạng cũ `HH:mm:ss DD/M/YYYY` trước `Date.parse()`.
   - Ví dụ `15:22:15 11/8/2026` được hiểu đúng là 11/08/2026.

5. **PDF/HTML Kho dùng phiếu nhập/xuất như mặt hàng tồn**
   - Chuyển phần Kho trong báo cáo sang `calculateStockSummary()` dùng chung với Kho.
   - Gom theo material identity, hiển thị `currentStock` thay vì quantity của từng giao dịch.
   - Card số mặt hàng Kho lấy số vật tư tổng hợp, không lấy số phiếu nhập/xuất.
   - Trạng thái báo cáo dùng Hết hàng / Thiếu / Đủ theo engine tồn kho hiện tại.

6. **Checklist rỗng nhưng hiển thị 0% Đạt**
   - UI Checklist hiển thị `Chưa có dữ liệu` khi tổng tiêu chí = 0.
   - PDF card Checklist rỗng hiển thị `— / Chưa có Checklist`.

7. **Defect nghiệm thu thiếu ảnh sau sửa**
   - Khi chuyển Defect sang `Đã nghiệm thu`, app kiểm tra cả `afterImageUrl` legacy và ảnh `defect_after` trong kho ảnh hiện tại.
   - Nếu chưa có bằng chứng sau sửa, phải xác nhận rõ trước khi override.
   - Không hard-block Admin để giữ tương thích quy trình hiện trường cũ.

8. **ID Defect dài trong modal**
   - Chuyển lớp hiển thị sang mã ngắn bằng `getDefectShortCode()`; ID database thật không đổi.

## UI mobile đã sửa
- Tab Nhật ký trong Trung tâm bảo mật: tiêu đề/nút không còn ép thành cột dọc ở màn hình hẹp.
- Hai ô PIN chuyển sang 1 cột dưới 390 px, tránh placeholder bị cắt.
- Chat không còn hiển thị tên biến kỹ thuật `VITE_FIREBASE_DATABASE_URL`; đổi thành thông báo thân thiện cho người dùng.

## Version
- `package.json`: 6.2.3
- `package-lock.json`: 6.2.3
- `src/config/appVersion.ts`: V6.2.3 – Mobile UI & Export Logic Cleanup

## File thay đổi
- package.json
- package-lock.json
- src/config/appVersion.ts
- src/components/RoomHighlightModal.tsx
- src/components/FloorPlanDefectTab.tsx
- src/components/ChecklistTab.tsx
- src/components/ExportPdfModal.tsx
- src/components/SecurityModal.tsx
- src/features/chat/ChatTab.tsx
- src/utils/dateFormatter.ts
- src/utils/teamUtils.ts

## Kiểm tra
- Static TS/TSX transpile parse: **81 files, 0 syntax diagnostics**.
- `npm ci --ignore-scripts`: môi trường container timeout trước khi cài dependency xong.
- Vì vậy không ghi `npm run build PASS` giả. GitHub Actions cần được dùng để xác nhận build production sau Push.

## Rủi ro / việc còn nên làm tiếp
- RTDB Presence/Typing vẫn optional vì chưa có cấu hình membership-safe cho RTDB.
- Push FCM khi app đóng chưa bật.
- Nhu cầu vật tư hiện vẫn phụ thuộc dữ liệu quotaQuantity đã tính sẵn; cần regression riêng nếu muốn đổi công thức nhu cầu sang KL còn lại theo tiến độ tại runtime.
- PDF vẫn phụ thuộc hộp thoại in trình duyệt đối với header/footer URL `blob:`; nên tắt Headers and footers khi Save PDF hoặc chuyển sang renderer PDF chuyên biệt trong bước sau.
