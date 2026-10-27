# P8 — Room subItem migration dry-run and warehouse type guard

**Scope:** P7 FULL SOURCE SHA256 `3bb440e8120fac27c1edf53844a4d59a84a137bc1eea7e3f8e41c8103a5d9f32`. DEV GitHub HEAD `d6effaf03a08a9879fa172a345992922916036d2`. Local-only, NO writes to Firebase/GitHub/R2.

## Why these changes are necessary

1. `RoomSubItem` mixes ADMIN-owned structural fields (`id`, `name`, `category`, `workCategoryId`, `workVolume`, `volumeUnit`, `progressWeight`, list order) and EDITOR-owned operational fields (`status`, `inspectionStatus`, `targetDate`, `assignedTeam`, `teamId`). Current Rules permit replacing the complete array; P3 client-side merge is not authorization.
2. A cutover without verifying IDs, missing fields, deleted rooms, unknown extensions, project scope, or concurrent changes risks silently dropping existing data. **P8 is a strictly read-only migration planner; NOT a migration/executor.**
3. `getWarehouseSignedDelta()` previously treated any runtime `type` not equal to `in` as `out`; a corrupt legacy value could silently subtract stock. P8 fails closed on invalid voucher type. `in`/`out` semantics are unchanged.

## Offline-only preflight

From the P8 source root, using a previously authorized, same-instant DEV JSON snapshot that contains `rooms`, `roomProgressList`, `documents`, or `byRoomId`:

```bash
node scripts/room-subitem-migration-plan.mjs --project YOUR_DEV_PROJECT_UUID --input /private/dev-rooms.json
node scripts/room-subitem-migration-plan-golden.mjs
node --experimental-strip-types scripts/warehouse-invalid-voucher-type-golden.mjs
```

Default CLI prints only counts/error *positions* and SHA256 manifest digest, not room names/team names or payload. Exit codes: `0` = snapshot structure passed local preflight (**not PROD certification**); `2` = blocked due invalid/unsafe data; `1` = bad input. Optional `--output /private/dry-run-plan.json` writes the full proposed payload locally with `0600` permissions and refuses an existing file/partial invalid snapshot. **Never upload real snapshot or full migration payload into chat/Drive without explicit authorization and access review.**

Proposed nested paths use original `projectId`, `roomId`, and `subItemId` without changing IDs:
- `projects/{pid}/rooms/{roomId}/subitem_definitions/{subItemId}` — structural fields, ADMIN-only in eventual Rules.
- `projects/{pid}/rooms/{roomId}/subitem_progress/{subItemId}` — operational fields, EDITOR-allowed only after new Rules/membership/definition checks.

These paths are NOT currently activated by the app; current generic nested Rules deny create/update. P8 does not write to or enable these paths. `sourceManifest` room hashes/revision/timestamp must be revalidated against the server immediately before any later migration to avoid overwriting live edits. Legacy tombstoned rooms are skipped, never resurrected. Unknown subItem fields/duplicate IDs fail closed; manually resolve while preserving backups and R2 photo pointers.

## PROD blockers unchanged

- **P1-ROOM:** create verified definition/progress writer + reader overlay, Rules ALLOW/DENY, legacy fallbacks, offline/reconnect, full Web/EXE/Android before removing EDITOR `subItems` write access.
- **P1-BALANCE:** implement Firestore Admin SDK trusted atomic writer and authenticate/membership-check server-side. Validate both voucher and derived balance in same server transaction, idempotent operations and legacy restore/edit/move. DENY direct client stock/voucher mutation only after backfill/cutover; no Cloud server writer exists in P8.
- No npm dependencies/emulator available in this sandbox. `npm ci`, typecheck, bundle build, Rules Emulator golden, DEV data/R2 parity, multi-user native runtime and reconciliation of 27 PROD-only commits remain OPEN. Do not call CERTIFIED or deploy PROD.
