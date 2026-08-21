# An Phu Tool - Primary Drive Bridge

Tài khoản triển khai bắt buộc: **lengochieu1211@gmail.com**.

Mục đích: mọi ADMIN/ENGINEER của dự án vẫn đăng nhập Gmail riêng trong app, nhưng file ảnh được Apps Script tạo trong Google Drive của tài khoản chính. Firebase chỉ giữ dữ liệu nghiệp vụ + metadata/link Drive. VIEWER chỉ tải/xem ảnh, không được tải mới/xóa.

## Triển khai một lần
1. Đăng nhập https://script.google.com bằng `lengochieu1211@gmail.com`.
2. New project -> đặt tên `An Phu QLTC Primary Drive Bridge`.
3. Dán nội dung `Code.gs` vào Code.gs.
4. Project Settings -> bật **Show appsscript.json manifest file** -> dán nội dung `appsscript.json`.
5. Deploy -> New deployment -> Web app.
6. Execute as: **Me (lengochieu1211@gmail.com)**.
7. Who has access: **Anyone**.
8. Authorize quyền Google Drive khi Google hỏi.
9. Copy URL kết thúc bằng `/exec`.
10. Trong app: Lưu & Đồng Bộ -> `Drive chính An Phú` -> dán URL -> Lưu cấu hình -> Kiểm tra kết nối.

Không đưa mật khẩu, OAuth token hoặc service-account key vào GitHub. Web App URL có thể được lưu trong Firestore; mọi request vẫn phải kèm Firebase ID token hợp lệ và Apps Script kiểm tra quyền dự án trước khi xử lý.

## V5 - ảnh mặt bằng
Bridge hiện nhận thêm 3 thao tác bảo mật theo quyền dự án:
- `uploadFloorPlan`: đưa ảnh mặt bằng vào `HINH ANH/MAT BANG/<floorPlanId>` trên Drive chính.
- `downloadFloorPlan`: thiết bị khác tải lại ảnh mặt bằng bằng `fileId` sau khi đã xác minh Firebase ID token + quyền dự án.
- `deleteFloorPlan`: xóa file mặt bằng khỏi Drive khi chức năng xóa cloud được gọi.

Firebase chỉ giữ metadata (`driveFileId`, `storageProvider`, revision, kích thước...) và có Firestore-chunk fallback nếu Drive chính chưa cấu hình hoặc tạm lỗi.

## V6.2.14 - projectId/folder identity + đối chiếu Drive
- Mỗi project được khóa vào một folder Drive ổn định bằng `projectId -> folderId` trong Script Properties. App **không tìm/tạo folder chỉ theo tên dự án**.
- `default` vẫn là projectId hợp lệ; không tự đổi Mizuki `__default` sang ID mới.
- Hai dự án cùng tên nhưng khác ID (ví dụ hai LTIA Sân Bay) vẫn là hai folder riêng. Không tự gộp/xóa.
- Thêm action `inventoryProject` để app đối chiếu file thực tế trên Drive theo mô tả `projectId`, `photoId`, `floorPlanId` và hiển thị đúng số đã ở Drive.
- Nếu lịch sử có nhiều folder cho **cùng một projectId**, bridge chỉ đọc tất cả để đối chiếu; upload mới đi vào folder đã khóa. Không tự di chuyển hoặc xóa dữ liệu cũ.

### Khi cập nhật từ bridge cũ
GitHub/Firebase Hosting **không tự deploy Apps Script**. Sau khi cập nhật source V6.2.14, mở project Apps Script hiện tại của tài khoản chính, thay `Code.gs` bằng bản mới rồi **Deploy -> Manage deployments -> Edit -> New version -> Deploy**. Giữ nguyên URL `/exec` nếu cập nhật cùng deployment.
