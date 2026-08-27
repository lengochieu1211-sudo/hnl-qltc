# HNL QLTC V6.3.0 RC2.2.5 – MASTER RBAC / FLOORPLAN EDITOR HARDENING REPORT

Ngày audit: **2026-08-27**  
Trạng thái: **SOURCE COMPLETE – chờ GitHub Actions chứng nhận CI đầy đủ + Runtime Golden cuối**

## 1. Baseline bắt buộc

RC2.2.5 được làm trực tiếp từ **`HNL-QLTC-V6.3.0-RC2.2.4.1-FULL-SOURCE.zip`** làm nền. Không rollback source cũ, không đổi Firebase Project/Hosting/GitHub repo, không Push và không Deploy.

Các cấu hình production được giữ nguyên:

- Firebase project mặc định: `com-example-qlct-61329`
- Firebase Hosting production: giữ nguyên cấu hình hiện tại
- GitHub workflows: giữ nguyên 3 workflow hiện có; RC2.2.5 chỉ bổ sung regression gate trong `package.json`/scripts, không tự thay workflow
- `package-lock.json`: **không thay đổi**

## 2. Mục tiêu RC2.2.5

Khóa toàn bộ thao tác **cấu trúc dự án** cho `EDITOR/KỸ SƯ` và `VIEWER`, nhưng vẫn cho `EDITOR` thực hiện nghiệp vụ hiện trường được phép. Quyền được rà theo 4 lớp:

1. UI – không hiện/không kích hoạt nút sai quyền.
2. Handler – nếu modal/state cũ còn treo sau đổi tài khoản thì thao tác vẫn bị chặn.
3. Firestore Rules / Storage Rules – client sửa trực tiếp không được vượt quyền.
4. Regression matrix – tự động báo đỏ nếu quyền bị mở lại trong các lần sửa sau.

## 3. Ma trận quyền đã khóa

| Nhóm chức năng | ADMIN | EDITOR / Kỹ sư | VIEWER |
|---|---|---|---|
| Tạo/đổi tên/xóa/merge dự án | Có | Không | Không |
| Thành viên, phân quyền, bảo mật | Có | Không | Không |
| Khối lượng – tạo/import/sửa định nghĩa/xóa | Có | Không | Không |
| Khối lượng – xem tiến độ | Có | Có | Có |
| Mặt bằng – thêm/xóa/đổi tên/thứ tự/tải bản vẽ | Có | Không | Không |
| Căn/Phòng – tạo/xóa/copy/paste/di chuyển/resize/redraw | Có | Không | Không |
| Căn/Phòng – tiến độ/nghiệm thu/ghi chú/đội phụ trách | Có | Có | Không ghi |
| Defect – tạo/cập nhật trạng thái/ảnh | Có | Có | Không ghi |
| Defect – xóa | Có | Không | Không |
| Checklist – tạo/sửa định nghĩa/import/xóa | Có | Không | Không |
| Checklist – cập nhật kết quả nghiệm thu | Có | Có | Không ghi |
| Danh mục đội thi công | Có | Không | Không |
| Nhật ký quân số – thêm/sửa/copy | Có | Có | Không ghi |
| Nhật ký quân số – xóa | Có | Không | Không |
| Kho – nhập/xuất/sửa giao dịch | Có | Có | Không ghi |
| Kho – import/xóa/định mức vật tư | Có | Không | Không |
| Định mức vật tư | Có | Không | Không |
| Backup/Restore/Drive legacy sync | Có | Không | Không |
| Thùng rác/cấu hình dùng chung | Có | Không | Không |
| Global Undo/Redo snapshot | Có | Không | Không |
| Trường tài chính/đơn giá trên UI báo cáo | Có | Ẩn | Ẩn |
| Ảnh hiện trường Defect/Quân số | Có | Có | Chỉ xem |
| Chat dự án | Có | Có | Có, theo membership |
| Audit log | Có | Có đọc | Không đọc |

## 4. Sửa quan trọng trong RC2.2.5

### 4.1 FloorPlan / Room hardening

- `EDITOR` không còn `+ Thêm Căn / Phòng`, cập nhật/thay bản vẽ, công cụ vẽ hình học, copy/paste, manual reorder, drag/resize, xóa phòng, xóa phòng ẩn hoặc thao tác cấu trúc khác.
- `RoomHighlightModal` có `structureReadOnly` để Kỹ sư chỉ cập nhật dữ liệu hiện trường trên phòng có sẵn.
- Khi quyền/tài khoản thay đổi, các modal/selection/tool cấu trúc đang mở được fail-close thay vì tiếp tục dùng quyền ADMIN cũ.
- `Storage Rules`: binary bản vẽ mặt bằng `/projects/{projectId}/floor-plans/...` là ADMIN-only khi tạo/cập nhật/xóa.

