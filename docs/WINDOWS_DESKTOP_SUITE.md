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