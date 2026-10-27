# HNL QLTC — P19: DEV-only trusted equipment unit-label rename

**Status:** Local DEV candidate / NOT CERTIFIED / NOT READY FOR PROD.
**Foundation:** P18 FULL SOURCE SHA256 `fcfc10bb159d54cb340a97507aa819c9e5ac40249ca9138d146060915d1cd8d5`.

## Root cause
When `VITE_WAREHOUSE_TRUSTED_WRITER=true` on DEV, client-side Firestore writes to `inventory_balances` are being retired. Previously the equipment unit migration had no trusted server equivalent and was intentionally blocked. Migrating through the legacy client transaction would break once direct writes are denied in Rules.

## Local patch
- `warehouse-trusted/equipment-unit-rename.mjs`: new isolated server-side Firestore transaction for an existing canonical equipment catalog row and its active, revisioned vouchers/balance. Read all before write; ADMIN role and verified email confirmed inside the transaction. Old balance remains a 0-stock tombstone (`renamedTo`); destination balance is new, preserving historical voucher IDs and quantities. The catalog, active vouchers and both stock records change atomically.
- `warehouse-trusted/equipment-unit-rename-golden.mjs`: fake transaction negative cases for role, stale revision, missing/dirty balance, deleted history, legacy/malformed records, alias key collisions and destination tombstones.
- `warehouse-trusted/index.mjs`: separate DEV-only callable `hnlWarehouseRenameEquipmentUnitDevV1`, with hard Firebase DEV project guard. Existing material callable is unchanged in behavior.
- `src/lib/warehouseTrustedClient.ts`: equipment-specific callable client, no fallback to direct writes.
- `src/lib/warehouseUnitMigration.ts`: trusted-mode equipment route to callable; legacy/trusted material route preserved; false flag means original production behavior retained.
- `warehouse-trusted/package.json`: new regression command.

## Conservative boundary
Only equipment with an active, revisioned canonical `equipment_catalog` row and fully consistent active vouchers and balance are supported. Historical deleted vouchers, missing catalog, missing balance, multiple/aliased stock identities, target balance tombstones, legacy vouchers without materialKey, oversize collections, negative stock or ambiguous names are rejected **before any write**. Unit *labels* change; no conversion of quantities. The root `.firebaserc` and deployed Rules remain unchanged.

## Tests and remaining blockers
- Pure engine golden **22/22 PASS** (simulated Firestore, **NOT** Emulator).
- Full warehouse regression, Room sidecar golden, source lint, stability gate PASS.
- PROD release P1 static gate still **BLOCKED 2**. `npm ci --offline` is ENOTCACHED, `vite` not installed, full `tsc` fails missing dependencies; no full build.
- No DEV Functions/Rules deployment or live data write, no multi-user/offline/reconnect tests, no backed-up restore rehearsal, no reconciliation of 27 PROD-only commits.
- Do **not** switch client trusted mode or deny all direct inventory writes until remaining room-auto writers, migrations and real Emulator gates are verified.

## Release sequence (requires explicit permission for cloud changes)
1. Check exact Git SHA and review PROD-only changes; retain performance and dependency fixes.
2. Run `npm ci` at repo root and `npm install --package-lock-only` in `warehouse-trusted`, commit lock when dependency registry is available.
3. Test with isolated DEV Auth/Firestore/Functions emulators: ADMIN/EDITOR/VIEWER, validation DENY, negative/positive stock, multiuser conflict, offline/reconnect.
4. Test a backup **copy** from DEV with old/new writers disabled at cutover and document rollback; test Web/Windows/Android.
5. Only after all evidence PASS, plan Rules/Functions coordinated DEV deployment and prepare PROD handoff. Never auto-push/merge/deploy PROD.
