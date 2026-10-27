# HNL QLTC P9 — Room subitem migration / server Rules boundary

STATUS: **LOCAL DEV CANDIDATE, NOT CERTIFIED, DO NOT DEPLOY / DO NOT FLIP MARKERS**.

## Root cause and architecture

`projects/{projectId}/rooms/{roomId}.subItems` currently mixes ADMIN-owned definitions (identity, name, quantity, category, order) and EDITOR-owned progress (status, inspection, target date, team). Firestore Rules cannot safely inspect arbitrary nested array entries with an unbounded loop. `App.tsx` P3 only protects trusted UI, not Firestore API clients. Existing `inventory_balances` has a separate P1 voucher-provenance hole; P9 DOES NOT solve it.

P9 adds a sidecar model for migration of ONE room at a time after DEV parity:

- `rooms/{roomId}/subitem_definitions/{subId}`: ADMIN may create/update/delete, members read. EDITOR cannot alter structural records.
- `rooms/{roomId}/subitem_progress/{subId}`: ADMIN pre-seeds; EDITOR can update only an existing record when its room is marked `subItemProgressMigrated:true` and definition exists. Immutable id, projectId and roomId; strict whitelist for status, inspection, targetDate, team; server monotonic revision + `updatedAt`; updater UID equals Firebase Auth UID. EDITOR cannot create/delete or change metadata.
- Once marked migrated by ADMIN, room's embedded `subItems` is immutable for EDITOR (top-level field progress remains writable). For all unmarked legacy rooms, existing behavior stays unchanged to avoid downtime. These LEGACY rooms REMAIN VULNERABLE until the entire migration is performed and legacy path is closed.

New pure `overlayMigratedRoomSubItems` refuses missing/duplicate/cross-project sidecar entries and preserves ADMIN-owned room structures; no legacy-progress fallback is allowed on migrated rooms. New `updateMigratedRoomSubItemProgressAtomic` reads room+definition+progress in a Firestore transaction and refuses missing markers, auth switch, revision mismatch or invalid write keys. It deliberately blocks offline writes until a durable conflict-aware queue is implemented; no UI uses it yet.

## Required safe enablement sequence; not executed in P9

1. On DEV only, collect fresh server snapshots of ALL affected rooms, definitions, progress and relevant backups (do not upload private data to chat).
2. Run P8 `room-subitem-migration-plan.mjs` on copies; resolve any unknown custom fields/invalid records first; never discard unknown fields.
3. Add read/subscribe/merge and save routing in Web/Windows/Android APP for migrated rooms; keep legacy handling for unmarked rooms. Regression test return/refresh/offline/reconnect/multi-user. **This integration has not been completed by P9.**
4. In DEV emulator, run normal Rules suite and `HNL_P9_SIDECAR_EMULATOR=1` opt-in suite; negative P1 tests remain REQUIRED. No marker yet.
5. Backfill definitions + progress for ONE test room by verified ADMIN with transaction/batch and checksum. Re-read fresh server snapshot and verify definition/progress parity. Only then mark `subItemProgressMigrated=true`. Test stale old client WRITE deny and new client sidecar operation ALLOW (including EDITOR) with 2 devices.
6. Expand DEV rollout in batches, preserve room/subitem IDs, deleted tombstones, photos and legacy backup. If any mismatch, stop; never auto-revert progress from stale embedded snapshot.
7. Only after every room has migrated and all clients/writers switched, update Rules to deny EDITOR `subItems` changes for **all** rooms and change P1 safety gate to require an absolute guard. Run full Emulator/CI and physical Golden.

## Required separate warehouse path

Trusted server warehouse writer is still required. It must Auth/role-check, enforce voucher idempotency and voucher↔balance atomicity including edit/soft-delete/restore/materialKey changes, and then deny independent balance/voucher writes by clients. P9 did not add this service or alter warehouse Rules because doing so without DEV emulator+real ledger parity risks corrupting stock.

## Test/rollback boundary

No new schema is written or activated by P9. No Firebase/Cloudflare deployments, GitHub pushes, merges or PROD edits. P1 safety detector deliberately remains **BLOCKED (2)**. `HNL_P9_SIDECAR_EMULATOR` test fixtures are authored but NOT proven without Firebase emulator and npm dependencies. Do NOT certify solely based on pure tests or static analysis. A revert should restore the previous Rules and disable marker only following a verified progress snapshot and backwards parity; flipping a marker off without restoring legacy embedded progress loses latest sidecar status.
