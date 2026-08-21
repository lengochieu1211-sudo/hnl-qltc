# QLCT AN PHÚ V6.2.12 — Đồng bộ & Sao lưu UI / Backup Performance

## Baseline và phạm vi
- Baseline duy nhất: `QLCT-An-Phu-V6.2.11-JSON-SCOPE-UI-FULL-SOURCE.zip` do người dùng tải lên.
- Nâng version package lên `6.2.12`.
- Không đổi Firebase project, Hosting, `.firebaserc`, `firebase.json`, `apphosting.yaml`, Firestore Rules hoặc projectId.
- Không Push GitHub. Không Deploy Firebase.
- Không migration dữ liệu Firebase.

## File đã sửa
1. `src/components/ProjectManagerModal.tsx`
2. `src/App.tsx`
3. `package.json`
4. `package-lock.json`

## UI Đồng bộ & Sao lưu
### Đã bỏ khỏi màn hình chính
- Bỏ toàn bộ card `Tự động sao lưu` dạng checkbox theo module: Định mức vật tư, Kho & Phân phối, Khối lượng, Mặt bằng, Defect, Tiến độ tầng, Checklist, Nhân công...
- Không xóa schema/dữ liệu/tùy chọn storage cũ chỉ vì bỏ UI.
- Không có công tắc bật/tắt Firebase realtime trên màn hình chính.

### Đồng bộ dữ liệu / Firebase
- Đổi tiêu đề thành `Đồng bộ dữ liệu`.
- Giữ project hiện tại và trạng thái realtime/photo sync hiện có.
- Chú thích chính được rút gọn thành: dữ liệu dự án tự động đồng bộ giữa các thiết bị bằng Firebase.
- Các công cụ đồng bộ thủ công/ID cũ vẫn nằm trong vùng nâng cao hiện hữu, không thay đổi projectId.
- Firebase realtime V6.2.11 không bị tắt hoặc rollback.

### Drive chính An Phú
- Giữ `PrimaryDriveStatusCard` và pipeline Drive hiện có.
- Không đưa Base64 ảnh trở lại Firestore.
- Không thay đổi owner Drive/config backend.

### Nhập / Xuất dữ liệu
- Card cũ `Sao lưu & Khôi phục` đổi thành `Nhập / Xuất dữ liệu`.
- Giữ `Xuất bản sao JSON`; khi bấm mới chọn phạm vi: dự án hiện tại / chọn nhiều / tất cả dự án.
- Đổi `Đọc File JSON` thành `Khôi phục từ JSON`.
- JSON scope tiếp tục chỉ áp dụng file JSON thủ công, không tác động Firebase realtime/quyền dự án.

### Cài đặt sao lưu nâng cao
Mặc định thu gọn bằng `<details>`, chứa:
- Tần suất tạo bản sao nền: Tắt / 30 phút / 1 giờ / 3 giờ / Hàng ngày.
- AES-256 GCM.
- Dán JSON trực tiếp.
- Liên kết Auto-Save file hệ thống và quyền ghi file.

### Bản sao gần đây trên thiết bị
- Đổi tên thành `Bản sao gần đây trên thiết bị`.
- Ghi rõ: chỉ lưu cục bộ trên điện thoại/máy tính hiện tại, không phải Firebase realtime và không tự xuất hiện trên thiết bị khác.
- Trạng thái rỗng: `Chưa có bản sao trên thiết bị.`
- Nút restore đổi thành `Khôi phục bản này`.
- Dữ liệu version local vẫn lưu IndexedDB qua `BackupVersionDB` hiện có.

### Phiên bản đám mây
- Nếu số bản Cloud = 0: không render khối danh sách lớn.
- Nếu có bản: mới hiện `Phiên bản đám mây (n)` dạng thu gọn.
- Bỏ nút `Tải lại` nổi thường xuyên khỏi danh sách.

## Tối ưu backup / chống lag
### Sửa điểm nghẽn chính
V6.2.11 trước đây có effect:
`lastUpdatedAt -> đợi 4 giây -> buildAllProjectsBackupObject() -> mới save version`.

V6.2.12 đảo thứ tự:
1. Kiểm tra hydrate/loading/restoring/initializing.
2. Kiểm tra sync lock / switching project.
3. Kiểm tra thật sự đã có edit sau hydrate.
4. Đọc tần suất backup và thoát ngay nếu `Tắt`.
5. Kiểm tra chưa đủ thời gian thì thoát.
6. Kiểm tra `document.visibilityState === visible`.
7. Sau 12 giây idle/debounce, kiểm tra lại project vẫn là project ban đầu và các guard vẫn hợp lệ.
8. Chỉ lúc đó mới build backup.

