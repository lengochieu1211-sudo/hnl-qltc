# HNL QLTC – POST PR39 DANG DỞ / BUSINESS FEATURE CLOSEOUT REPORT

**Ngày:** 02/09/2026  
**Baseline:** `HNL-QLTC-V6.3.0-FULL-SOURCE-POST-PR39-2026-09-02.zip`  
**Baseline SHA256:** `493387d1e9e22a1ae21d781dac9a64fa2c3d2d6f474b0bb53d719285936294b3`  
**GitHub main đã xác minh:** `983401732a931ca062d0803b847f083fe2b494f3`  
**Firebase project:** `com-example-qlct-61329`  
**Hosting site:** `hnlqltc`  
**Version:** `6.3.0`

## 1. Các mục đã xác minh có sẵn trong baseline POST PR39

### Checklist tạm ẩn khi chưa dùng – ĐÃ CÓ
- `src/App.tsx` dùng `checklistVisibility: 'auto' | 'always'`.
- Mặc định `auto`.
- Module Checklist chỉ hiện khi Super Admin chọn `always` hoặc có Checklist active.
- Nếu đang đứng tab Checklist mà module tự ẩn, app tự chuyển về tab Quân số.
- Dữ liệu Checklist vẫn được giữ để tương thích/backup, không bị xóa.

### Quân số Sáng / Chiều / Tối – ĐÃ CÓ
- `CrewRecord` có `morningCount`, `afternoonCount`, `eveningCount`.
- `CrewTab` cho nhập từng ca độc lập.
- `workerCount` được giữ tương thích legacy nhưng lấy max của các ca, không cộng sai thành tổng đầu người trong ngày.
- `crewUtils` có logic tương thích record cũ và record mới.

### Copy quân số – ĐÃ CÓ
- Mặc định mở ngày nguồn = ngày liền trước ngày đang xem.
- Cho phép chọn một ngày nguồn tùy ý.
- Chặn chọn cùng ngày nguồn/đích và chặn ngày tương lai ở UI liên quan.
- Khi copy, tạo ID mới và cập nhật actor/timestamp thay vì tái sử dụng ID record cũ.

## 2. Lỗi còn sót đã sửa

### Đồng bộ định dạng ngày theo Cài đặt → Cấu hình

**Nguyên nhân gốc:** `src/utils/dueDateUtils.ts` còn hàm legacy `formatDateVN()` tự ghép cứng `DD/MM/YYYY`. Vì WorkVolumeTab, ChecklistTab và DueDateToastNotifier dùng hàm này nên các ngày hạn không đổi theo `app_date_format_preset`.

**Sửa:**
- `formatDateVN()` giữ nguyên tên để không phá import/API hiện có.
- Nội bộ chuyển sang gọi `dateFormatter.formatDate()` – nguồn cấu hình ngày duy nhất của app.
- Không đổi schema dữ liệu, không migration dữ liệu, không đổi logic deadline.

**Ảnh hưởng được sửa:**
- Hạn Khối lượng.
- Hạn Checklist.
- Toast cảnh báo deadline.
- Các nơi đã dùng `formatDate`, `formatDateTime`, `formatDateDDMMYYYY` tiếp tục tự theo preset như trước.

## 3. File thay đổi/thêm

1. `src/utils/dueDateUtils.ts`
2. `reports/HNL-QLTC-POST-PR39-DANGLING-FEATURES-REPORT-2026-09-02.md`

`package.json` và `package-lock.json` không thay đổi.

## 4. Kiểm tra đã thực hiện

- Baseline ZIP SHA256: **PASS**, khớp manifest POST PR39.
- GitHub `main`: **PASS**, đúng `983401732a931ca062d0803b847f083fe2b494f3`.
- Main GitHub Actions Build #351 trên SHA trên: **PASS**.
- `node scripts/source-lint.mjs`: **PASS**.
- `node scripts/stability-gate.mjs`: **PASS**.
- Firebase `.firebaserc`: **PASS**, vẫn `com-example-qlct-61329`.
- Firebase Hosting config: **PASS**, giữ nguyên `dist` + SPA rewrite.
- Workflows hiện có: `build.yml`, `android-apk.yml`, `windows-exe.yml`, Firebase Hosting PR/merge, `r2-worker-deploy.yml`.
- Secret scan: **PASS cho private secret**; không thấy private key/GitHub token/Cloudflare R2 credential hard-code. Firebase Web API key hiện trong client/workflow là cấu hình web công khai theo kiến trúc hiện hữu, không thay đổi ở lượt này.
- Package/lock: cùng version `6.3.0`, lockfileVersion 3.

### Local TypeScript/Lint/Build
- Lint source riêng: **PASS**.
- Stability source gate: **PASS**.
- `npm ci` trong runtime hiện tại bị giới hạn thời gian/transport và dừng giữa chừng; dependency tree local chưa hoàn chỉnh, nên không dùng kết quả local này để kết luận TypeScript/Build.
- GitHub Actions là release certification chính cho branch này.

## 5. Invariant giữ nguyên

- Không đổi Firebase Project/App/Hosting.
- Không đổi GitHub repository.
- Không đổi R2 provider/gateway/access policy.
- Không đổi Auth/OAuth flow.
- Không đổi RBAC/Firestore Rules.
- Không Deploy PROD.

## 6. Release gate

Branch `fix/post-pr39-business-closeout-20260902` được tạo từ đúng main POST PR39. Chỉ merge sau khi Build + TypeScript + Lint + Rules + Security + APK + EXE xanh. PROD deploy vẫn là bước riêng cần người dùng cho phép.
