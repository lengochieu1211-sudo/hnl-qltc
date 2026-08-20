# QLCT An Phú V6.2.10 — Firestore Memory Cache & Storage Recovery

## Mục tiêu
Xử lý dứt điểm crash `FIRESTORE INTERNAL ASSERTION FAILED` do `QuotaExceededError` trên các key WebStorage `firestore_clients_*` / `firestore_mutations_*`, xảy ra cả khi mạng mạnh.

## Nguyên nhân đã xác nhận
- Lỗi trực tiếp là WebStorage/localStorage đạt quota; không phải tốc độ mạng.
- Firestore persistent cache 12.x vẫn sử dụng WebStorage client-state metadata; khi localStorage đã gần đầy, một ghi metadata nhỏ có thể ném `QuotaExceededError` và làm SDK rơi vào internal assertion.
- Dữ liệu legacy của app (đặc biệt autosave snapshot và Base64 draft ảnh Defect) có thể chiếm nhiều MB localStorage.
- Ở V6.2.9, migration còn diễn ra sau khi App/Firebase đã được import nên Firestore có thể crash trước khi cleanup kịp chạy.

## Thay đổi V6.2.10
1. `src/main.tsx`
   - Chạy storage preflight trước khi dynamic-import `App.tsx`.
   - Migrate dữ liệu legacy + cleanup WebStorage trước khi Firebase khởi tạo.

2. `src/lib/firebase.ts`
   - Chuyển Firestore từ `persistentLocalCache()` sang `memoryLocalCache()`.
   - Giữ realtime sync, multi-device sync và long polling.
   - Loại bỏ đường ghi WebStorage shared-client state gây crash quota.

3. `src/utils/migrateStorage.ts`
   - Migrate các collection nghiệp vụ legacy sang `ConstructionAppDB/app_data`.
   - Migrate `construction_autosave_versions` dưới dạng raw string trước, tránh parse snapshot lớn trong bootstrap.
   - Migrate Base64 draft ảnh Defect sang IndexedDB trước khi xóa localStorage.
   - Chỉ xóa localStorage sau khi đọc xác minh dữ liệu đã tồn tại trong IndexedDB.

4. `src/utils/backupDb.ts`
   - Import lazy lịch sử autosave legacy từ raw IndexedDB vào `BackupVersionDB`.
   - Không cần giữ snapshot lớn trong localStorage nữa.

5. `src/utils/storage.ts`
   - Cleanup chỉ nhắm cache/transient Firestore cũ và state tạm.
   - Không xóa dữ liệu nghiệp vụ/project/member/backup/ảnh IndexedDB.
   - Không xóa ảnh Defect draft nếu chưa migrate xác minh.

6. `src/components/FloorPlanDefectTab.tsx`
   - Đọc lại ảnh draft legacy đã được bootstrap chuyển sang IndexedDB.
   - Sau khi lưu thành công vào PhotoStorage mới xóa bản draft.

7. `src/lib/chatService.ts` + `src/utils/chatOutbox.ts`
   - Thêm Chat Outbox trên IndexedDB.
   - Tin được ghi outbox trước khi gửi Firestore.
   - Khi online lại, tự retry.
   - Dùng deterministic message ID và `getDoc()` khi flush để tránh increment conversation summary lần hai nếu message đã lên server trước khi app đóng.

8. `public/sw.js`
   - Bump cache version để loại bundle cũ khỏi service worker cache.
   - Cập nhật thông báo offline thành IndexedDB thay vì localStorage.

9. Version/workflow
   - package/app/workflow = `6.2.10`.

## Kiểm tra đã chạy
- Static transpile: 84 file TS/TSX/TS, 0 syntax error.
- Local relative import validation: 0 missing import.
- package.json / package-lock root version: 6.2.10 đồng bộ.
- Dependency declarations top-level: không phát hiện mismatch.
- Workflow YAML: 3 file parse OK.
- Không còn `persistentLocalCache` / `persistentMultipleTabManager` trong Firebase runtime.
- Firestore runtime dùng `memoryLocalCache()`.

## Giới hạn kiểm tra môi trường
`npm ci` trong container thử nghiệm bị timeout khi tải dependencies, do đó Vite production build cần GitHub Actions xác nhận cuối cùng sau khi Push. Không ghi Build PASS giả.

## Regression cần test sau deploy
1. Mở app trên thiết bị từng bị quota crash và reload nhiều lần.
2. Mở Phân quyền, Danh sách dự án, Chat, Mặt bằng, Defect.
3. Chụp/chèn 3-5 ảnh Defect liên tục.
4. Tắt mạng, gửi một tin Chat, đóng/mở app, bật mạng và xác nhận outbox tự gửi đúng 1 lần.
5. Chuyển LTIA ↔ Mizuki và xác nhận project/chat không lẫn.
6. Kiểm tra Backup lịch sử vẫn hiển thị sau migration.
7. Kiểm tra GitHub Actions Typecheck + Build + Deploy xanh.
