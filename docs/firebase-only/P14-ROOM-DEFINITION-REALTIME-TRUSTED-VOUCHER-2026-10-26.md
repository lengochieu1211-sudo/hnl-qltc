# HNL QLTC — P14 DEV-only local candidate (26/10/2026)

Source basis: P13 FULL SOURCE, SHA256 `363cdb5270875890bad58d97b4732dc6055464beb23c7295acc5f28900f36c55`. Never use the older GitHub DEV branch to overwrite this candidate.

## Actual changes

1. **Room definitions are authoritative.** Listen separately to `subitem_definitions` and `subitem_progress`; display ADMIN-controlled name/category/work-volume/order from verified, ID-matched definition snapshot, and status from verified progress snapshot. Any incomplete, duplicate, foreign or malformed definitions fail parity. Embedded legacy room objects remain untouched.
2. **Concurrent edit protection.** For a migrated room, EDITOR's progress-save batch checks the last verified definition fields in the same Firestore transaction as progress revision/CAS. If ADMIN changed structural fields during an edit, the progress write is rejected instead of silently saving against stale structure.
3. **No forged automated warehouse vouchers.** Manual Firebase Callable now rejects `sourceType` values other than optional `manual`. Historical `room-auto` vouchers cannot be converted to manual vouchers via EDITOR's update. Only a future separately authorized, server-derived automation may create room-auto receipts.

## Risk and release gate

- This is a local source candidate; there is **no Cloud deployment** and no migration of real rooms.
- Legacy room embedded `subItems` edits and direct `inventory_balances` writes remain permitted by the active rules. Both P1 conditions still BLOCK PROD.
- Do not enable `VITE_WAREHOUSE_TRUSTED_WRITER` or switch to cutover rules until **all** client autosave, room-auto, batch import, unit rename, trash and catalog flows use a trusted transaction service and have true Firebase Emulator + multi-user evidence.
- Full npm install, TypeScript, Build, Firebase Emulator, CI on exact candidate, Web/Windows/Android Golden, Firestore/R2 backups and restore/reconciliation of 27 PROD-only commits all remain mandatory.
- Do not merge, push, deploy or alter data without explicit permission.
