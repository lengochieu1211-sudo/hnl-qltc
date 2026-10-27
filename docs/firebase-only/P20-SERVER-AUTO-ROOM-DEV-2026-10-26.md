# HNL QLTC — P20 / DEV canonical room auto-issue

**LOCAL DEV CANDIDATE — NOT CERTIFIED; PROD NO-GO.**

## What P20 changes
- Dedicated `hnlWarehouseRoomAutoIssueDevV1` callable available only for `hnl-qltc-dev` (or a demo emulator project), with verified Firebase Auth, project membership checks and a strictly restricted request containing project/room identity and the version/time shown to the user.
- Server derives materials, quantities, deterministic voucher IDs and stock deltas solely from Firestore snapshots inside one transaction. The client cannot choose an issue quantity or source classification.
- Canonical category/volume/norm/basis ID and unit requirements; rejects missing or ambiguous links, deleted deterministic IDs, stale room version, legacy aliases, stock-ledger mismatches, insufficient stock, ambiguous teams, duplicate norm-per-material or oversized catalogs, and aborts all writes before any partial issue.
- Supports a canonical room with multiple materials when each has one unambiguous norm (maximum 300 work catalog rows, 300 norms, 3000 vouchers; limited query reads). Historical manual room allocations reduce the amount still to issue; exact replays do not change stock.
- The Room editor calls only the authenticated Cloud Function in DEV trusted mode and does not call its old `onAddInventory` path. `projectId` is passed from the Floor Plan tab. The UI requires the persisted room to be saved, and its button no longer falsely marks its own form dirty.
- `WAREHOUSE_TRUSTED_WRITER_ENABLED=false` continues to use the old path unchanged (including the current PROD bundle). No changes to active Rules, Firebase config, Hosting, GitHub workflows, project IDs or R2.

## DEV-only deployment/testing sequence (NOT performed)
1. Complete all other inventory mutations and freeze verified migration scope on a COPIED DEV dataset, with Firestore/R2 backup and restore rehearsals.
2. Confirm npm dependencies and generate a verified backend lockfile for `warehouse-trusted`. Run `npm ci`, `npm run typecheck`, lint, full build, client and server tests.
3. Run Auth/Firestore/Functions Firebase Emulator **ALLOW and DENY** tests including ADMIN/EDITOR/VIEWER, offline/reconnect, race/replay and multi-device updates; verify every transaction is reflected in ledger, balance and UI.
4. Deploy only to Firebase DEV after separate explicit approval, run real-device Golden; reconcile PROD-only commits and prepare an audited release/rollback plan.
5. Keep PROD untouched until all gates independently PASS and release approval is granted.

## Limitations
- Incompatible legacy room/norm layouts intentionally fail closed and require migration/reconciliation. Do not claim universal auto-issue coverage.
- FakeDb test cases validate the algorithm only, not real Firestore transaction query semantics or Security Rules.
- Server reads up to 3000 vouchers for this bounded DEV prototype; performance and costs require profiling with real project sizes.
- No App Check enforcement on this DEV-only callable; enabling it for PROD would require a separate reviewed server hardening phase.
- Existing P1 blockers remain: Rules legacy `subItems` modification by EDITOR and client-direct `inventory_balances` writes.
