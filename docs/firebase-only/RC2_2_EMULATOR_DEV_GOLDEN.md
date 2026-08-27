# HNL QLTC RC2.2 — Firebase Emulator DEV Golden

## Mục tiêu
Chạy môi trường DEV local tách tuyệt đối khỏi Firebase PROD `com-example-qlct-61329` để kiểm thử Auth + Firestore + Storage + Hosting, PC + điện thoại cùng LAN, offline/reconnect và phân quyền.

## Cổng cố định
- Hosting: 5000
- Auth: 9099
- Firestore: 8080
- Storage: 9199
- Emulator UI: 4000

Tất cả bind `0.0.0.0`. Web dùng `VITE_FIREBASE_EMULATOR_HOST=auto`, nên điện thoại mở `http://<IP-PC>:5000` sẽ tự kết nối về cùng IP PC cho Auth/Firestore/Storage.

## Chống chạm PROD
- Emulator chỉ chạy khi `VITE_APP_ENV=DEV`.
- Từ chối projectId PROD.
- Project Emulator bắt buộc prefix `demo-`, mặc định `demo-hnl-qltc-dev`.
- Khi Emulator bật, app ép dùng Firebase config giả lập và bỏ qua mọi `VITE_FIREBASE_*` live đang tồn tại trong shell.
- App Check chỉ bypass trong Emulator.
- Drive write vẫn tắt.

## Khởi động Windows
Cách nhanh: chạy `START_HNL_QLTC_DEV_EMULATOR.cmd`.

Hoặc terminal:
```bash
npm ci
npm run dev:emulator
```

Mở PC: `http://127.0.0.1:5000`.
Console sẽ in IP LAN để mở trên điện thoại cùng Wi-Fi, ví dụ `http://192.168.1.10:5000`.

## Tài khoản DEV test
Trong modal đăng nhập sẽ xuất hiện 3 nút chỉ ở Emulator:
- ADMIN -> `admin@hnl.test`
- EDITOR -> `editor@hnl.test`
- VIEWER -> `viewer@hnl.test`

ADMIN là nhãn tài khoản test; để kiểm tra quyền thật, đăng nhập ADMIN tạo project, sau đó thêm `editor@hnl.test` và `viewer@hnl.test` bằng UI phân quyền bình thường.

## Runtime Golden
1. ADMIN tạo project `GOLDEN-RC2-2`.
2. ADMIN thêm EDITOR và VIEWER.
3. EDITOR điện thoại sửa dữ liệu; PC phải nhận realtime không reload.
4. EDITOR tạo defect + ảnh; PC nhận metadata và binary Storage.
5. VIEWER chỉ đọc, không ghi/upload/quản lý thành viên.
6. EDITOR đang mở app thì mất mạng, chỉnh dữ liệu; giao diện không blank.
7. Có mạng lại: pending write settle đúng 1 lần, không duplicate ID.
8. Hai phiên sửa cùng record: revision guard chặn stale overwrite.
9. Soft-delete/restore không ghost/resurrect dữ liệu cũ.
10. Kho IN/OUT đồng thời: atomic, không âm.
11. Backup JSON phải media-complete/fail-closed; restore chỉ manual merge, không thành realtime source.
12. PC reload offline trên localhost: Firestore persistent cache giữ dữ liệu đã xác minh nếu browser hỗ trợ.
13. Reconnect: không stale localforage overwrite, không Drive write.

### Lưu ý mobile offline reload
Mobile browser qua `http://<LAN-IP>:5000` kiểm tra được realtime, Storage, phân quyền, offline edit khi trang đang mở và reconnect. Offline reload hoàn toàn có thể bị giới hạn bởi quy tắc Service Worker trên HTTP LAN; gate này kiểm trên PC localhost hoặc Android wrapper/HTTPS riêng.

## Gate tự động
```bash
npm run test:stability
npm run typecheck
npm run lint
npm run test:rules
npm run security:audit
npm run build
```
`test:stability` đã gồm `scripts/emulator-golden.mjs`.
