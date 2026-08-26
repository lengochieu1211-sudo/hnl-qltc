# P5 — Firebase Security Rules Report

## Firestore Rules source-level

- `SUPER_ADMIN`, owner, `ADMIN`, `EDITOR`, `VIEWER`; `ENGINEER` tạm compatibility.
- VIEWER không write core business data.
- EDITOR không manage membership.
- Owner/Admin quản lý membership với role allow-list.
- Core business record: soft-delete, no hard-delete, monotonic `revision/updatedAt`.
- Project root: no client hard-delete; ownership protected.
- Audit log append-only/identity-bound.
- Warehouse balance path protected by non-negative + revision monotonic.
- Legacy nested binary chunks: create/update denied, read + admin cleanup only.

## Storage Rules source-level

- Read yêu cầu project membership.
- Upload/update yêu cầu edit role.
- Metadata phải match path: `projectId/entityType/entityId/assetId/createdByUid`.
- MIME chỉ image/PDF; size cap thumbnail/original.
- Binary physical delete ADMIN-only.
- Default deny all unmatched paths.

## Trạng thái

- Static/source gate: **PASS**.
- Emulator behavior suite đã viết (`firebase-rules-behavior.mjs`).
- Runtime emulator execution trong môi trường hiện tại: **NOT VERIFIED / timeout tải firebase-tools**.
- App Check bootstrap có sẵn nhưng enforcement **REVIEW** cho tới khi DEV/PROD site keys + wrappers được test.