### 4.2 WorkVolume hardening

- Giữ khóa RC2.2.4/RC2.2.4.1: `EDITOR` không thêm/import/sửa/xóa master WorkVolume.
- Tiến độ thực tế tiếp tục được suy ra/cập nhật từ dữ liệu hiện trường được phép, không cho Editor ghi trực tiếp master definition.

### 4.3 Master RBAC toàn ứng dụng

Bổ sung helper ADMIN-only cho:

- FloorPlan structure
- Material Norms
- Team directory
- Checklist structure
- Broad business delete
- Backup/Restore
- Global Undo/Redo

Các màn `Warehouse`, `Checklist`, `Crew`, `MaterialNorm`, `Security`, `ProjectManager`, `GoogleConfig` đều nhận role đã resolve và tách rõ quyền vận hành so với quyền cấu trúc/xóa/import.

### 4.4 Stale-session / đổi tài khoản

- Core save queue không ghi khi role chưa resolve.
- Shared settings chỉ được ghi Cloud khi role đã resolve và là ADMIN.
- Thùng rác, backup, Drive sync, local-all backup và restore đều fail-close khi role chưa resolve hoặc không phải ADMIN.
- Auto purge trash chỉ chạy khi role đã resolve và là ADMIN.

### 4.5 Photo handler hardening

- `PhotoAttachmentPicker` không chỉ ẩn nút bằng `readOnly`; các handler add/delete/edit/save cũng tự chặn khi read-only để tránh local ghost data nếu UI/state cũ còn treo.
- Defect photo legacy handlers cũng kiểm tra `canEditDefects` trước khi đọc/lưu ảnh chỉnh sửa.

### 4.6 Firestore fail-closed

- Các collection cấu trúc `work_volumes`, `floor_plans`, `rooms`, `material_norms`, `teams`, `checklist`, `settings`, `trash` được phân loại rõ.
- `floor_plan_images` Firestore legacy là read-only fallback; không cho client tạo/cập nhật lại metadata/chunk cũ.
- EDITOR generic writes chuyển sang **explicit allowlist**: chỉ `inventory`, `defects`, `crew_records`; `rooms` và `checklist` có rule operational riêng; `photos` có rule riêng.
- Collection mới/chưa phân loại mặc định **fail closed cho EDITOR**, tránh tính năng mới vô tình được quyền ghi.
- Generic physical delete chỉ ADMIN và vẫn không hard-delete core business records.

## 5. Regression tooling

Thêm `scripts/rbac-matrix.mjs` và đưa vào `npm run test:stability`.

Regression matrix hiện kiểm tra:

- canonical helper ADMIN/EDITOR/VIEWER;
- UI + handler defense;
- stale-role fail-close;
- Firestore structural/operational split;
- Storage floor-plan/media policy;
- WorkVolume/FloorPlan/Room/MaterialNorm/Team/Checklist/Warehouse/Crew/Defect/Backup/Project/Security;
- future/unclassified Firestore collection phải deny EDITOR;
- Viewer write denial;
- photo read-only handler defense.

`scripts/firebase-rules-behavior.mjs` cũng được mở rộng với runtime assertions ADMIN/EDITOR/VIEWER cho các ranh giới trên.

## 6. File thay đổi/thêm

1. `firestore.rules`
2. `storage.rules`
3. `package.json`
4. `scripts/emulator-golden.mjs`
5. `scripts/firebase-rules-behavior.mjs`
6. `scripts/rbac-matrix.mjs` **(mới)**
7. `src/App.tsx`
8. `src/components/ChecklistTab.tsx`
9. `src/components/CrewTab.tsx`
10. `src/components/FloorPlanDefectTab.tsx`
11. `src/components/GoogleConfigTab.tsx`
12. `src/components/MaterialNormModal.tsx`
13. `src/components/PhotoAttachmentPicker.tsx`
14. `src/components/ProjectManagerModal.tsx`
15. `src/components/RoomHighlightModal.tsx`
16. `src/components/SecurityModal.tsx`
17. `src/components/WarehouseTab.tsx`
18. `src/utils/securityUtils.ts`
19. `HNL-QLTC-V6.3.0-RC2.2.5-MASTER-RBAC-REPORT.md` **(mới)**

