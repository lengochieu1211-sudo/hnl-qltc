# P1 — Data Model / Lifecycle Report

## Đã chuẩn hóa

- `projectId` là khóa dự án bất biến; realtime registry ánh xạ đúng 9 subcollections.
- Business record dùng `id` document ID, không dùng display name làm document key trong đường mới.
- Lifecycle baseline schema **V5**: `createdAt`, `createdByUid`, `updatedAt`, `updatedByUid`, `revision`, `deleted`, `deletedAt`, `deletedByUid/deletedBy`.
- Soft-delete thay hard-delete cho core business collections.
- `revision` + `updatedAt` monotonic được kiểm tra cả client transaction path và Firestore Rules.
- Hạng mục active lấy từ WorkVolume/catalog hiện hành; category đã xóa không được tự xuất hiện lại trên Mặt bằng.

## REVIEW

- Legacy records có thể thiếu lifecycle fields; migration audit đánh dấu thay vì tự xóa/sửa mù.
- Một số model vẫn giữ denormalized display text (`workCategoryName`, room/floor name...) để hiển thị lịch sử. Chưa được phép xóa trước khi ID reference coverage đạt Golden.
- `ENGINEER` được Rules/role resolver chấp nhận tạm thời như alias legacy của `EDITOR`; member migration về canonical roles chưa chạy production.

## Schema

- App version: `6.3.0`.
- Data schema: **5 — firebase-only-lifecycle-storage-migration**.
