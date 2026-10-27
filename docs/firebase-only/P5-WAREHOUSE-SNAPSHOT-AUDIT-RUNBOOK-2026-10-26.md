# HNL QLTC – P5: đối chiếu số dư kho từ snapshot DEV (26/10/2026)

**Trạng thái: tooling read-only / P1 Firestore Rules vẫn BLOCKED / không CERTIFIED.**

## Vì sao cần bước này

Các quy tắc Firestore đang cho phép EDITOR tạo/sửa `inventory_balances` mà không có bằng chứng chứng từ cùng giao dịch, nên chưa thể tin số dư hiện tại là đúng. Tuy nhiên sửa Rules hoặc chuyển quyền ghi kho ngay có thể làm hỏng nghiệp vụ nhập/xuất/sửa/khôi phục và lịch sử legacy. Trước khi thay giao thức Cloud phải có một bộ kiểm tra sổ phiếu đối chiếu với số dư đã lưu.

## Công cụ P5 (không ghi Cloud)

- `scripts/warehouse-balance-snapshot-audit.mjs`: chỉ đọc **hai JSON nội bộ**, dùng `getWarehouseMaterialKey`, `getWarehouseSignedDelta` và `isActiveWarehouseLedgerItem` của source gốc. Không chứa Firebase SDK/admin credentials, không gọi network, không ghi file, không đổi dữ liệu hay schema.
- `scripts/warehouse-balance-snapshot-audit-golden.mjs`: kiểm thử fixtures giả lập (không chứa dữ liệu khách hàng), các lỗi ngược chiều, legacy, xóa mềm, mã vật tư, thời điểm và CLI exit code.

**Đầu vào phải là snapshot cùng một thời điểm của đúng một project** (projectId). Hai JSON phải là dữ liệu đầy đủ của lần xuất snapshot DEV, không phải danh sách lấy theo bộ lọc hoặc dữ liệu cache của các thiết bị. `inventory.json` và `inventory_balances.json` có thể là mảng bản ghi hoặc object map `{ documentId: documentData }`, trường `id` giữ nguyên ID Firestore. Firestore Admin export nhị phân không đọc trực tiếp; cần xuất thành hai JSON đúng cấu trúc bằng công cụ kiểm toán có quyền, trong môi trường được phê duyệt. **Không tự tải dữ liệu PROD, không chuyển data riêng tư lên chat công khai.**

Chạy ở bản sao DEV cô lập, sử dụng Node 22.16+:

```bash
node --experimental-strip-types scripts/warehouse-balance-snapshot-audit-golden.mjs
node --experimental-strip-types scripts/warehouse-balance-snapshot-audit.mjs \
  --ledger /secure/dev-inventory.json --balances /secure/dev-inventory_balances.json
```

Mã thoát `0`: **không phát hiện chênh lệch trên dữ liệu đầu vào** (không phải CERTIFIED). `2`: dữ liệu có lỗi, không được release. `1`: đầu vào không hợp lệ. Chỉ xuất JSON về STDOUT; người kiểm toán chủ động lưu lại log vào `03_AUDIT_REPORT`, có thể che khóa/tên nếu log cần chia sẻ. Không đính kèm bản dump Firestore đầy đủ vào báo cáo công khai.

## Kiểm tra có/không

- Block: phiếu trùng ID, ID thiếu, sai type/quantity, sổ kho tổng âm, balance âm/sai số/không hữu hạn, missing balance, balance dương thiếu ledger, dữ liệu nhiều project trong cùng snapshot.
- Cảnh báo: balance zero không còn phiếu active (có thể là tombstone/đã đổi đơn vị), dữ liệu snapshot rỗng.
- Phiếu xóa mềm không còn đóng góp vào tổng; kho vật tư có `materialId` dùng key `id-*`, legacy dùng `legacy-*`, equipment dùng `equipment-*` theo **source**, không tự quy đổi đơn vị.
- Tolerance `1e-6` để hạn chế sai số số thực, **không làm tròn số lượng gốc**.

## Giới hạn quan trọng

1. Không thể phát hiện trường hợp giả cả chứng từ lẫn số dư khớp nhau; muốn chứng nhận cần quy tắc quyền Cloud + audit trail đáng tin cậy.
2. Snapshot lệch thời điểm, thiếu trang/kết quả, hoặc bị lọc sẽ tạo kết luận sai. Phải xác nhận số lượng file đầu vào/manifest nguồn và cùng checkpoint trước khi tin kết quả.
3. Công cụ không tự đối chiếu R2, ảnh, Firestore Rules, permission, offline/reconnect, multi-user hay dữ liệu PROD.
4. Không được dùng công cụ để điều chỉnh `inventory_balances` tự động; nếu bất nhất, dừng, sao lưu và điều tra từng key/chứng từ trước.
5. Không tự xác nhận release chỉ vì exit code 0. `scripts/p1-release-safety-gate.mjs` **vẫn phải BLOCKED** cho đến khi giải pháp Rules+writer được kiểm chứng thực tế bằng Emulator.

## Bước kế tiếp thực tế

- Tại DEV runner có đủ npm/firebase-tools: chạy Rules negative probes và các ca ALLOW nghiệp vụ; backup DEV nhất quán, sau đó tạo snapshot JSON qua công cụ được duyệt và chạy auditor, xác minh số lượng xuất.
- Thiết kế/implement cùng lúc phương án trusted voucher transaction (balance getAfter proof / backend) và tách cấu trúc `rooms.subItems` khỏi tiến độ EDITOR. Không sửa trực tiếp PROD.
- Tiếp tục `npm ci`, TS/build/lint/rules/CI, Web/EXE/APK runtime, đa user/offline, rồi backup/checkpoint trước khi quyết định.
