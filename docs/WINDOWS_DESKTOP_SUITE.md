# HNL QLTC Windows Desktop Suite

## Mục tiêu

Windows Desktop Suite nâng bản EXE từ launcher mở Web thành một shell Windows chuyên dụng, nhưng **không tách business logic thành ứng dụng khác**. Web, Android và Windows tiếp tục dùng chung dữ liệu Firebase/R2 và cùng mô hình phân quyền.

## Desktop Suite Core — RC2.2.17

Bản đầu tiên bổ sung:

- Dashboard native WinForms mang nhận diện `HNL QLTC Windows Desktop Suite`.
- Nút `Mở HNL QLTC` vẫn chạy Web PROD bằng Edge/Chrome app-mode.
- Giữ nguyên profile cũ `QLTCAnPhu/EdgeProfile` hoặc `ChromeProfile` để không làm mất cache/offline/local data.
- Workspace người dùng tại `Documents/HNL QLTC`.
- Các vùng: `Backup`, `Imports`, `Exports/Excel`, `Exports/PDF`, `Reports`, `Photos`, `Diagnostics`.
- Log kỹ thuật ở `%LOCALAPPDATA%/QLTCAnPhu/Logs`.
- Diagnostic snapshot JSON kiểm tra Hosting, R2 Gateway, AI Gateway, trình duyệt, hệ điều hành và dung lượng ổ đĩa.
- System tray: thu nhỏ Desktop Suite mà không đóng ứng dụng; menu mở Suite, mở HNL QLTC hoặc thoát hoàn toàn.

## Nguyên tắc dữ liệu

Workspace Windows chỉ là vùng làm việc/cache/staging. Nó **không thay thế**:

- Firestore: nguồn dữ liệu nghiệp vụ cloud.
- Cloudflare R2: nguồn binary cloud hiện hành.
- Cơ chế backup/restore và RBAC đang có trong ứng dụng.

Desktop Suite Core không tự upload, xóa, migrate hay repair dữ liệu cloud.

## Lộ trình tiếp theo

1. Local Workspace index + SQLite mirror/cache, không biến SQLite thành source-of-truth.
2. Background Sync Queue cho file/ảnh lớn và retry sau restart.
3. Backup Center: lịch backup, manifest, checksum và restore preview.
4. File/PDF/Excel Center: batch import/export và mở trực tiếp thư mục kết quả.
5. Diagnostics & Repair Center: kiểm reference Firestore -> R2, Defect -> Room -> Team, FloorPlan binary, pending/orphan.
6. Windows notifications cho defect quá hạn, lỗi sync và backup fail.
7. Auto-update có xác nhận người dùng trước khi cài.

Mỗi lớp phải qua regression Web + Android + Windows; không đổi Firebase Project, Hosting, GitHub repo hoặc R2.
## RC2.2.18 — Local Workspace Index + SQLite Queue

Desktop Suite bổ sung local data plane riêng cho Windows nhưng không thay đổi cloud authority:

- SQLite thật qua `winsqlite3.dll` có sẵn trên Windows 10/11; không cần ship thêm database DLL.
- Database: `%LOCALAPPDATA%\QLTCAnPhu\DesktopSuite\workspace.db`.
- `workspace_files`: mirror metadata của các file trong Backup/Imports/Exports/Reports/Photos/Diagnostics.
- `sync_queue`: hàng đợi bền vững qua restart cho các file mới/thay đổi trong `Imports` và `Photos`.
- Background maintenance quét workspace, tạo SHA-256 cho file staging và chuyển trạng thái sang `ready_for_app_sync`.
- Queue retry có backoff khi file tạm bị khóa/mất; trạng thái được giữ trong SQLite sau khi Windows/app restart.
- Diagnostic JSON bổ sung SQLite readiness, database path, indexed file count, queue pending/ready và lần index cuối.
- UI có nút `Quét lại chỉ mục` và trạng thái SQLite/Queue ở footer.

Giới hạn cố ý của RC2.2.18: queue **không tự upload R2 hoặc ghi Firestore**. Nó chỉ chuẩn bị local staging + checksum. Cloud write vẫn phải đi qua cơ chế HNL QLTC đã xác thực/RBAC, tránh tạo đường ghi dữ liệu thứ hai ngoài ứng dụng.

