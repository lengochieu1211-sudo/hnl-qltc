# HNL QLTC P15 — Chặn ghi kho legacy trong chế độ trusted DEV

**26/10/2026 — LOCAL DEV CANDIDATE / NOT CERTIFIED / PROD BLOCKED**

## Nguyên nhân
P14 đã đưa create/update/delete/restore phiếu bình thường qua Callable khi bật `VITE_WAREHOUSE_TRUSTED_WRITER=true`, nhưng `firebaseBase.ts` vẫn có 3 đường ghi tổng quát trực tiếp xuống `projects/{projectId}/inventory`:

1. Khôi phục/UPSERT toàn dự án (`saveProjectToCloud`) — kể cả nhánh `room-auto`.
2. Autosave diff realtime (`saveProjectDiffsToCloud`) — có giao dịch `room-auto` ghi trực tiếp.
3. Hàng đợi ghi ngoại tuyến (`queueProjectDiffsToFirestoreOffline`) — có thể phát lại sau reconnect.

Những thao tác đó không đồng bộ nguyên tử với `inventory_balances`, tạo nguy cơ sổ phiếu/tồn kho lệch nhau khi bật Rules chỉ cho trusted writer. Không đủ an toàn chỉ thêm cảnh báo hoặc chỉ sửa UI.

## Biện pháp P15
- Dùng **một cờ DEV duy nhất** `WAREHOUSE_TRUSTED_WRITER_ENABLED` định nghĩa ở `firebaseBase.ts` và tái xuất ở `warehouseTrustedClient.ts` (không có hai nguồn trạng thái khác nhau).
- Khi cờ **BẬT trên DEV**, cả 3 đường ghi tổng quát **từ chối toàn bộ** nếu có inventory UPSERT, xóa, hoặc restore khác rỗng **trước lệnh ghi nào**. Không tự bỏ qua chứng từ và không fallback về client khi Callable lỗi.
- Không ảnh hưởng các collection khác hoặc thao tác kho qua Callable. Khi cờ **TẮT** (bao gồm PROD hiện hành), không đổi hành vi cũ.
- Bộ kiểm tra thuần logic test 10/10 tình huống, và kiểm tra dấu nối mã nguồn.

## GIỚI HẠN QUAN TRỌNG
- Đây là guard chống đường tắt, **chưa phải triển khai đủ dịch vụ**: `room-auto`, đổi ĐVT, backfill/restore/import có thể bị từ chối trong DEV trusted mode cho tới khi có đường máy chủ tương ứng.
- `firestore.rules` đang hoạt động vẫn cho EDITOR ghi độc lập vào `inventory_balances` và sửa `subItems` legacy. **P1-ROOM / P1-BALANCE đều chưa đóng.**
- P12 Rules candidate ở file riêng; **chưa deploy**. Phải kiểm chứng ALLOW/DENY bằng Firebase Emulator và multi-user thật.
- Không có dữ liệu thật bị thay đổi. Không Push/Merge/Deploy.

## Kiểm chứng còn bắt buộc trước PROD
Làm đủ các đường ghi kho vào dịch vụ máy chủ; chạy `npm ci`, `tsc --noEmit`, lint, Build, Rules Emulator, snapshot DEV-copied read parity, Web/EXE/APK Golden, offline/reconnect, Auth ADMIN/EDITOR/VIEWER, 27 PROD-only commits và Firestore/R2 rollback có thể phục hồi. Chỉ công nhận CERTIFIED khi tất cả PASS trên đúng source/commit release.
