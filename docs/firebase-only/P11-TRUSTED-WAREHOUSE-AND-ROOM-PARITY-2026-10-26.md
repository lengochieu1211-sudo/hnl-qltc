# HNL QLTC P11 — DEV-only Trusted Warehouse Candidate and Room Seed Parity

**LOCAL SOURCE CANDIDATE / NOT CERTIFIED / PROD BLOCKED**. P10 is the exact source base. No Cloud/CI deployment, GitHub push/merge, R2 write, live Firestore mutation or migration executed.

## Actual P11 changes

1. `warehouse-trusted/engine.mjs`: server-only transaction implementation for create/update/softDelete/restore of inventory vouchers and their aggregate balances. Reads canonical email membership (UID fallback) and project state within the same transaction; ADMIN alone may delete/restore. Rejects forged system fields, invalid quantities/units, stale voucher revisions, reused tombstone IDs, negative stock and unknown voucher IDs. Server timestamp/revision updates are atomic with balance(s). Source ledger and R2 evidence remain untouched for delete/restore.
2. `warehouse-trusted/index.mjs` + `package.json`: Firebase callable function *candidate*. Runtime refuses non-DEV project. Firebase Authentication comes from callable context, not user body; Admin SDK is server-only. Function's dependency lockfile is not yet available — **this is an unfulfilled build gate**.
3. `firebase.warehouse.dev.json`: separate opt-in DEV Functions/Rules Emulator config; existing `firebase.json`, `.firebaserc`, Firebase project IDs and Hosting config are NOT modified.
4. `src/lib/warehouseTrustedClient.ts`: isolated Firebase callable client, default OFF unless `VITE_WAREHOUSE_TRUSTED_WRITER=true` in DEV. Refuses production project, never silently falls back to direct client writes after server failure.
5. `warehouseTransactions.ts`: create/update/delete/restore route to trusted callable only while opted in. `warehouseUnitMigration.ts`: rename intentionally blocked while trusted writer enabled because migration must be ported fully, not silently bypass server.
6. `scripts/room-sidecar-seed-parity.mjs`: offline, no-write parity audit of full legacy room snapshot vs ADMIN definitions/progress before any migrated marker. Refuses missing, forged, mismatched, extra, unversioned, prematurely migrated records.

## Mandatory gating before even enabling the DEV flag

- Complete trusted server handlers for ADMIN rename-unit (including norms, catalog, tombstones), reconciliation/repair, history trash discard and import/bulk behavior. Current opt-in intentionally blocks some of these; enabling prematurely would regress functionality.
- On copied DEV ledger, test all active/tombstoned vouchers against balances using the read-only snapshot audit; repair only after separate approval and server-authoritative procedure.
- Install/pin Functions dependencies with a valid **warehouse-trusted/package-lock.json** and verify `npm ci`, lint, typecheck, build, emulator startup & documented callable behavior.
- Migrate all voucher client paths; ensure no generic direct `inventory`/`inventory_balances` path remains writable after the cutover.
- Then and only then make Firestore Rules DENY all client CREATE/UPDATE/DELETE on aggregate balance and voucher paths, with emulator negative tests. Keep Admin service transaction writes operational via Admin SDK (Rules bypass by design).
- Room migration: test `scripts/room-sidecar-seed-parity.mjs` against anonymized, same-instant copied DEV exports; complete UI, scalable listeners, ADMIN structural writes, bulk/Excel and coordinated top-level+subitem commits. Do NOT mark rooms migrated before this.
- DEV Golden, Windows/Android physical runtime, offline/reconnect, multiuser, R2/Firestore backup + checksum restore and rollback rehearsal.
- Reconcile the 27 PROD-only commits; no merge/app deploy until explicit user authorization.

## Reproduction

- `node warehouse-trusted/engine-golden.mjs` — 18/18 simulated transactions, **NOT Firebase Emulator**.
- `node scripts/room-sidecar-seed-parity-golden.mjs` — 8/8 synthetic offline parity checks, **NOT real Firestore**.
- `node --experimental-strip-types scripts/room-sidecar-progress-golden.mjs`, `node --experimental-strip-types scripts/room-sidecar-progress-edit-golden.mjs`, `node scripts/room-subitem-migration-plan-golden.mjs`.
- `node scripts/p1-release-safety-gate.mjs` remains BLOCKED until full Rules/server migration. Never alter gate to mask failures.

## Security limits

- Do not activate `VITE_WAREHOUSE_TRUSTED_WRITER` on Web, EXE or APK yet; this opt-in code is an isolated prototype. Neither new function nor direct-write-denying Rules has been deployed to DEV. `inventory_balances` vulnerability remains until all phases complete.
- Do not infer that `18/18` simulated tests imply live atomicity or role verification. Only Firebase Emulator/DEV backend runtime can prove those.
- No Firebase project, R2 provider, GitHub repository, branch or production environment changed.
