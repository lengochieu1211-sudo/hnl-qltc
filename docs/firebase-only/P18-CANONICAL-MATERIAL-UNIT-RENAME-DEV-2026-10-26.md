# HNL QLTC P18 — trusted canonical material unit rename (DEV ONLY)

Source: P17 FULL SOURCE ZIP SHA256 `fa6a572134845d8af112c6608cfa844fa353450ac2d88e7b5381938ece40c65f`.

## Root cause
The existing client-side `renameWarehouseUnitAtomic` writes `material_norms`,
`inventory` and `inventory_balances` in one **client** Firestore transaction.
A post-cutover Rules policy that denies all balance/voucher writes will break this
workflow; keeping the old Rules preserves the independent-balance-write exploit.

## Scope / proposal
- New ADMIN-only DEV Callable `hnlWarehouseRenameMaterialUnitDevV1`.
- Canonical `materialId` + explicit norm-row IDs only. All project membership,
  norms, vouchers and derived balances are read from server inside one transaction.
- Reject malformed aliases, mismatched names/units/revisions, deleted voucher
  history, orphan or mismatched derived balance, oversized project collections.
- Keep voucher IDs/material IDs, quantities, timestamps unrelated to rename,
  inventory balance document key and source provenance intact.
- A 1:1 label change **does not convert quantities**.
- `warehouse-trusted` is DEV-project guarded; client flag defaults OFF.
- Legacy/material alias and equipment (which also changes equipment catalog)
  remain blocked in trusted mode until separate server Golden coverage.
- No changes to active `firestore.rules`, PROD Firebase, GitHub or domain.

## Validation scope
Run `node warehouse-trusted/unit-rename-golden.mjs` for simulation,
`node scripts/source-lint.mjs`, `node scripts/stability-gate.mjs`.
These tests do **not** substitute for Firebase Auth/Firestore/Functions Emulator,
client TypeScript Build, offline/reconnect, concurrent writers, multi-user role,
Web/Windows/Android Golden or copied DEV migration/backup restore.

## PROD blocker
The legacy P1 Rules are still vulnerable on deployed clients; the post-cutover
Rules candidate cannot be enabled until all writers, including genuine
room-auto voucher issue and equipment unit rename, are verified against DEV.
Never claim CERTIFIED, push/merge or deploy from this local-only change.
