# HNL QLTC — DEV trusted warehouse manual-provenance hardening

## Exact foundation
P18 FULL SOURCE SHA256 `fcfc10bb159d54cb340a97507aa819c9e5ac40249ca9138d146060915d1cd8d5`.
Patch is local-only, opt-in DEV, and does not deploy or change Firebase configuration, Cloud Rules, GitHub, Hosting, R2 or root package/lock.

## Root cause
The candidate privileged callable previously enforced identity/role, voucher revision and atomic stock deltas, but took room/floor/norm/team/category provenance identifiers from the client at face value. Fake provenance could alter room/category issued-material reporting. A manual client could also send `sourceIssueKey` or the legacy `AUTO-XK-` deterministic ID/notes marker to impersonate an automatic room issue.

## Repair
`warehouse-trusted/manual-provenance.mjs` reads the referenced room, floor, norm, work volume and team INSIDE the SAME Firestore transaction as the voucher and stock update. It verifies source ID, same floor, material/norm identity, category scope, actual room team and optional explicit floor structure group. Forged, missing, ambiguous, deleted, non-canonical and inconsistent links fail-closed, without any write. The policy is enforced for both individual voucher writes and all rows of atomic imported voucher batches. Manual vouchers cannot claim server-reserved auto issue key, deterministic `AUTO-XK-` ID or the reserved Vietnamese automation notes marker.

## Compatibility limits
- Manual OUT vouchers without source references remain accepted as unallocated issues; reporting will not auto-allocate them to a room.
- Exact WorkVolume document ID is required for this strict DEV candidate; legacy aliases or differing canonical work-category ID schemes are rejected. Requires real DEV-data audit before activation; DO NOT deploy this to PROD without migration/reconciliation.
- Legacy rows with sourceIssueKey / old automation receipts cannot be rewritten by this **manual** callable; server automation must own them.
- This change does not implement room-auto issuance, equipment unit rename, multi-device UI runtime, or Rules rollout. It does not remove legacy P1 source-level blockers.
- Test suite uses FakeDb Firestore transaction simulation, NOT the Firebase Emulator. Emulator ALLOW/DENY, `npm ci`, TypeScript, build, Cloud CI, real DEV/Android/EXE runtime and backup+restore remain release gates.

## Validate (with dependencies available)
Run `npm --prefix warehouse-trusted test`; separately run `node scripts/source-lint.mjs`, `node scripts/stability-gate.mjs`, `node scripts/p1-release-safety-gate.mjs`. Deploy Functions and Rules to DEV only after authorization and verified full migration compatibility. Keep PROD unchanged.