## 7. Gate đã chạy local

### PASS

- Stability Gate ✅
- Offline Golden ✅
- Category Golden ✅
- Firebase-only G1–G20 source matrix ✅
- Legacy migration audit self-test ✅
- Emulator DEV static Golden ✅
- Master RBAC Matrix ✅
- Source Lint ✅
- TS/TSX parser: **96 file parse PASS** ✅
- Toàn bộ `.mjs` `node --check` ✅
- JSON parse / package metadata consistency ✅
- `package.json` dependencies/devDependencies khớp `package-lock.json` ✅
- `.firebaserc` vẫn trỏ `com-example-qlct-61329` ✅
- `package-lock.json` không đổi ✅
- Firebase config / workflows không tự đổi ✅
- Secret signature scan không thấy private key / GitHub token / AWS key ✅

### CHƯA THỂ CHỨNG NHẬN LOCAL – PHẢI ĐỂ GITHUB ACTIONS CHẠY

Môi trường thực thi hiện tại không resolve được `registry.npmjs.org` (`Could not resolve host` / `EAI_AGAIN`). Vì `node_modules` không thể được cài sạch bằng `npm ci`, các gate sau **không được ghi giả là PASS**:

- full `tsc --noEmit`;
- Firebase Rules emulator behavior (`firebase-tools@13.35.1` cần tải dependency/JAR khi thiếu cache);
- `npm audit --omit=dev --audit-level=critical`;
- production `vite/esbuild` build.

Bước bắt buộc tiếp theo là commit đúng bộ RC2.2.5 này lên branch hiện tại **một lần** và để GitHub Actions chạy `npm ci → Stability → Typecheck → Lint → Rules → Security → Build`.

## 8. Hai giới hạn kiến trúc cần biết

1. **Đơn giá WorkVolume** hiện nằm chung document với dữ liệu WorkVolume. UI đã ẩn với EDITOR/VIEWER, nhưng Firestore Rules không có field-level read masking. Nếu cần bảo mật zero-trust để user có quyền đọc document cũng tuyệt đối không thể lấy đơn giá qua SDK/DevTools, phải tách dữ liệu tài chính sang collection/document ADMIN-only trong một migration schema riêng.
2. `Room.subItems[]` là mảng nhúng. App handler đã khóa thay đổi cấu trúc cho EDITOR, nhưng Firestore Rules không thể kiểm tra động từng field của mọi phần tử mảng mà vẫn cho cập nhật tiến độ từng sub-item. Zero-trust tuyệt đối cho nested sub-item structure cần normalize subItems thành documents riêng trong migration schema tương lai.

Hai điểm này **không được sửa chắp vá trong RC2.2.5** để tránh migration dữ liệu lớn ngay trước Runtime Golden; chúng phải được xử lý thành pass schema riêng nếu yêu cầu zero-trust tuyệt đối.

## 9. Trạng thái phát hành

- **Không Merge PR #4 ở bước này.**
- **Không Deploy Firebase PROD.**
- RC2.2.5 hiện là bộ source duy nhất để commit lên branch và chạy CI.
- Khi GitHub Actions xanh toàn bộ: chạy Runtime Golden cuối với ADMIN → EDITOR → VIEWER, PC + điện thoại, realtime, ảnh, offline/reconnect.
- Chỉ sau Runtime Golden PASS mới xem xét Merge/Deploy production.

## 10. Kiểm tra bộ file giao

Bộ giao được dựng lại từ thư mục source sạch dựa trên baseline RC2.2.4.1, chỉ overlay đúng 18 file source RC2.2.5 đã audit và report này; không lấy `node_modules` cài dở làm nguồn.

- PATCH ZIP: **19 file** = 18 file source thay đổi/thêm + MASTER REPORT.
- FULL SOURCE ZIP: **224 file source/tài liệu cấu hình**.
- FULL SOURCE có đủ `package.json`, `package-lock.json`, `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc`, `src/`, `scripts/` và 3 `.github/workflows`.
- Không đóng gói `node_modules`, `dist`, `.git`, `.firebase`.
- ZIP CRC / `unzip -t`: **PASS** cho cả PATCH và FULL SOURCE.
- Manifest PATCH: **PASS – đúng 19 file dự kiến, không thiếu/không thừa**.
- Manifest FULL SOURCE: **PASS – byte-for-byte khớp thư mục source sạch dùng để đóng gói**.

Lưu ý: kết quả đóng gói PASS không thay thế các gate CI đang chờ GitHub Actions do môi trường local không truy cập được npm registry.
