# HNL QLTC – Cloudflare R2 Gateway

Gateway này giữ R2 private. Ứng dụng gửi Firebase ID token; Worker dùng chính token đó gọi Firestore REST để xác nhận project/member hiện có, vì vậy không cần nhúng Firebase service-account key vào Worker.

## Quyền
- VIEWER: đọc ảnh/file.
- EDITOR/ENGINEER: đọc + upload media nghiệp vụ.
- ADMIN/owner/super-admin: đọc + upload media + upload mặt bằng + purge object.
- `floor-plans/*` luôn ADMIN-only, đồng bộ với RBAC hiện tại.

## Tạo R2
1. Cloudflare Dashboard → R2 → Create bucket → đặt tên `hnl-qltc-media`.
2. Workers & Pages → Create Worker → dùng `worker.js` này.
3. Settings → Bindings → R2 bucket binding:
   - Variable name: `HNL_QLTC_MEDIA`
   - Bucket: `hnl-qltc-media`
4. Variables giữ đúng project Firebase hiện tại:
   - `FIREBASE_PROJECT_ID=com-example-qlct-61329`
   - `SUPER_ADMIN_EMAIL=lengochieu1211@gmail.com`
   - `ALLOWED_ORIGINS=https://hnlqltc.web.app,https://com-example-qlct-61329.web.app,https://com-example-qlct-61329.firebaseapp.com`
   - `MAX_UPLOAD_BYTES=26214400`
5. Deploy Worker, lấy URL HTTPS `https://...workers.dev`.
6. GitHub repo → Settings → Secrets and variables → Actions → Variables → New repository variable:
   - `VITE_R2_GATEWAY_URL` = URL Worker.
7. Không tạo R2 API token cho frontend; bucket giữ private.

## Chuyển lại Firebase Storage sau này
Đổi `VITE_BINARY_STORAGE_PROVIDER` từ `r2` sang `firebase-storage`, bật Firebase Storage và migrate object giữ nguyên `storagePath`. Firestore/Auth/Hosting không phải viết lại.
