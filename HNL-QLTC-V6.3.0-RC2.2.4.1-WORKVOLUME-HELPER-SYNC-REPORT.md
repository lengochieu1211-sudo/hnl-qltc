# HNL QLTC V6.3.0 RC2.2.4.1 – WorkVolume Permission Helper Sync Fix

## Baseline

- Baseline duy nhất: `HNL-QLTC-V6.3.0-RC2.2.4-FULL-SOURCE.zip`.
- Không rollback source cũ.
- Không đổi Firebase Project / Hosting / GitHub repo.
- Không Push GitHub / Deploy Firebase.

## Lỗi thực tế từ GitHub Actions Build #80

Build #80 dừng tại Stability Gate với lỗi:

`FAIL: Work-volume structure permission helper: missing canManageWorkVolumeStructure`

Đối chiếu source cho thấy RC2.2.4 FULL SOURCE đã có helper này, nhưng branch `rc2-2-emulator-dev-golden` trên GitHub chưa có nó. Nguyên nhân thao tác là `src/utils/securityUtils.ts` nằm trong nhóm file không được tick khi commit RC2.2.4, nên UI/App/gate đã lên branch nhưng shared RBAC helper chưa được push.

## Sửa RC2.2.4.1

File logic cần đồng bộ:

- `src/utils/securityUtils.ts`

Helper chuẩn:

```ts
export function canManageWorkVolumeStructure(role: UserRole): boolean {
  return role === 'ADMIN';
}
```

Bổ sung marker RC2.2.4.1 ngay trên helper để dễ xác nhận source/commit và tránh bỏ sót lần nữa.

Ý nghĩa:

- ADMIN: được tạo/import/sửa định nghĩa/xóa cấu trúc WorkVolume.
- EDITOR: không được quản lý cấu trúc WorkVolume; vẫn cập nhật tiến độ hiện trường qua room/floor-plan workflow.
- VIEWER: chỉ đọc.

Các defense đã có từ RC2.2.4 và được giữ nguyên:

- `WorkVolumeTab.tsx` dùng `canManageWorkVolumeStructure` để khóa UI cấu trúc.
- `App.tsx` dùng cùng helper để chặn handler tạo/sửa/xóa/import.
- `firestore.rules` chặn EDITOR ghi trực tiếp `work_volumes`.
- `scripts/firebase-rules-behavior.mjs` có regression cho ADMIN/EDITOR.
- `scripts/emulator-golden.mjs` fail nếu helper bị thiếu.

## Kết quả kiểm tra local

### PASS

- `npm run test:stability`: PASS toàn bộ Stability / Offline / Category / G1–G20 / Emulator static gate.
- Work-volume helper gate: PASS.
- `npm run lint`: PASS.
- Changed TypeScript syntax compile với TypeScript 5.8.3, `types: []`, `noCheck`: PASS.
- `package.json` + `package-lock.json`: giữ nguyên so với RC2.2.4 baseline.
- Firebase config / `.firebaserc` / `firebase.json`: giữ nguyên.
- `.github/workflows`: giữ nguyên.
- Không thêm secret nhạy cảm.

### Chưa thể xác nhận local do dependency install bị giới hạn mạng

- `npm ci --ignore-scripts --no-audit --no-fund`: bị container timeout trước khi cài đủ dependencies.
- `npm run typecheck`: không thể chạy full vì partial `node_modules` thiếu nhiều `@types/*`.
- `npm run build`: `vite: not found` vì dependency install chưa hoàn tất.

Các gate trên phải được GitHub Actions chạy lại sau khi commit `src/utils/securityUtils.ts`; Build #80 đã chứng minh `npm ci` trên GitHub hoạt động bình thường.

## File thay đổi trong RC2.2.4.1

1. `src/utils/securityUtils.ts`
2. `HNL-QLTC-V6.3.0-RC2.2.4.1-WORKVOLUME-HELPER-SYNC-REPORT.md`

## Quy trình tiếp theo

Trên branch hiện tại `rc2-2-emulator-dev-golden`:

1. Chép PATCH RC2.2.4.1 vào repo.
2. Lần này bắt buộc tick `src/utils/securityUtils.ts` + report RC2.2.4.1.
3. Commit: `V6.3.0 RC2.2.4.1 – Sync WorkVolume Permission Helper`.
4. Push origin.
5. Chưa Merge PR #4.
6. Chạy lại GitHub Actions và yêu cầu Stability → TypeScript → Rules → Security → Build đều xanh.
7. Sau đó restart Emulator và test lại EDITOR/VIEWER Runtime Golden.
