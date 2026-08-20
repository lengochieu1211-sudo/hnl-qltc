# QLCT An Phú V6.2.7 – Project Discovery Compatibility & Defect Label Readability

## Nền nâng cấp
- Nâng trực tiếp từ V6.2.6 và bao gồm luôn hotfix dependency `pdfjs-dist ^6.2.108`.
- Không đổi Firebase project, Hosting URL, repo hoặc projectId hiện có.
- Không migration/xóa dữ liệu cũ.

## 1. P0 – Member đã có quyền nhưng không thấy dự án
### Nguyên nhân thực tế
Production hiện vẫn chạy Firestore Rules V6.2.1 vì GitHub Actions service account bị HTTP 403 khi deploy Rules mới.
Trong V6.2.5/6.2.6, `saveProjectMemberToCloud()` làm theo thứ tự:
1. ghi member;
2. ghi `projectAccess`;
3. mới ghi invitation.

Với Rules V6.2.1, bước 2 (`projectAccess`) bị permission-denied và làm hàm dừng. Kết quả: ADMIN nhìn thấy member VIEWER/ENGINEER trong danh sách nhưng invitee không có discovery row, nên `Danh sách dự án (0)`.

### Đã sửa
- `projectInvitations` (đường discovery tương thích Rules V6.2.1) được ghi **trước**.
- `projectAccess` trở thành best-effort; fail không làm hỏng việc phân quyền.
- `repairProjectAccessIndexForProject()` giờ repair cả invitation legacy cho toàn bộ member active và dùng `Promise.allSettled`, nên projectAccess fail không chặn invitation.
- Khi invitee nhận được invitation và đọc project thành công, app tự ghi lại `users/{uid}.projects` để dự án tiếp tục tồn tại trong danh sách sau khi invitation được consume.
- Không cần xóa rồi thêm lại `ngochieu.anphu@gmail.com`; ADMIN chỉ cần mở ứng dụng/Security > Phân quyền một lần sau deploy V6.2.7 để repair chạy.

## 2. Defect label khi zoom mặt bằng
- Dot/leader vẫn tự thu nhỏ mạnh khi zoom để không che bản vẽ.
- Badge/chữ Defect không còn dùng cùng mức scale 55% với dot.
- Badge Defect dùng font/padding gần cùng kích thước nhãn Căn / Phòng (`9px/10px`) và chỉ co nhẹ tối đa xuống ~92% ở zoom rất lớn.
- Ở 500–700%, mã DF-xx vẫn đọc được thay vì teo quá nhỏ.
- Tọa độ thật x/y của Defect không đổi.

## 3. GitHub Actions / Firestore Rules 403
- Xác nhận lỗi là IAM: `firebaserules.rulesets.test` bị 403.
- Workflow Hosting không còn bị đánh FAIL chỉ vì service account chưa có quyền deploy Rules:
  - step Rules dùng `continue-on-error: true`;
  - nếu Rules fail, workflow xuất warning rõ ràng.
- Web/Hosting vẫn deploy bình thường.
- Để deploy Rules mới thật sự, cấp cho GitHub Actions service account role:
  - **Firebase Rules Admin** (`roles/firebaserules.admin`).

## 4. Dependency/build hotfix được giữ lại
- `package.json`: `pdfjs-dist ^6.2.108` khớp package-lock.
- Version package/lock: `6.2.7`.
- Workflow version: `V6.2.7`.

## File thay đổi
- `.github/workflows/firebase-hosting-merge.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `package.json`
- `package-lock.json`
- `src/config/appVersion.ts`
- `src/lib/firebase.ts`
- `src/components/FloorPlanDefectTab.tsx`

## Kiểm tra
- TypeScript/TSX syntax parse (loại `.d.ts`): 0 syntax error.
- GitHub workflow YAML parse: PASS.
- `package.json` / `package-lock.json` pdfjs-dist: đồng bộ `^6.2.108`.
- `npm ci` trong container hiện không hoàn tất do lỗi môi trường container; GitHub Actions là kiểm tra production cuối cùng.

## Test sau deploy
1. ADMIN đăng nhập và mở Security > Phân quyền dự án LTIA một lần.
2. Giữ `ngochieu.anphu@gmail.com` ở VIEWER, không cần xóa/thêm lại.
3. Trên tài khoản `ngochieu.anphu@gmail.com`, refresh/reopen app.
4. LTIA phải xuất hiện trong Danh sách dự án; Mizuki vẫn hiển thị theo role ENGINEER.
5. Zoom Mặt bằng Defect lên 500–700%; mã Defect phải có cỡ gần nhãn Căn / Phòng.
6. GitHub Actions Hosting phải xanh; Rules có thể hiện warning cho tới khi IAM được cấp `roles/firebaserules.admin`.
