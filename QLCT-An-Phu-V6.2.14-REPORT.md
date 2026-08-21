# QLCT An Phú V6.2.14 – Chat & Primary Drive Identity Hardening

## Baseline
- Nền sửa: `qlct-an-phu-main.zip` do người dùng tải lên sau khi V6.2.13 đã được push/deploy.
- Không đổi Firebase project/Hosting/repo/projectId.
- Không tự merge/xóa project hoặc folder Drive.
- Không đổi `firestore.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`, `apphosting.yaml`.
- Không Push GitHub / không Deploy Firebase / không Deploy Apps Script từ môi trường này.

## 1. Chat: xử lý tin nhắn treo “Đang gửi…”
File: `src/lib/chatService.ts`, `src/features/chat/ChatTab.tsx`.

- Tách ghi **message** khỏi cập nhật **conversation summary**. Message được commit trước; summary/badge là best-effort sau đó. Lỗi summary không còn làm cả message fail theo atomic batch.
- Message ID vẫn deterministic theo `uid + clientMessageId`, giữ cơ chế retry/idempotency hiện có.
- Outbox chỉ giữ lỗi tạm thời. Các lỗi vĩnh viễn như `permission-denied`, `unauthenticated`, `invalid-argument`, `failed-precondition` được loại khỏi hàng retry để không gửi lại vô hạn.
- Khi write bị Firebase từ chối, phát `qlct-chat-send-error` để UI hiện lỗi + nút `Gửi lại`.
- Snapshot merge không còn giữ pending message đã biến mất khỏi Firestore. Tin “ma” không còn nằm mãi ở trạng thái `Đang gửi…`.
- Thời gian chờ trước khi coi là queued tăng từ 350 ms lên 1200 ms để có thêm cơ hội nhận ACK nhanh, nhưng vẫn không khóa UI khi mạng chậm.
- Không tắt Chat, không tắt badge/realtime listener.

## 2. Drive chính An Phú: folder theo projectId, không theo tên
File: `apps-script/PrimaryDriveBridge/Code.gs`, `src/lib/primaryDriveBridge.ts`, `src/components/PrimaryDriveStatusCard.tsx`.

### Mapping folder ổn định
- Apps Script lưu mapping `projectId -> folderId` trong Script Properties.
- Khi chưa có mapping, bridge tìm folder bằng hậu tố `__<projectId>`; không tìm/chọn chỉ vì tên dự án giống nhau.
- Upload mới dùng folderId đã khóa; đổi tên dự án không tự tạo folder mới.
- `default` vẫn là projectId hợp lệ. Không tự đổi `Mizuki ...__default` sang `proj_...`.
- Hai dự án Sân Bay cùng tên nhưng khác ID vẫn là hai project/folder riêng. Không tự gộp/xóa.

### Đối chiếu file thực tế trên Drive
- Thêm action Apps Script `inventoryProject`.
- Inventory đọc file theo metadata mô tả: `projectId`, `photoId`, `floorPlanId`, `entityType`, `entityId`.
- Nếu lịch sử có nhiều folder cho **cùng một projectId**, inventory đọc các folder đó để đối chiếu nhưng không tự merge/xóa/move.
- Card Drive có nút **Đối chiếu Drive**.
- Card hiển thị `ProjectId` và folder Drive hiện bridge đang dùng.
- Số `Ảnh x/y` và `Mặt bằng x/y` có thể nhận biết file thực tế từ inventory, tránh tình trạng file đã có trên Drive nhưng UI vẫn báo `0/x` chỉ vì metadata local cũ.
- `Kiểm tra kết nối` vẫn tương thích bridge cũ: nếu `ping` thành công nhưng Apps Script chưa có `inventoryProject`, app báo cần cập nhật `Code.gs` thay vì kết luận Drive mất kết nối.

## 3. Đăng nhập: thống nhất ý nghĩa phiên Google/Firebase
File: `src/components/GoogleAuthModal.tsx`, `src/components/ProjectManagerModal.tsx`, `src/components/PrimaryDriveStatusCard.tsx`.

- Làm rõ user chỉ cần đăng nhập Google/Firebase của **chính user một lần**; các màn hình dùng chung Firebase Auth session.
- User thường không cần đăng nhập tài khoản Drive chính `lengochieu1211@gmail.com`.
- Drive chính được Apps Script thực thi bằng tài khoản chính; Firebase ID token của user chỉ dùng để xác minh danh tính/quyền project.
- Các màn hình bảo mật cần xác thực lại Google vẫn giữ nguyên chức năng re-auth, không bị biến thành một hệ login khác.

## 4. Workflow deploy
File: `.github/workflows/firebase-hosting-merge.yml`, `.github/workflows/firebase-hosting-pull-request.yml`.

- Version env đổi sang `V6.2.14`.
- Workflow merge trả về thứ tự an toàn: `Build -> Deploy Firestore Rules -> Deploy Hosting`.
- Bỏ `continue-on-error: true` ở Rules. Vì IAM Firebase Rules Admin đã được cấp, nếu Rules lỗi thật thì Hosting không được deploy nửa vời với Rules cũ.
- Node vẫn là 22.

## 5. Version
- `package.json`: 6.2.14.
- `package-lock.json`: 6.2.14.
- `src/config/appVersion.ts`: 6.2.14.
- Workflow env: V6.2.14.

## 6. Apps Script cần cập nhật riêng
GitHub/Firebase Hosting không tự deploy `apps-script/PrimaryDriveBridge/Code.gs`.

Sau khi nhận source:
1. Mở project Apps Script hiện tại bằng tài khoản Drive chính.
2. Thay `Code.gs` bằng file V6.2.14.
3. `Deploy -> Manage deployments -> Edit -> New version -> Deploy`.
4. Giữ cùng deployment để URL `/exec` không đổi.
5. Trong app bấm `Kiểm tra kết nối`, sau đó `Đối chiếu Drive`.

Không xóa hai folder Sân Bay hoặc folder Mizuki `__default` trước khi đối chiếu.

## 7. Kiểm tra kỹ thuật
- Static TS/TSX parse: **85 files, 0 syntax errors**.
- Relative imports: **0 file thiếu**.
- `package.json` ↔ `package-lock.json`: **0 mismatch**.
- Apps Script `Code.gs`: parse JavaScript bằng Node (copy tạm sang `.js`) **PASS**.
- 3 GitHub workflow YAML: **parse PASS**.
- Firebase config/rules hashes so với baseline: **không đổi**.
- `npm ci`: **không hoàn tất trong container; timeout 120 giây**.
- Vì `npm ci` không hoàn tất, `npm run lint` và `npm run build` **không được ghi PASS giả**. GitHub Actions production build sau khi push là kiểm tra cuối.
- ZIP CRC được kiểm tra sau khi đóng gói.

## 8. File thay đổi
1. `.github/workflows/firebase-hosting-merge.yml`
2. `.github/workflows/firebase-hosting-pull-request.yml`
3. `apps-script/PrimaryDriveBridge/Code.gs`
4. `apps-script/PrimaryDriveBridge/README.md`
5. `package.json`
6. `package-lock.json`
7. `src/config/appVersion.ts`
8. `src/lib/chatService.ts`
9. `src/features/chat/ChatTab.tsx`
10. `src/lib/primaryDriveBridge.ts`
11. `src/components/PrimaryDriveStatusCard.tsx`
12. `src/components/GoogleAuthModal.tsx`
13. `src/components/ProjectManagerModal.tsx`
14. `QLCT-An-Phu-V6.2.14-REPORT.md`
