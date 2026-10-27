# HNL QLTC P17 — Atomic trusted warehouse import (DEV candidate)

Status: **LOCAL DEV CANDIDATE / NOT CERTIFIED / PROD NO-GO**.

## Fix

In P16, importing more than one warehouse voucher in trusted DEV mode was blocked because sequential Firestore client transactions could leave half the file imported. P17 introduces a new ADMIN-only callable `hnlWarehouseImportBatchDevV1` and `importWarehouseBatchAtomic` for up to **30 manual vouchers in one Firestore server transaction**. The client calls it from the existing import handler only when `VITE_WAREHOUSE_TRUSTED_WRITER=true` and the app identifies DEV.

The server validates Auth's verified email, ADMIN project membership/ownership (both membership lookups inside the transaction), voucher schema and immutable ID, source provenance, per-row CAS revision, historic tombstones, canonical materialKey and units, final stock non-negativity and balance revision. Every read finishes before the first write. Firestore commits the complete set of voucher and balance changes, or aborts all changes. Same-content create/update retries cannot count stock twice. No optimistic local success is shown before the callable returns. No client fallback to legacy writes on error.

### Scope

- `warehouse-trusted/batch.mjs`: server transaction implementation.
- `warehouse-trusted/index.mjs`: DEV-only callable, Auth and request-size gates.
- `src/lib/warehouseTrustedClient.ts`: Firebase Callable client.
- `src/App.tsx`: import UI route through new Callable only in trusted DEV mode; legacy remains unchanged otherwise.
- `src/utils/warehouseTrustedCutoverSafety.ts`: preflight 30-item cap, duplicate IDs, manual origin and revision.
- `warehouse-trusted/batch-golden.mjs`: simulated atomicity tests.
- `scripts/warehouse-trusted-cutover-golden.mjs`: regression for changed user-visible preflight behavior.
- `warehouse-trusted/package.json`: include new test in server test suite.

## Not covered / release BLOCKERS

1. Does **not** convert room-generated vouchers (`room-auto`), warehouse unit rename, legacy import repair, physical-device runtime, or legacy Firestore Rules permissions. These remain blocked in trusted DEV mode, and **must not** silently fall back.
2. Firestore `firestore.rules` remains unchanged and still allows direct EDITOR balance writes. Do NOT activate the DEV cutover Rules candidate without Emulator tests and all callers migrated.
3. The test DB is a deterministic in-memory simulation, not Firebase Emulator. The callable is NOT deployed anywhere; no service IAM/App Check configuration validated.
4. No data copied from PROD, no live Firestore/R2 operation, no GitHub commit/merge/deploy.
5. Real npm install/typecheck/build, Firebase Emulator, Web/Windows/Android runtime, snapshot restore rehearsal, 27 PROD-only commit regression remain release requirements.

### Safe enablement prerequisites

Restore npm registry/dependency access, run `npm ci`, `npm run typecheck`, `npm run build`, then deploy/test server code and Rules only to authorized isolated DEV copy, with Auth/Rules Emulator ADMIN/EDITOR/VIEWER ALLOW/DENY and full 30-row rollback scenarios. Independently test room-auto, unit rename, offline/reconnect and restore before changing Rules/PROD. No automatic activation or PROD action is included.

### Isolated DEV Emulator configuration (prepared, NOT executed)

A new **separate** file `firebase.warehouse-trusted.dev-emulator.json` points to `warehouse-trusted` Functions source, the existing generated DEV cutover Firestore Rules candidate and local Auth/Firestore/Functions emulator ports. It has **no Hosting section**, does not modify `firebase.json`, `.firebaserc`, or PROD deploy actions. Static checker: `node scripts/p17-warehouse-emulator-config-golden.mjs`.

When npm/Firebase tools and Java are installed in an authorized DEV environment, generate the isolated candidate via `node scripts/p12-build-dev-cutover-rules.mjs`, run `npm --prefix warehouse-trusted ci` against its own lockfile if one is generated/verified, then run Firebase emulators with `--config firebase.warehouse-trusted.dev-emulator.json --project demo-hnl-qltc-dev --only auth,firestore,functions`. The project ID `demo-hnl-qltc-dev` is **emulator-only**. No deployment is performed or recommended by this source change. This does not bypass the need for real cross-account and data-parity tests.
