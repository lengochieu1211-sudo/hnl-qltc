# HNL QLTC P12 — DEV-COPY MIGRATION / TRUSTED WAREHOUSE PRE-FLIGHT

**Candidate only. Not pushed, deployed or certified.** Builds on P11 ZIP without deleting existing files.

## Implemented in P12

1. Warehouse callable checks `email_verified` and authoritative canonical project membership inside its transaction. No arbitrary unsigned email may claim owner/superadmin/EDITOR access. Server-side balances reject numeric overflow, and new vouchers have bounded quantity.
2. `discard` voucher is now an ADMIN-authenticated server transaction with zero inventory-balance delta and idempotence; historical voucher tombstones and photos are retained.
3. Server ledger-to-balance reconcile is ADMIN-only, recalculates from full inventory query **inside one transaction**, rejects negative/invalid/oversized ledgers, invalid balance tombstones, and targets only a marked DEV_COPY sandbox. It is **not a generic production repair job** and rejects project inventories larger than 500 documents.
4. Explicit DEV copied-room migration uses the existing room as the only trusted source, validates all subitem IDs/properties, inspects *both full sidecar collections* (including orphans), atomically creates definition/progress sidecars and migration marker, preserving embedded legacy fields. It requires a DEV-copy-marked project and an explicit approval token. Do **NOT** set these markers manually in Firestore.
5. Separate **post-cutover Rules candidate** (`firestore.warehouse-cutover.dev.rules`), generated from the unchanged source `firestore.rules`, denies all direct client voucher and balance writes and disallows EDITOR embedded subItem changes. This will break old clients and unmigrated rooms, thus it is deliberately NOT active or deployed. Emulator config is **separate** (`firebase.warehouse-cutover.dev.json`).

## Security and safe cutover sequence (NOT PERFORMED)

- Preserve true project owner and Google auth identity; do not change Firebase projects or schema IDs.
- Back up Firestore + private R2 media with hashes; restore a DEV copy and explicitly mark it `migrationSandbox: true, migrationSource: 'DEV_COPY'` under a separate copy project document. These markers alone are not certification.
- Check snapshot parity; run P12 room migration only against DEV copy; repeat server read of definitions/progress and room; reject if stale/missing/orphan.
- Port/trial all remaining trusted writers, especially unit renaming, bulk/Excel, double-save/autosave, legacy receipts, admin structural room editing.
- Run emulator with post-cutover candidate Rules, including Auth role combinations; ensure old clients fail safely, upgraded clients still create/edit/delete/restore/rename vouchers without data regression. Test offline/reconnect and parallel users.
- Reconcile 27 PROD-only commits without overwriting PROD hotfixes, then run complete TS/lint/build/CI/Runtime Golden and backup restoration.
- Only after ALL gates succeed, present user a ready-for-PROD release candidate for explicit permission. Do not change current `firestore.rules` or `firebase.json` prematurely.

## Explicit blockers

- Source root still has P1-ROOM / P1-BALANCE vulnerabilities (P1 detector BLOCKED). New Rules candidate is not deployed and static assertions are not Emulator proofs.
- Root/function npm dependencies not fully installable in this offline runtime, so no trustworthy TypeScript/Vite/Functions build, callable Emulator, IAM tests or real storage/realtime validation.
- New DEV room migration cannot run on live/copied Firestore without verified credentials, copy and backup. No data changed.
- PROD-only 27 commits not yet semantically reconciled, and no physical Windows/Android Golden or R2/Firestore restore evidence.

**NOT READY FOR PROD. Do not enable `VITE_WAREHOUSE_TRUSTED_WRITER=true` on a project with active legacy/unsupported writers.**