### Scope backup nền
- Backup version nền không còn gọi `buildAllProjectsBackupObject()`.
- Dùng `buildCurrentProjectVersionBackupObject()` chỉ thu thập storage keys của project hiện tại + project index cần thiết + ảnh của project hiện tại.
- Drive mirror nền dùng lightweight `buildPrimaryDriveBackupObject()` của project hiện tại.
- Mặc định interval: 1 giờ; không tạo version sau mỗi thao tác.
- Tab hidden hoặc đang chuyển project: bỏ lượt backup đó; lần thay đổi sau/phiên visible tiếp theo mới đủ điều kiện chạy.

### Auto-save JSON file
- Effect chỉ chạy khi đã có file handle liên kết.
- Vẫn kiểm tra edit/lock/permission trước khi ghi.
- Single-project file sử dụng `buildSingleProjectBackupJson()`; không build tất cả dự án.
- All-project file chỉ chạy khi user thực sự đã liên kết file All Projects và `hasUnsavedAllBackupChangesRef` báo có thay đổi.

## Các tối ưu V6.2.11 được giữ
Không sửa/rollback các khu vực:
- Project discovery debounce/cache/metadata.
- `users/{uid}.projects` idempotent.
- Owner query `docChanges()`.
- Repair access index/invitation fallback.
- Firestore root metadata throttle.
- Role realtime filter.
- Audit role caching/detail limit.
- Photo realtime `docChanges()`, idle/delay/hidden/retry.
- Defect/Quân số không preload thumbnail hàng loạt.
- Chat badge visible-only/debounce/resume.
- Chuyển project không `window.location.reload()` trong luồng bình thường.
- `active_project_id` ưu tiên `sessionStorage`.
- Duplicate project cùng tên khác ID không tự merge/xóa.

## Mobile UI
Code-level audit cho các breakpoint 360 / 375 / 390 / 412 / 430 px:
- Các action chính dùng grid 2 cột và text nhỏ hiện hữu; advanced settings thu gọn để giảm chiều dài màn hình.
- Cloud versions không chiếm chỗ khi rỗng.
- Danh sách version có `max-h` + scroll nội bộ.
- Không thêm width cố định lớn hoặc modal mới vượt viewport.
- Môi trường hiện tại không có browser/device runner để xác nhận screenshot pixel-perfect; đây là kiểm tra source/layout tĩnh, không ghi mobile visual PASS giả.

## Kiểm tra kỹ thuật
### npm ci
- ĐÃ THỬ.
- Lần chạy cài dependency không hoàn tất trong giới hạn môi trường; lần retry `npm ci --prefer-offline --no-audit --no-fund` bị timeout 120 giây.
- `node_modules` ở trạng thái cài dở, vì vậy không dùng nó để kết luận production build.

### npm run lint
- ĐÃ THỬ.
- Không thể hoàn tất hợp lệ vì dependency/type packages trong `node_modules` cài chưa đủ (`@types/node`, `@types/express`, babel types... bị thiếu).
- Không ghi Lint PASS giả.

### TypeScript/TSX syntax
- PASS bằng TypeScript `transpileModule` độc lập: **84 files, 0 syntax errors** (bỏ `.d.ts`, gồm `src`, `server.ts`, `vite.config.ts`).

### npm run build
- ĐÃ THỬ.
- FAIL do môi trường dependency chưa hoàn tất: `vite: not found`.
- Không ghi Build PASS giả.

### Relative imports
- PASS: **0 relative import thiếu file**.

### package.json ↔ package-lock.json
- PASS: version `6.2.12` đồng nhất ở package/lock root.
- PASS: dependency declarations **0 mismatch**.

### GitHub workflow YAML
- PASS parse YAML: 3 workflow:
  - `.github/workflows/firebase-hosting-pull-request.yml`
  - `.github/workflows/firebase-hosting-merge.yml`
  - `.github/workflows/build.yml`
- Không sửa workflow.

### Firebase / Firestore sensitive files
SHA-256 so với baseline: **UNCHANGED** cho:
- `firestore.rules`
- `database.rules.json`
- `firebase.json`
- `.firebaserc`
- `apphosting.yaml`

### PATCH scope
PATCH chỉ chứa 4 file source/package thật sự thay đổi:
- `src/App.tsx`
- `src/components/ProjectManagerModal.tsx`
- `package.json`
- `package-lock.json`

### FULL SOURCE
- Không chứa `node_modules`.
- Không chứa `dist`.
- Có kèm report V6.2.12.

### ZIP CRC
- Kiểm tra bằng `unzip -t` cho cả PATCH và FULL SOURCE trước khi giao.

## Lưu ý restore
- Restore version local hiện vẫn dùng cơ chế restore hiện hữu; trước khi restore ứng dụng vẫn hiển thị xác nhận ghi đè.
- V6.2.12 không tự sửa/xóa projectId và không tạo migration project.

## Kết luận
Bản V6.2.12 tập trung làm rõ ranh giới giữa Firebase realtime, Drive chính, version local và JSON import/export; đồng thời loại bỏ việc serialize toàn bộ dự án theo mỗi `lastUpdatedAt`. Không Push/Deploy.
