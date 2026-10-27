# HNL QLTC — P7 P1 Cloud trusted-writer design (NOT IMPLEMENTED)

**Bản nền:** local P6 FULL SOURCE; GitHub DEV exact HEAD `d6effaf03a08a9879fa172a345992922916036d2` (unmodified remotely).
**Đích:** không cho EDITOR ghi cấu trúc phòng / số dư kho trực tiếp, giữ tất cả ID, dữ liệu lịch sử và nghiệp vụ cập nhật hiện trường.
**Tình trạng:** DESIGN / BLOCKED. Không triển khai Rules mới, không backfill dữ liệu, không chạy Cloud Functions/Worker nào.

## Căn cứ kỹ thuật

- `firestore.rules::editorRoomOperationalUpdateOnly()` cho phép mảng `subItems` thuộc top-level affected keys; Rules không kiểm tra nested ID/khối lượng. Mã P3 trong `App.tsx` là bảo vệ client, không chặn modified clients.
- `firestore.rules::match /inventory_balances/{balanceId}` cho EDITOR update riêng `onHand` với metadata, không cần voucher tương ứng. Warehouse writer trong `src/lib/warehouseTransactions.ts` dùng Firestore transaction, nhưng Rules hiện cho bypass; ledger writer cũng phải được kiểm soát để không cho khách hàng giả mạo phiếu.
- Firebase Rules không có vòng lặp kiểm tra arbitrary array; `getAfter()` kiểm tra trạng thái sau giao dịch và giới hạn document reads. Dồn tất cả kiểm chứng nghiệp vụ/phép tính lớn vào Rules không phù hợp, đặc biệt dữ liệu legacy, voucher edit hai material keys và restore.
- Tham khảo: https://firebase.google.com/docs/firestore/security/rules-conditions ; https://firebase.google.com/docs/firestore/security/rules-fields ; https://firebase.google.com/docs/firestore/manage-data/transactions .

## Thiết kế đề xuất A — Room subItem progress

1. Giữ **nguyên** `projects/{pid}/rooms/{roomId}` và mảng `subItems` làm cấu trúc/admin-owned. Không đổi UUID, tên, khối lượng, đơn vị, thứ tự, trạng thái đã ghi.
2. Backfill *read-only/dry-run* từ ADMIN-owned room array sang registry bất biến `room_subitem_definitions` (mỗi subItem key phải unique trong project, có roomId/subItemId và version), báo lỗi nếu duplicate/missing id, không xóa array gốc. Chạy migration trên DEV với backup snapshot, so count/checksum/ID.
3. Tiến độ EDITOR ghi riêng `room_subitem_progress` theo stable `roomId + subItemId`; Rules yêu cầu definition tồn tại, dự án đang active, EDITOR là member và chỉ cho thay trạng thái/inspection/team/due-date/updatedAt. Quyền định nghĩa/khối lượng: chỉ ADMIN. Dùng revision/conditional transaction để tránh ghi đè trên nhiều thiết bị.
4. Reader Web/Windows/Android overlay tiến độ lên mảng cấu trúc theo stable IDs, ưu tiên canonical progress khi hiện hữu, fallback mảng legacy nếu chưa migrate. Không được tự tạo subItem mới ở lớp overlay.
5. Sau khi tất cả client đã cập nhật + backfill parity + runtime Golden, bỏ `subItems` khỏi allowlist EDITOR trên `rooms` và yêu cầu stale clients hiển thị thông báo cập nhật. Không chuyển cutover khi vẫn còn client cũ đang chỉnh sửa/offline.
6. Ca bắt buộc: ADMIN thêm/xóa/reorder; EDITOR tiến độ 1/20/n item; can thiệp ID, category, weight, quantity, deleted, legacy item; expired members; offline edit/reconnect; concurrent editors; export Excel/PDF; notification/defect/crew.

## Thiết kế đề xuất B — Trusted warehouse atomic writer

1. Server endpoint có Firebase Auth ID token verification và kiểm tra membership canonical trên server (không tin UID/role do client gửi). Sử dụng Admin SDK/privileged IAM riêng, audit immutable operationId, projectId, UID, timestamp; không đưa service-account secret vào client hoặc ZIP.
2. Server Firestore transaction đọc original voucher + affected balances + required catalog; validate materialId/unit/quantity/deleted/trash/revision, compute delta bằng cùng quy tắc từ `warehouseLedgerMath.ts`; ghi voucher & balances nguyên tử. Idempotency theo operationId/voucherId; revision CAS + re-read để chống double submit. Không bao giờ ghi âm tồn.
3. Hỗ trợ tạo, sửa, chuyển material key, xóa mềm, khôi phục, repair legacy và void. Reconcile/bulk repair chỉ ADMIN và có audit snapshot; dữ liệu ảnh R2 giữ theo voucherId, không xóa/đổi path; `projectId` không đổi.
4. Reader vẫn đọc ledger/balances cũ; Writer client gọi endpoint mới với typed command. Chỉ sau DEV Golden và client rollout mới DENY các client write trực tiếp vào `inventory_balances` **và** voucher mutation nguy hiểm ở `inventory`. Legacy writer phải được phát hiện và chặn bằng thông báo yêu cầu cập nhật, không âm thầm retry lặp hoặc tạo duplicate.
5. Nghiệm thu: simulate concurrent IN/OUT, simultaneous same material, edit cross material, offline OUT rejected; delay/retry/reconnect; rollback; legacy without balance; quantity/unit mismatch; Editor/Viewer/admin revoked; multi-user. Cross-check every balance against authoritative ledger snapshot.

## Điều kiện chốt bảo mật thực tế

- ALLOW legitimate + DENY forged writes bằng Rules Emulator đối với original *và* revised Rules; tối thiểu 183 bài nền + 2 negative P1 + migrations & admin tests, không lấy static gate thay Emulator.
- `npm ci`, typecheck, lint, build, security audit và Actions CI PASS trên **exact DEV candidate HEAD**; native Web/EXE/Android Golden + offline/reconnect/multi-user PASS.
- DEV snapshot/read-only parity Firestore, inventory_balances, R2 photos; PROD predeploy backup/restore rehearsal (Firestore + R2 + Rules + Workers + Hosting), SHA256/checkpoint lưu Drive.
- Reconcile 27 commit riêng của PROD: không đè nguyên 11 file, giải quyết từng hunk, regression evidence trên ứng viên exact main SHA.
- Chỉ khi PASS mới đề xuất thay đổi Rules, triển khai theo giai đoạn trên DEV trước; PROD cần người dùng chấp thuận riêng.

## P7 hiện thực trong source local

Chỉ sửa `.github/workflows/r2-worker-deploy.yml`, thêm `scripts/r2-prod-release-interlock-golden.mjs`, và tài liệu này. Không có migration/schema/code writer mới. Workflow R2 chỉ có khóa khi source được tích hợp sau phê duyệt; R2 PROD đang chạy không thay đổi.