## RC2.2.19 — App Sync Bridge

Desktop Suite không trở thành cloud uploader. Thay vào đó:

- SQLite queue chuẩn bị binary + SHA-256 như RC2.2.18.
- Chỉ ảnh có đường dẫn canonical `Photos/<projectId>/<defect|crewRecord|chat>/<entityId>/<category>/<file>` mới được xuất vào `Documents/HNL QLTC/DesktopBridge/ready.json`.
- Web HNL QLTC trên Edge/Chrome dùng File System Access API để người dùng chọn `HNL QLTC` Workspace bằng quyền read/write.
- Web kiểm project, role, Firebase user và SHA-256 nguồn trước khi nhập.
- Web gọi đúng pipeline hiện hữu `savePhotoAttachment -> uploadPhotoToCloud -> verifyPhotoBinaryReadyInCloud`.
- Chỉ sau khi Cloud xác nhận binary ready, Web mới ghi ACK vào `DesktopBridge/acks`.
- Desktop đọc ACK tương ứng và chuyển queue sang `completed`.
- Sai project, VIEWER, SHA mismatch, file mất, Auth thiếu hoặc Cloud verify fail đều fail-closed và không ACK.

Thiết kế này giữ Firestore/R2 + Firebase Auth/RBAC là authority duy nhất; EXE không chứa Cloud credential và không có đường PUT R2/Firestore riêng.


## RC2.2.20 — Sync Center UI + Queue Management

Windows Desktop Suite bổ sung Sync Center native, vẫn giữ nguyên cloud authority của RC2.2.19:

- Queue hiển thị trạng thái `pending`, `retry`, `ready_for_app_sync`, `completed`, số lần thử, lịch retry, lỗi gần nhất và đường dẫn nguồn.
- Nút Retry thủ công chỉ đưa item chưa hoàn tất về `pending`; item `completed` bị khóa để tránh upload trùng.
- Có thao tác mở file nguồn, mở `DesktopBridge` và mở Web HNL QLTC để tiếp tục Auth/RBAC + Cloud upload.
- Bổ sung `sync_history` trong SQLite để ghi `prepared`, `retry`, `manual_retry`, `cloud_verified`.
- ACK Cloud-verified được ghi lịch sử trước khi queue chuyển `completed`.
- Diagnostic bổ sung số queue completed và số bản ghi lịch sử.
- Không chứa credential Cloud, không PUT trực tiếp R2/Firestore từ EXE.


## RC2.2.21 — Sync Center Hardening + Batch Operations

- Sync Center có bộ lọc trạng thái và tìm kiếm theo đường dẫn/lỗi gần nhất.
- Queue hỗ trợ chọn nhiều và Retry batch, hard-cap 50 item/lần để tránh block UI hoặc tạo burst công việc.
- Bảng queue hiển thị dung lượng từng file; header tổng hợp pending/retry/Web-ready/completed, tổng dung lượng và tỷ lệ audit completed.
- SQLite operation-level lock serialize toàn bộ transaction/index/bridge/queue UI để tránh timer nền chen vào giữa `BEGIN IMMEDIATE` và `COMMIT`.
- Quét thư mục dùng enumerator chịu lỗi `UnauthorizedAccess/DirectoryNotFound/IOException` và bỏ qua reparse point để tránh crash/cycle khi gặp thư mục bất thường.
- Retention local chạy tối đa 1 lần/24 giờ: `sync_history` giữ tối đa 90 ngày và 5.000 sự kiện gần nhất; queue `completed` giữ 30 ngày. Đây chỉ là audit/cache local, không xóa Firestore/R2.
- Sync Center tự refresh 5 giây nhưng mọi thao tác SQLite vẫn serialize qua operation gate.
- Cloud authority không đổi: upload vẫn do Web app Firebase Auth/RBAC + pipeline R2 hiện hữu thực hiện; EXE không có đường ghi Cloud riêng.

## RC2.2.21.1 — Fail-safe scan + ACK validation + idempotent bridge retry

