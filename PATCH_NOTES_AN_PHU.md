# An Phu QLTC - Sync & Mobile Performance Patch

## Mục tiêu
- Đồng bộ đa thiết bị theo tài khoản Google + projectId.
- Đồng bộ cả dữ liệu và file ảnh Defect/Nhật ký quân số.
- Giữ hướng triển khai không bắt buộc Firebase Storage/Blaze.
- Giảm lag Android khi mở app và khi nhận realtime update.

## Thay đổi chính
1. Ảnh được nén cục bộ, metadata realtime và binary được chia chunk nhỏ lưu trong Firestore subcollection `projects/{projectId}/photos/{photoId}/chunks`.
2. Ảnh không tải hàng loạt khi mở dự án; chỉ tải binary khi màn hình thật sự cần hiển thị ảnh, sau đó cache IndexedDB.
3. Xóa ảnh dùng tombstone và dọn chunks để thiết bị khác không làm ảnh cũ sống lại.
4. Mỗi bản ghi Cloud có `updatedByUid`, `updatedByEmail`, `updatedByDeviceId`, `updatedByDeviceName`.
5. Autosync bình thường không còn tự ghi `ownerUid/ownerEmail` hoặc tự cấp ADMIN.
6. Listener Firestore sau lần bootstrap chỉ đưa các document thay đổi (`docChanges`) vào React thay vì merge cả collection mỗi lần.
7. Autosave diff dùng `updatedAt` thay cho `JSON.stringify` toàn record và không deep-clone toàn AppData sau mỗi sync.
8. Giảm lịch sử Undo trên mobile và code-split các tab nặng (XLSX/PDF) để giảm bundle khởi động.
9. Trung tâm Đồng bộ được bố trí lại: tài khoản + tự động đồng bộ là luồng chính; mã dự án/đẩy-tải thủ công chuyển vào Công cụ nâng cao.

## Lưu ý miễn phí
Cloud Storage for Firebase hiện yêu cầu Blaze, nên patch này không dùng Firebase Storage. Ảnh dùng Firestore chunking để vẫn có thể chạy trên Spark. Cần theo dõi quota Firestore vì ảnh vẫn tiêu tốn dung lượng/đọc ghi Cloud.
