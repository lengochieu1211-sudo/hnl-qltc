# HNL QLTC P10 — migrated-room realtime/CAS DEV staging

Status: **LOCAL DEV CANDIDATE / NOT CERTIFIED / PROD BLOCKED**. Built strictly on P9 full-source SHA256 `2a58b29d3ec7a42cabb3dd6b4c07430269532f8bdad2fde105ff498b2fc41ae9`. No GitHub/Firebase/R2 changes.

## Actual code changes
- App derives migrated-room progress for display from a verified server-backed Firestore listener; it never writes sidecar progress back into the embedded legacy array as the authority.
- Listener rejects cache-only and pending snapshots, scoped by project and authenticated UID; parity failure leaves the room unverified and migrated writes disabled.
- Single-room form edits to existing migrated subItems are planned from the authoritative sidecar overlay, reject structural mutations, and commit the changed entries atomically through Firestore transaction with each subitem's expected revision. Server-side Rules are still the final authority.
- Legacy/unmigrated rooms use the prior editor form path unchanged. Bulk-save containing any migrated rooms fails closed pending a migration-aware ADMIN bulk operation; no silent partial bulk migration.
- No migration is performed. **Never set `subItemProgressMigrated:true` until definitions/progress have been seeded, matched, and tested on copied DEV data.**

## Known limitations and mandatory next work
1. An unverified migrated room can transiently display embedded legacy progress while connecting; edits are blocked but the UI needs an explicit per-room "đang xác minh" indicator before broad rollout.
2. The current one-listener-per-migrated-room model requires a scalable query plan or bounded viewport subscriptions before migrating large floor plans.
3. Single-room top-level updates occur AFTER the sidecar transaction, not atomically with it; provide server-side coordinated write or robust rollback for mixed top-level + subitem edits before certification.
4. ADMIN editing migrated subitem definitions, Excel/bulk updates and all alternative room writers must be routed and tested. Old unconverted rooms remain vulnerable to crafted EDITOR Firestore writes until P1-ROOM server guard is absolute.
5. P1-BALANCE is **not addressed** by this patch: the EDITOR can still forge independent `inventory_balances` writes. Trusted server voucher writer, client migration, and Rules DENY need implementation and emulator verification.
6. Tests must include Firebase Emulator positive/negative cases, multi-user, offline/reconnect, Web, Windows EXE, Android APK; run TypeScript/build/CI with complete npm dependencies.

No snapshot/credentials, FIREBASE live writes, deploy, push, merge, or irreversible data operation were performed. No production-ready claim.
