# HNL QLTC V6.3.0 RC2.2.3 – Firestore Owner Claim / Null-Guard Fix

## 1. Baseline

- Baseline duy nhất: `HNL-QLTC-V6.3.0-RC2.2.2-FULL-SOURCE.zip`.
- Không rollback source cũ.
- Không đổi Firebase PROD project: `com-example-qlct-61329`.
- Không đổi Firebase Hosting, `.firebaserc`, `firebase.json`, Storage rules hoặc GitHub workflows.
- Không Push GitHub / không Deploy Firebase.
- PR runtime đang kiểm tra: PR #4, branch `rc2-2-emulator-dev-golden`.

## 2. Runtime blocker tái hiện

Trong Firebase Emulator DEV, tài khoản `admin@hnl.test` đăng nhập Auth thành công nhưng dự án mới chưa có project root trên Firestore. UI hiển thị VIEWER / Chỉ xem. Khi bấm **Xác minh quyền chủ dự án**, Firestore trả lỗi rules dạng:

`evaluation error ... Null value error for 'get'`

Nguyên nhân gốc: `isOwner(projectId)` đọc trực tiếp `projectDoc(projectId).data.ownerUid / ownerEmail`. Với một Emulator mới, `projects/{projectId}` chưa tồn tại, nên `get(...).data` là null và Rules dừng bằng evaluation error trước khi client có thể xác định root chưa tồn tại và chạy create-owner flow.

Ngoài ra, `allow read` cũ còn truy cập `resource.data.ownerUid` mà không guard trường hợp document chưa tồn tại.

## 3. Sửa nguyên nhân gốc

### `firestore.rules`

1. Thêm `projectExists(projectId)` dùng `exists(...)`.
2. `isOwner(projectId)` chỉ đọc project data khi project thực sự tồn tại.
3. Guard cả field legacy có thể thiếu:
   - `ownerUid`
   - `ownerEmail`
4. `canRecoverOwnerUid(projectId)` cũng yêu cầu project tồn tại và có `ownerEmail` trước khi dereference.
5. Cho phép **signed-in user GET/probe một project root chưa tồn tại** để client phân biệt:
   - project chưa tạo → được phép nhận `exists() == false` rồi đi qua strict `allow create`;
   - project đã tồn tại → vẫn phải qua `isMember/isOwner` như cũ.
6. Rule create vẫn giữ nguyên các điều kiện bắt buộc `id`, `name`, `ownerUid == request.auth.uid`, `ownerEmail == signedInEmail()`, `createdAt`.

### Security impact

Fix này không mở quyền đọc project đã tồn tại. Một document không tồn tại không có dữ liệu để lộ. Project đã tồn tại vẫn bị membership/owner gate. Regression runtime mới còn kiểm tra user đã đăng nhập nhưng **không được phân quyền** vẫn không đọc được project root đã tồn tại.

## 4. Regression tests thêm mới

### `scripts/firebase-rules-behavior.mjs`

Thêm Golden behavior:

1. Authenticated owner probe `projects/{pid}` khi root chưa tồn tại → phải ALLOW và trả `exists() == false`.
2. Owner tạo project root ngay sau probe → phải ALLOW.
3. Authenticated user chưa nằm trong member/owner của project đã tồn tại → phải DENY read.

### `scripts/emulator-golden.mjs`

Thêm static regression gate bắt buộc:

- có `projectExists(projectId)`;
- có guard `ownerUid` / `ownerEmail` trước khi đọc;
- missing-root read/probe path tồn tại;
- cả hai runtime rules behavior trên phải tồn tại.

## 5. File thay đổi

- `firestore.rules`
- `scripts/firebase-rules-behavior.mjs`
- `scripts/emulator-golden.mjs`
- `HNL-QLTC-V6.3.0-RC2.2.3-FIRESTORE-OWNER-CLAIM-FIX-REPORT.md` (mới)

Không thay đổi TypeScript application, package manifests, Firebase project config hay workflows.

## 6. Verification đã chạy trong môi trường hiện tại

### PASS

- `npm run test:stability` – PASS.
  - Stability Gate PASS.
  - Offline Golden PASS.
  - Category Golden PASS.
  - G1–G20 PASS.
  - Firebase-only Golden source matrix PASS với các external runtime item giữ đúng REVIEW/BLOCKED.
  - Legacy migration self-test PASS.
  - Emulator DEV Golden config PASS.
  - Missing-project owner-claim static regression PASS.
- `npm run lint` – PASS.
- `node --check scripts/firebase-rules-behavior.mjs` – PASS.
- `node --check scripts/emulator-golden.mjs` – PASS.
- JSON parse PASS: `package.json`, `package-lock.json`, `firebase.json`, `.firebaserc`.
- YAML parse PASS: toàn bộ `.github/workflows/*.yml`.
- `package.json` ↔ `package-lock.json` root dependency/devDependency specs – PASS.
- Secret scan – PASS: không private key, GitHub PAT hoặc service-account private key.
- Rules permissive `allow ... if true` scan – PASS.

### Byte-identical với RC2.2.2

- `package.json`
- `package-lock.json`
- `.firebaserc`
- `firebase.json`
- `storage.rules`
- `.github/workflows/build.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `.github/workflows/firebase-hosting-merge.yml`

### BLOCKED trong container hiện tại – cần GitHub Actions xác nhận

`npm ci` đã được thử nhưng npm registry không resolve được (`EAI_AGAIN registry.npmjs.org`), nên dependency tree không cài hoàn chỉnh. Do đó:

- full `npm run typecheck`: không thể đánh giá tại container vì dependencies/type declarations không có; lỗi chỉ là `Cannot find module ...` sau install bị network block.
- `npm run test:rules`: không tải/chạy được `firebase-tools@13.35.1` trong container; phải xác nhận trên GitHub Actions / Windows Emulator.
- `npm run security:audit`: BLOCKED bởi `EAI_AGAIN registry.npmjs.org`.
- `npm run build`: `vite: not found` vì `npm ci` không hoàn thành.

RC2.2.2 trước thay đổi rules đã đạt GitHub Actions Build #78 xanh toàn bộ. RC2.2.3 chỉ đổi Rules/test scripts, nhưng vẫn **bắt buộc** chạy lại PR #4 Actions trước khi tiếp tục Runtime Golden.

## 7. Runtime Golden tiếp theo

Sau khi PATCH RC2.2.3 được commit/push vào branch PR #4 và GitHub Actions xanh:

1. Dừng Emulator hiện tại bằng `Ctrl+C`.
2. Chạy lại `START_HNL_QLTC_DEV_EMULATOR.cmd` để nạp rules mới từ đầu.
3. Mở `http://127.0.0.1:5000`.
4. Đăng nhập DEV Admin.
5. Bảo Mật → Phân Quyền → **Xác minh quyền chủ dự án**.
6. Kỳ vọng: root được tạo/claim và role chuyển từ VIEWER sang ADMIN, không còn `Null value error`.
7. Sau đó mới tiếp tục ADMIN/EDITOR/VIEWER + PC/mobile + realtime + offline/reconnect Golden.
8. Chỉ merge PR #4 khi Runtime Golden đạt.

## 8. Production safety

- Không deploy PROD.
- Không thay `com-example-qlct-61329`.
- Không thay Hosting.
- Không chạy migration Drive→Storage.
- Không thay GitHub repository/workflows.
