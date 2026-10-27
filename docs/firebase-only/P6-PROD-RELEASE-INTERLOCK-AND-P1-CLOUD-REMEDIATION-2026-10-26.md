# HNL QLTC – P6: Khóa an toàn phát hành và thiết kế sửa P1 (26/10/2026)

**Môi trường:** chỉ thay đổi local candidate dựa trên P5; DEV GitHub `d6effaf03a08a9879fa172a345992922916036d2`. **Không triển khai DEV/PROD, không sửa dữ liệu thật.**

## 1. Vì sao P6 KHÔNG chỉnh `firestore.rules` trực tiếp

- `rooms.subItems` là một **list các map** trộn trường cấu trúc (ID/name/category/workVolume/volumeUnit/weight) và trường vận hành (status/inspectionStatus/targetDate/team). Firestore Rules hiện chỉ kiểm `affectedKeys()` ở top-level, nên người dùng có thể gửi lại toàn bộ list với cấu trúc khác dù được phép sửa tiến độ. Không thể khẳng định bảo vệ đầy đủ list dài tùy ý chỉ bằng kiểm tra một vài phần tử/index cố định. Chặn `subItems` ngay hôm nay sẽ làm hỏng tác vụ EDITOR đang lưu tiến độ.
- `inventory_balances` là dữ liệu tổng hợp. `warehouseTransactions.ts` ghi voucher ở `inventory` cùng balance bằng `runTransaction`, nhưng Rules vẫn cho EDITOR độc lập tạo/cập nhật balance không có bằng chứng ledger. Chặn collection sẽ từ chối cả giao dịch tạo/sửa/xóa/khôi phục và đường repair/legacy. Một `lastVoucherId` tự do do client khai không đủ vì voucher có thể bị chỉnh/cancel/di chuyển mã vật tư.
- P4/P5 đã có kiểm tra phát hiện, nhưng workflow phát hành PROD trước P6 **không chạy** chúng, trong khi workflow triển khai R2/AI Worker và Rules trước Hosting. Một release vô tình có thể thay Cloud dù phát hiện P1 vẫn đỏ ở báo cáo.

## 2. Bản vá P6: khóa triển khai có thể chứng minh bằng code cục bộ

- `.github/workflows/firebase-hosting-merge.yml` chạy `node scripts/p1-release-safety-gate.mjs` ngay sau checkout và setup-node, **trước `npm ci` và trước mọi deploy R2/AI/Firebase/Hosting**; script phải tồn tại và có exit code 0. Hiện Rules chưa sửa nên exit code 2, workflow fail sớm theo nguyên tắc fail-closed.
- Trong bước `npm run test:rules`, workflow gán `HNL_P1_RULES_NEGATIVE_PROBE: "1"` để emulator buộc phải DENY hai ca khai thác; suite hiện hữu vẫn phải ALLOW các tác vụ hợp lệ. Cả cổng tĩnh lẫn Emulator đều là điều kiện cần nhưng CHƯA đủ để CERTIFIED.
- `scripts/prod-p1-release-interlock-golden.mjs` xác minh thứ tự checkout/setup/gate/npm/Emulator/deploy, tính tồn tại của SHA lock/main-only confirmation, và 5 trường hợp giả lập vô hiệu hóa cổng.
- Không sửa `firestore.rules`, `storage.rules`, package, khóa dữ liệu hay bất kỳ writer nào. Không thêm project, collection, ID; không chạy Cloud.

## 3. Thiết kế triển khai sửa P1 trong một candidate tương lai – phải đi qua DEV

### A. EDITOR cập nhật tiến độ theo subItem

1. Thiết kế `projects/{projectId}/rooms/{roomId}/subitem_progress/{subItemId}` (ví dụ cấu trúc, chưa tạo/deploy). ID giữ từ `rooms.subItems[*].id`. ADMIN quản lý danh sách hạng mục/khối lượng bất biến ở `rooms`.
2. Rules tại collection tiến độ: chỉ EDITOR/ADMIN hiện hành và đúng project; `roomId` đang tồn tại, `subItemId` thuộc phòng, chỉ cho phép các trường nghiệp vụ `status`, `inspectionStatus`, `targetDate`, `assignedTeam`, `teamId`; khóa ownership, ID, revision, lifecycle. Không lộ thông tin tài chính. Phải đánh giá giới hạn Rules kiểm danh sách ID tùy dài; phương án an toàn là ADMIN materialize các document identity riêng để Rules `exists()` chứng minh membership theo path chứ không duyệt list.
3. Đọc bản cũ tương thích trước cutover, sau đó làm overlay (chồng tiến độ) trên Web/EXE/APK, cache offline/reconnect; có dedupe và epoch/revision để ADMIN cấu trúc mới không tái hiện tiến độ hạng mục đã xóa. Không tự động xóa trường cũ và không đổi ID khi import/backup.
4. Sau khi đủ bản ghi nền và parity/checksum, cấm EDITOR sửa `rooms.subItems` ở Rules; ADMIN vẫn được phép sửa cấu trúc. Kiểm tra khi 2 thiết bị EDITOR cùng sửa hai subItem khác nhau, conflict cùng subItem, offline stale, revoke quyền, thiếu room/subitem, legacy backup.

### B. Số dư kho và chứng từ

1. Quy định một **trusted writer**: mỗi thay đổi voucher ↔ balance phải có một giao thức bất biến do backend đáng tin hoặc có phép chứng minh `getAfter` thật sự gắn vào transaction. Luồng phải hỗ trợ create/edit/cancel/restore, một hoặc hai khóa vật tư, di chuyển `materialKey`, legacy restore, atomic retry. Không thừa nhận một field voucher ID tự khai là chứng cứ đầy đủ.
2. Chụp **snapshot cùng mốc thời gian** của `inventory`/`inventory_balances` DEV, chạy `scripts/warehouse-balance-snapshot-audit.mjs`, đối soát hết chênh lệch; tuyệt đối không tự sửa/ghi đè JSON thật. Kiểm tra thêm R2 media references của voucher, bảo toàn deleted tombstones.
3. Emulate transaction 2 người đồng thời, idempotency cho voucherId, OUT không âm, duplicate ID, sửa vật tư qua 2 keys, restore OUT sau khi stock đã đổi, long-pending offline queue, revoked EDITOR. Rules phải DENY tạo/cập nhật `inventory_balances` lẻ cả khi metadata hợp lệ; ALLOW writer hợp pháp sau migration.
4. Trước PROD: backup Firestore/R2 phục hồi được, nghiệm thu runtime DEV Web/Windows/Android và multi-user/offline/reconnect, CI Typecheck/Build/Rules/Regression PASS, reconciliation PROD-only 27 commits và phương án rollback (R2/AI/Rules/Hosting chứ không chỉ Hosting).

## 4. Trạng thái và cách kiểm tra

```sh
node scripts/prod-p1-release-interlock-golden.mjs  # PASS: workflow được khóa
node scripts/p1-release-safety-gate.mjs            # EXPECT exit 2: P1 còn tồn tại
HNL_P1_RULES_NEGATIVE_PROBE=1 npm run test:rules   # PHẢI chạy trên Emulator sau khi có deps
```

**Không được hiểu `P6 interlock PASS` là `Firestore Rules PASS` hoặc `PROD READY`.** Không cho triển khai trong giai đoạn này.
