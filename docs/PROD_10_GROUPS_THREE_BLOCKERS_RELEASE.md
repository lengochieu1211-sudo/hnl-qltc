# HNL QLTC – 3 blockers / scoped PROD 10 groups (01/11/2026)

**Source:** GitHub DEV `7994251ca9fa9e09437ee0440ef09905463d7a39`; original PROD main `1c2b7d663d51d51aa45010e533d8e035e22adf59`. These patches are local worktree proposals, **not GitHub commits**. Do not relabel them as a live HEAD.

## 1. Cloud position lock
- Root cause: existing Firestore Rules verified roles/revision, but did not protect Room/Defect geometry after `positionLocked=true`.
- Patch: add server `positionLockUpdateIsSafe` to the generic core update path. Block legacy/admin/editor changes to room geometry (`floorId`, x/y/size/points/cadSource) or defect location (`floorId`, roomId, x/y/axisGrid/positionDetail) while locked. Lock/unlock must change only flag + lifecycle metadata, not geometry, and use correct role.
- Preserve existing inspections, status, notes, photos, IDs and legacy `undefined` lock fallback. No schema or data migration. Firebase Rules on PROD **not deployed**.
- Tests: new negative Emulator assertions plus positive operational updates; must run `npm run test:rules` in a configured runner before deployment. Test two real signed-in accounts and cached old clients.

## 2. Atomic Chat and old clients
- Root cause: DEV new chat client had `writeBatch` but omitted `lastMessageId`, which DEV strict `getAfter` Rules require. In contrast, PROD legacy clients do separate `setDoc` writes for message then summary.
- Patch: add `lastMessageId: messageId` to DEV atomic summary, keep existing durable account-scoped outbox logic, tests. New field is tolerated by existing PROD Rules, so phase one can deploy the new client against old PROD Rules without migrating data.
- **Never deploy DEV strict chat Rules to PROD in phase one.** Old Web, Windows EXE, Android APK versions may still send legacy split writes. Strict Rules would reject their message creates. To achieve strong server-side atomic guarantees after migration, prove all active clients upgraded (or enforce client upgrade via separate controlled release), then switch Rules on a separate guarded phase and run both positive and negative Emulator tests. Current compatibility window necessarily retains the pre-existing legacy unread-counter weakness; do not call it certified atomic across old clients.
- Tests: `node scripts/chat-release-bridge-golden.mjs` and `scripts/p2172-chat-atomic-summary-emulator.mjs`, `scripts/p2197-chat-message-only-security-emulator.mjs`, offline/reconnect and two-account physical Runtime Golden. Don't deploy stricter rules until those gates pass.

## 3. Real Runtime Golden
- Added `scripts/runtime-golden-evidence-gate.mjs`: fails closed without evidence for exact candidate SHA and 15 signed-in scenarios. Screenshots/log files must exist and match SHA256.
- Real device evidence remains to be collected from actual Windows 11 PC/Web/EXE, Android Chrome/APK, iPhone Safari/PWA, two verified accounts, offline/reconnect, Room/Defect lock, Chat, R2/11 legacy links, Excel/PDF/JSON, rollback Hosting version.
- Synthetic emulator/browser tests and CI do not qualify as physical proof. Do not claim Runtime Golden without signed-in device logs.

## Release gates
1. Verify GitHub `dev/main` exact HEAD again and retain current PROD Hosting version. Audit current Firestore Rules, no accidental R2/AI deployment.
2. Run `npm ci`, TypeScript, lint, full `test:rules`, Chat golden, PROD regression, production dependency audit and build on exact *candidate* HEAD; run actual Windows EXE/Android APK build and QA signed-in.
3. Recheck current PROD Firestore 5,014 historical docs and R2 429 historical objects; encrypted-archive roundtrip, 11 legacy media links, independent backup and rollback. Historical counts are **not** release-day snapshot proof.
4. Verify golden evidence using the new fail-closed gate. Only then prepare scoped release candidate from current `main`. Prefer UI/Excel first, lock/Rules separately, Chat strict Rules last.
5. Do not merge/push or deploy through generic `.github/workflows/firebase-hosting-merge.yml` for Hosting-only changes.

**STATUS: DEV PATCH CANDIDATE / PROD NO-GO until full CI, live-device golden and backup recovery PASS.**