- Workspace scan đánh dấu lượt quét **incomplete** nếu gặp thư mục tạm mất quyền/truy cập; lượt đó không purge stale index/queue để tránh coi file chưa đọc được là file đã bị xóa.
- Desktop chỉ chuyển queue sang `completed` khi ACK local có đúng schema, `queueKey`, `sourceSha256`, `projectId` và `cloudVerified=true`; tên file ACK một mình không đủ.
- Web bridge tạo `stablePhotoId` xác định từ project/entity/category/queueKey/source SHA. Nếu Cloud upload đã thành công nhưng ghi ACK local bị gián đoạn, lần retry dùng lại cùng logical photo ID thay vì tạo ảnh metadata mới.
- Luồng chụp/chọn ảnh thông thường vẫn dùng UUID ngẫu nhiên; stable ID chỉ được truyền bởi Windows bridge.

### RC2.2.22 replay-safe bridge hardening

- Mỗi lần queue chuyển sang `ready_for_app_sync` được cấp `attemptToken` 128-bit mới và lưu trong SQLite schema v4.
- Manifest `DesktopBridge/ready.json` mang `attemptToken` + deterministic `photoId`; Web phải xác minh cả hai trước upload/ACK.
- ACK chỉ hoàn tất queue khi khớp schema, queueKey, source SHA-256, projectId, attemptToken, deterministic photoId và `cloudVerified=true`.
- Queue `ready_for_app_sync` legacy chưa có token được đưa về `pending` để chuẩn bị lại fail-closed; không tự đánh dấu hoàn tất.
- Retry thủ công xóa token cũ; lần chuẩn bị kế tiếp sinh token mới, vì vậy ACK cũ không thể replay.

## RC2.2.23 — Professional Windows Installer + User-first Desktop UI

Windows release now has two packaging modes built from the **same launcher source**:

- `HNL-QLTC-Windows.exe`: portable/DEV rescue artifact retained for engineering and recovery.
- `HNL-QLTC-Setup.exe`: normal Windows installer for end users.
- DEV CI builds the isolated pair `HNL-QLTC-Windows-DEV.exe` + `HNL-QLTC-DEV-Setup.exe`; DEV and PROD installation identities/folders are separate.

### Installer behavior

- Requests Windows administrator permission only for installing into Program Files.
- Installs PROD under `C:\Program Files\HNL\HNL QLTC\` and DEV under `C:\Program Files\HNL\HNL QLTC DEV\`.
- Installs the main app as `HNL QLTC.exe` (or `HNL QLTC DEV.exe` for DEV).
- Creates `Start Menu > HNL > HNL QLTC` and, by default, a Desktop shortcut using the canonical HNL logo embedded in the installed EXE.
- Registers an uninstaller in Windows Installed Apps / `Programs and Features`.
- Detects an existing install and performs an in-place upgrade instead of creating another copy.
- Refuses to overwrite the installed executable while HNL QLTC is still running; user must exit from the tray first.
- Upgrade/uninstall never targets `Documents\HNL QLTC` or the existing `%LOCALAPPDATA%\QLTCAnPhu` data/cache tree, so local project workspace, backup, photos, SQLite cache and browser/offline profile are preserved.
- No Firebase/R2/AI credentials are embedded into the installer; the installer only packages the already-built launcher.

### User-first Desktop UI

The default native Windows dashboard is simplified for normal site users:

- Primary action: `Mở HNL QLTC`.
- User-facing cards: `Dữ liệu & Sao lưu`, `Xuất hồ sơ`, `Ảnh hiện trường`, `Trạng thái hệ thống`.
- Footer uses readable status such as `Dữ liệu cục bộ: Bình thường` and `Đồng bộ: Đã hoàn tất/Còn N mục` instead of raw SQLite/Queue counters.
- Technical items (`Workspace`, `SQLite index`, `Sync Center`, diagnostics/log folders) remain available from `Công cụ nâng cao` and are not removed.
- RC2.2.22 queue/ACK/attemptToken/photoId replay-safety remains unchanged; this release only changes Windows shell presentation and packaging around that certified engine.

### CI gates

Windows workflows now additionally:

1. Build the exact portable launcher first.
2. Package that exact EXE plus a dedicated uninstaller into the Setup EXE.
3. Validate the installer source contract (Program Files, Desktop/Start Menu shortcuts, uninstall registration, upgrade-safe/user-data-preserving behavior, DEV/PROD isolation).
4. Compile the installer on `windows-latest` and validate version/product metadata before artifact upload.
