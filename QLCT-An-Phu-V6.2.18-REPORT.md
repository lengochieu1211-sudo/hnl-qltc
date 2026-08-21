# QLCT An Phú V6.2.18 – Floor Plan Navigation, Mini-map & Layer Hardening

Nền: **V6.2.17 FULL SOURCE**. Không đổi Firebase Project/Hosting/repo, không đổi `projectId`, không migration dữ liệu, không push/deploy.

## 1. Bố trí giao diện mới
Các tính năng điều hướng được gom vào **một thanh nhỏ ở góc phải dưới mặt bằng**:

`[-]  [zoom %]  [+]  [Fit]  [🎯 Focus]  [🗺 Mini]  [Lớp]  [Xoay nếu fullscreen]  [Fullscreen]`

- Không tạo card lớn mới.
- Mobile thanh có thể cuộn ngang nếu thiếu chiều rộng.
- **Mini-map** nằm góc trái dưới, đối diện thanh zoom; mặc định tắt và chỉ render khi người dùng bật + zoom > 115%.
- **Khóa/Mở khóa** chỉ xuất hiện khi đã chọn Căn/Phòng hoặc trong modal Defect, không chiếm chỗ khi đang xem bình thường.

## 2. Mini-map cho bản vẽ lớn
- Nút `🗺 Mini` bật/tắt bản đồ nhỏ.
- Mini-map dùng chính ảnh mặt bằng hiện tại, hiển thị khung vàng tương ứng vùng viewport đang xem.
- Click/chạm hoặc kéo trên mini-map để nhảy nhanh sang khu vực khác.
- Có hỗ trợ trạng thái xoay mặt bằng.
- Chạy hoàn toàn local UI, không ghi Firebase.
- Mặc định không render để tránh tốn thêm tài nguyên trên điện thoại nếu người dùng không cần.

## 3. Focus Căn/Phòng / Defect
- Nút `🎯 Focus` chỉ bật khi có Căn/Phòng hoặc Defect đang được chọn.
- Nếu chọn nhiều Căn/Phòng, Focus lấy **tâm của cả nhóm**, không chỉ căn đầu tiên.
- Nếu zoom đang quá thấp (< 160%), Focus nâng lên khoảng 200% để có thể nhìn rõ và pan tới đối tượng.
- Không thay tọa độ thật của Căn/Defect.
- Nút **Xem vị trí trên mặt bằng** trong Defect được đổi sang focus đúng tọa độ; nếu Defect thuộc tầng khác, app chuyển tầng trước rồi mới focus.

## 4. Nhớ zoom + vị trí theo từng tầng
- Lưu bằng `sessionStorage` theo khóa `projectId + floorId`.
- Lưu: `zoom`, `scrollLeft`, `scrollTop`.
- Chuyển tầng rồi quay lại sẽ trở đúng mức zoom và khu vực vừa xem.
- Mỗi tab trình duyệt có trạng thái riêng, không giành viewport của tab khác.
- Không ghi Firestore, không tạo realtime listener, không làm tăng autosave.

## 5. Fit toàn bản vẽ
- Nút `Fit` đưa mặt bằng về scale nền vừa viewport và scroll về đầu vùng hiển thị.
- Giữ nguyên giới hạn zoom cũ **1x → 20x**; không giảm max zoom vì có bản vẽ mặt bằng lớn.
- `Fit` thay cách gọi `1:1` cũ để đúng ý nghĩa thực tế của scale=1 trong component này.

## 6. Khóa vị trí Căn/Phòng
Đây là **khóa thao tác UI cục bộ theo project**, không phải field Firebase mới.

Khi khóa:
- Không kéo bằng dấu Move/+.
- Không resize bằng handle cạnh/góc.
- Không chỉnh đỉnh polygon.
- Không di chuyển bằng phím mũi tên / Shift+mũi tên.
- Không dùng chức năng vẽ lại vùng.
- Vẫn xem và sửa thông tin nghiệp vụ của Căn/Phòng.
- Vẫn giữ Delete có xác nhận như logic hiện tại.
- Nhãn Căn hiển thị biểu tượng `🔒`.

Lý do dùng local UI lock ở V6.2.18: tránh thêm schema/migration Firebase trong lúc đang hardening mặt bằng. Nếu sau này cần khóa đồng bộ trên mọi máy, nên làm thành bước riêng sau khi test.

## 7. Khóa vị trí Defect
- Modal Defect có `Khóa vị trí / Mở khóa vị trí`.
- Marker đang khóa có ký hiệu `🔒`.
- Hiện source không có drag marker Defect trực tiếp; lock được chuẩn bị như hàng rào UI cho các thao tác tọa độ hiện tại/tương lai.
- Không khóa việc sửa mô tả, trạng thái, đội phụ trách, ảnh.

