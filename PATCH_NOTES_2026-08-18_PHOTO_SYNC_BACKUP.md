# An Phu QLTC - bản sửa ảnh / backup / đồng bộ / phân quyền (2026-08-18)

## Các lỗi đã sửa

1. Ảnh Báo quân số / Defect
   - Chụp ảnh và chọn ảnh dùng chung `PhotoAttachmentPicker`.
   - Android/Xiaomi picker có MIME rỗng vẫn nhận ảnh hợp lệ theo phần mở rộng.
   - Báo rõ HEIC/HEIF chưa hỗ trợ thay vì tạo ảnh lỗi.
   - Sau khi lưu ảnh, UI hiển thị ngay bằng dữ liệu ảnh vừa nén, không chờ IndexedDB/Firebase.
   - APK WebView: ưu tiên mở Camera khi input có `capture`, cấp URI permission cho ứng dụng Camera.

2. Đồng bộ ảnh nhiều thiết bị
   - Metadata ảnh realtime theo project.
   - Binary ảnh đồng bộ qua Firestore `projects/{projectId}/photos/{photoId}/chunks`.
   - Thiết bị khác tải binary khi cần hiển thị và cache lại cục bộ.
   - Thêm/sửa/xóa ảnh phát sự kiện đồng bộ và có audit log.

3. JSON backup / autosave có ảnh
   - Backup đơn dự án và toàn bộ dự án gọi `getProjectPhotosWithBinary()`.
   - Nếu thiết bị hiện tại chỉ có metadata ảnh Cloud, backup tự tải binary thiếu từ Cloud trước khi dựng JSON.
   - `photos` + `photoData` được giữ trong backup để có thể restore ảnh Defect / Quân số.

4. JSON 0 KB trên Android
   - Manual JSON export truyền string sang Android bridge để ghi theo luồng text/chunk, tránh base64 hóa một Blob JSON khổng lồ trong RAM.

5. Kho vật tư
   - Thêm nút `Chỉnh phiếu` cho giao dịch Nhập/Xuất đã có.
   - Form dùng chung cho tạo mới và chỉnh sửa; giữ nguyên ID khi chỉnh.

6. Công thức ô số
   - Thêm `MathNumberInput` dùng parser công thức hiện có.
   - Đã thay các native `type=number` còn lại trong Crew và RoomHighlight.
   - Material Norm và các ô công thức cũ tiếp tục dùng parser thống nhất.

7. PIN lag
   - Giảm blur / animation / shadow nặng ở màn hình khóa trên mobile.
   - Không giảm PBKDF2 bảo mật PIN.

8. Phân quyền + tài khoản
   - Màn hình phân quyền tải danh sách member từ Firestore thay vì chỉ localStorage.
   - Member đã đăng nhập Google có thể hiện `displayName` + email + quyền.
   - Owner/role không bị autosync ghi lại tùy tiện.

9. Nhật ký thay đổi Cloud
   - Audit log lưu email/Google displayName/UID, role, deviceId, deviceName, projectId, timestamp.
   - DATA_CHANGE ghi collection, record thêm/xóa/sửa và các field cấp cao thay đổi (tối đa gọn để không làm nặng app).
   - PHOTO_CHANGE ghi thêm/xóa/sửa ảnh Defect hay Báo cáo quân số và record liên quan.

10. Hiệu năng
   - Undo history giảm trên mobile.
   - Bỏ JSON.stringify toàn record trong đường cập nhật nóng; dùng immutable object identity để nhận biết record thay đổi.

11. Kiểm tra lại trước khi phát hành
   - Tách metadata ảnh và Base64 trong JSON backup để ảnh không bị ghi lặp 2-3 lần.
   - Giảm đáng kể dung lượng JSON và RAM khi xuất/autosave trên Android.
   - Giữ tương thích restore: `photos` chỉ chứa metadata, `photoData` chứa binary Base64 duy nhất.

## Google Drive / file JSON chung nhiều thiết bị

Không dùng một file JSON chung trong thư mục Drive làm nguồn dữ liệu realtime chính. Trình duyệt/APK ghi file kiểu File System/SAF chỉ là file local/provider handle và không có merge record-level giữa nhiều thiết bị; hai máy ghi cùng file có thể last-write-wins và mất thay đổi.

Nguồn đồng bộ nhiều thiết bị của bản này là Firebase theo `projectId` + record + ảnh. JSON/Drive được coi là backup/snapshot. Nếu muốn Google Drive API trực tiếp từ browser (không backend), cần cấu hình Google OAuth Client ID và Drive scope riêng; nên làm thành lớp backup sau khi Firebase sync đã ổn định.

## Kiểm thử bắt buộc sau deploy

- Android browser: chụp 2 ảnh Quân số, lưu -> ảnh phải hiện ngay.
- Android browser: chọn 2 JPG/PNG/WebP Defect -> ảnh phải hiện ngay.
- APK: lặp lại camera/gallery.
- PC đăng nhập cùng tài khoản -> mở cùng dự án -> ảnh mới phải hiện (binary tải khi mở).
- Export JSON dự án có ảnh -> file > 0 KB; tìm `photoData` trong JSON.
- Restore JSON vào bản test -> ảnh Defect/Quân số phải phục hồi.
- Chỉnh phiếu Nhập/Xuất -> tồn kho cập nhật theo phiếu mới.
- Nhập `1000/2`, `2*3.5`, `(10+5)*2` ở các ô số hỗ trợ -> giá trị đúng.
- Phân quyền -> tài khoản đã đăng nhập phải hiện tên/email/quyền.
- Audit -> thao tác trên điện thoại và PC phải hiện đúng tài khoản + thiết bị.
