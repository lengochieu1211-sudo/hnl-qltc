# P4 — Firebase Storage / Legacy Drive Migration Report

## New runtime path — VERIFIED_SOURCE

`Client -> compress/resize -> Firebase Storage original/thumbnail -> Firestore metadata -> realtime device B`

- Photo new writes use Firebase Storage.
- Floor-plan new writes use Firebase Storage.
- Firestore chỉ giữ metadata/path, không Base64/chunks mới.
- List view có thumbnail path; binary được tải lazy.
- Storage path ràng buộc `projectId/entityType/entityId/assetId`.
- Legacy Drive write bị OFF mặc định.

## Legacy Drive — BLOCKED

Drive/Apps Script read fallback phải giữ cho tới khi production migration hoàn tất:

`Inventory -> Export mapping -> Copy -> checksum/count -> Firestore reference verify -> multi-device Golden -> cutover -> disable Drive read -> retirement window`

Không được xóa file Drive hoặc Apps Script trước bước parity 100%.

## Chưa VERIFIED

- Tổng số file Drive production.
- Checksum toàn bộ binary.
- Orphan Drive files.
- Parity photo/floorplan Firestore references.
- Retention/purge Storage production.
