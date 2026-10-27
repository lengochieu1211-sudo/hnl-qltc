# HNL QLTC – Kế hoạch xử lý P1 Rules trên DEV (25/10/2026)

**Cấp độ: ĐỀ XUẤT / CHƯA TRIỂN KHAI / KHÔNG CERTIFIED.** Nguồn nền: P3 FULL SOURCE, GitHub DEV `d6effaf03a08a9879fa172a345992922916036d2`, PROD `57eea2b878e17da64d7a6191fda178eaff3b8488`, v6.3.0. Không đổi Firebase ID, R2, domain, GitHub, schema hoặc dữ liệu trong đợt điều tra này.

## Bằng chứng P1-ROOM
- `firestore.rules` `editorRoomOperationalUpdateOnly()` cho phép EDITOR cập nhật trường top-level `subItems` vì nó nằm trong `affectedKeys().hasOnly(...)`, nhưng **không kiểm tra danh sách ID/name/category/workVolume/geometry/order bên trong**.
- `src/App.tsx` đã có `mergeEditorRoomSubItems()` từ P3, đây là phòng vệ UI/client, không ràng buộc API/SDK độc lập.
- Nếu xóa `subItems` khỏi allowlist thì quy trình EDITOR cập nhật tiến độ từng hạng mục đang ghi vào mảng cũng sẽ bị từ chối. **Không triển khai giải pháp này trực tiếp lên DEV/PROD.**

**Đề xuất thiết kế cần chứng nhận DEV:** chuyển phần tiến độ EDITOR sang bản ghi nghiệp vụ riêng, cố định `roomId` + `subItemId`, phân quyền EDITOR chỉ trên các trường `status`, `inspectionStatus`, `targetDate`, `assignedTeam`, `teamId`; để ADMIN sở hữu `rooms.subItems` định nghĩa. Phải thiết kế migration giữ ID/legacy, dự phòng đồng bộ 2 chiều khi rollout, và cách đọc offline rõ ràng; sau khi hoàn thành cutover DEV thì mới cấm EDITOR viết `rooms.subItems` ở Rules. Không đổi schema chỉ bằng cách làm nhanh trong P4.

## Bằng chứng P1-BALANCE
- `inventory_balances` allow create/update cho EDITOR nếu metadata hợp lệ, `onHand>=0`, `revision` hợp lệ; không yêu cầu chứng từ liên quan được tạo/chỉnh trong cùng Firestore transaction.
- `src/lib/warehouseTransactions.ts` hiện dùng `runTransaction` cập nhật `inventory` + `inventory_balances` nguyên tử cho nghiệp vụ chuẩn. Tuy nhiên Firebase Rules không thể giả định mọi client đều dùng hàm này.
- Nếu cấm EDITOR viết `inventory_balances`, giao dịch nhập/xuất/chỉnh của kỹ sư trên Web/EXE/APK sẽ lỗi. **Không sửa Rules đơn lẻ.**

**Đề xuất thiết kế cần chứng nhận DEV:** giao thức ghi kho có tham chiếu chứng từ bất biến, nonce/revision & delta có thể kiểm chứng qua `getAfter()` trong Rules hoặc backend giao dịch đáng tin cậy. Kiểm soát cả create/edit/cancel/restore, change-material-key, migration đơn vị, legacy balance và tình huống nhiều chứng từ trong một transaction. Không dựa duy nhất vào `lastVoucherId` do client tự khai. Cần bảo đảm voucher+balance được xác nhận đồng thời, không chấp nhận ghi orphan và không cấp quyền rộng cho dữ liệu cũ.

## Test gate bắt buộc
1. Chạy `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, kiểm thử liên quan; không ghi PASS nếu thiếu package.
2. Dùng emulator project disposable `demo-hnl-qltc-rules`, tuyệt đối không trỏ PROD, chạy `HNL_P1_RULES_NEGATIVE_PROBE=1 npm run test:rules` cùng mặc định. Hiện 2 negative probes dự kiến sẽ phát hiện ALLOW nguy hiểm. Ca ALLOW chuẩn phải còn: EDITOR đổi status hạng mục và tạo chứng từ kho hợp lệ.
3. Bắt buộc test offline/reconnect, legacy, nhiều USER, 2 ADMIN, Web/Windows EXE/Android và đối chiếu tồn kho theo chứng từ; kiểm tra ảnh R2 và quyền VIEWER.
4. Backup DEV/PROD Firestore/R2/snapshots/ảnh trước migration, có số lượng/checksum/restore rehearsal. Không đụng PROD cho đến khi được duyệt và đạt gate.
5. Reconcile 27 PROD-only commits, đối chiếu 11 file trùng khác trước release; không copy đè nguyên tệp.

## Cách dùng P4 (chỉ chẩn đoán nguồn)
- `node scripts/p1-release-safety-gate.mjs`: hiện trả exit code `2` và báo hai BLOCKER, **đó là kết quả đúng của cổng fail-closed**, không phải Firebase Emulator.
- `node scripts/p1-release-safety-gate-golden.mjs`: PASS khi phát hiện đúng P1-ROOM, P1-BALANCE và chặn phát hành. Không được diễn giải PASS này thành Rules PASS.
- Các ca hành vi Firebase hiện ở `scripts/firebase-rules-behavior.mjs` với `HNL_P1_RULES_NEGATIVE_PROBE=1`. Chưa chạy thật vì thiếu Firebase dependencies/emulator trong môi trường cục bộ.

## Rủi ro còn mở
P1-ROOM; P1-BALANCE; hai ADMIN cùng sửa normId thiếu CAS server-side; Chat `messageCount` summary cập nhật tách message (có thể lệch unread); PROD/DEV diverged; R2/Cloud PROD backup & rollback chưa chứng nhận; Typecheck/Build/Runtime Golden chưa PASS. **Chỉ tiếp tục DEV, không Push/Merge/Deploy.**