## 8. Lớp hiển thị
Nút `Lớp` mở panel nhỏ gồm:
- **Vùng Căn/Phòng**.
- **Tên Căn/Phòng**.
- **Marker Defect**.
- **Defect đã hoàn thành**.

Đặc điểm:
- Chỉ ảnh hưởng map overlay, không xóa dữ liệu.
- Danh sách Căn/Defect bên dưới vẫn giữ nguyên dữ liệu.
- Lựa chọn được lưu local theo project để lần sau mở lại không phải chọn lại.
- Có guard khi đổi project để không ghi nhầm setting project cũ sang project mới.

## 9. Giữ nguyên V6.2.17 và các thao tác trước
- Wheel PC zoom theo tâm con trỏ.
- Middle mouse + drag và Space + left-drag pan PC.
- Mobile 1 ngón pan, 2 ngón pinch zoom.
- Long-press 2 giây chỉ paste Căn trong mode Căn/Phòng.
- Ctrl/Cmd+A/C/V, Delete/Backspace, Esc, Arrow/Shift+Arrow.
- 3 công cụ: Vẽ tự do / Vẽ đa giác / Vẽ chữ nhật.
- Mode Căn / Defect / Tổng hợp không double-trigger.
- Camera/role resume hardening giữ nguyên.
- Drive mapping/chat/realtime không thay đổi.

## 10. Firebase Web App ID
Trong FULL SOURCE V6.2.17 và log deploy đã kiểm, **không có Web App ID thật**; log chỉ cho thấy `VITE_FIREBASE_APP_ID` đang trống. Vì vậy V6.2.18 **không tự đoán App ID**.

Đã chuẩn bị an toàn:
- Workflow đọc `VITE_FIREBASE_APP_ID` từ **GitHub Repository Variable** `VITE_FIREBASE_APP_ID`.
- `.env.example` ghi rõ phải dùng Web App ID thật.
- Production console cảnh báo nếu App ID vẫn trống.

Khi lấy được ID thật từ Firebase Console → Project settings → Your apps → Web app, chỉ cần tạo GitHub Repository Variable `VITE_FIREBASE_APP_ID` với giá trị thật. Không cần đổi Firebase Project.

## 11. File thật sự thay đổi so với V6.2.17
- `.env.example`
- `.github/workflows/firebase-hosting-merge.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `package-lock.json`
- `package.json`
- `src/components/FloorPlanDefectTab.tsx`
- `src/config/appVersion.ts`
- `src/lib/firebase.ts`

Không có file bị xóa: **True**.

## 12. Kiểm tra trước khi đóng gói
- TypeScript/TSX syntax parse: **PASS** – {"files":85,"errors":0,"sample":[]}
- Relative imports: **PASS** – thiếu 0.
- `package.json` ↔ `package-lock.json` dependencies: **PASS**.
- Version root package/lock: **PASS** – {'package.json': '6.2.18', 'package-lock.json': '6.2.18', 'appVersion.ts': '6.2.18'}; workflows={'firebase-hosting-merge.yml': 'V6.2.18', 'firebase-hosting-pull-request.yml': 'V6.2.18'}.
- Workflow YAML: **PASS** – [('build.yml', True, ''), ('firebase-hosting-merge.yml', True, ''), ('firebase-hosting-pull-request.yml', True, '')].
- `firestore.rules`: **UNCHANGED / PASS**.
- `npm ci`: **KHÔNG HOÀN TẤT** trong môi trường hiện tại (timeout 45 giây); `node_modules/.bin/tsc` và `vite` chưa được cài đầy đủ.
- `npm run lint` / `npm run build`: **KHÔNG CHẠY** do `npm ci` không hoàn tất. Không ghi Build PASS giả.

## 13. Đề xuất sau V6.2.18 (chưa đưa vào source)
1. **Tìm kiếm → Focus**: tìm tên Căn/DF rồi bấm kết quả sẽ focus ngay trên map.
2. **Cluster Defect theo mức zoom**: zoom xa gom marker thành badge số lượng, zoom gần mới tách từng Defect.
3. **Preset lớp hiển thị**: `Thi công`, `Defect`, `Tổng hợp sạch` để bật/tắt nhiều layer bằng 1 nút.
4. Nếu cần khóa đồng bộ nhiều thiết bị, thiết kế `geometryLocked` riêng với quyền ADMIN/ENGINEER và migration an toàn; không nên trộn vào patch UI hiện tại.
