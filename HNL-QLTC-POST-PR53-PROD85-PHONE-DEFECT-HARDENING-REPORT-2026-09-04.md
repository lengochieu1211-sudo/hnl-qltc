# HNL QLTC – PHONE INPUT + DEFECT LINKAGE HARDENING REPORT

Date: 2026-09-04  
Baseline: `HNL-QLTC-FULL-SOURCE-POST-PR53-PROD85-d1c93a9.zip`  
Baseline PROD commit: `d1c93a9feddaae99fa2f2524240c60e3c4969a09`  
Repository: `lengochieu1211-sudo/hnl-qltc`

## 1. Baseline integrity

- Used exactly the POST PR53 / PROD #85 FULL SOURCE from Drive handoff folder.
- Baseline ZIP SHA256 verified: `f3331b470fb2cc35a9bda8eda91cc3b461fc1a78dd245e8623ecf2f11d5f6508`.
- No rollback.
- Firebase project / Hosting / GitHub / R2 not changed.
- No GitHub push, merge, or PROD deployment performed.

## 2. Android phone editor root fix

Runtime symptom: tapping **Sửa số điện thoại / Thêm số điện thoại** on Android opens the soft keyboard and it immediately disappears.

Root cause hardened:

- `App.tsx` previously passed `projects={getProjectsList()}` directly into `SecurityModal`.
- Android soft-keyboard opening changes `VisualViewport`, which updates `isSoftKeyboardOpen` and re-renders `App`.
- `getProjectsList()` returned a new array identity on every render.
- `SecurityModal` initialization effect depended on the entire `projects` array, so keyboard-driven App renders could retrigger modal initialization / cloud refresh lifecycle while the phone input owned focus.

Fix:

- Added stable `securityModalProjects` with `React.useMemo()` in `App.tsx`.
- `SecurityModal` initialization now depends on primitive `firstProjectId` instead of `projects` array identity.
- Kept `ContactPhoneEditor` local input state; no destructive remount workaround added.
- Added source regression guards in `scripts/contact-core-golden.ts` so inline `projects={getProjectsList()}` and `[... projects]` dependency cannot be reintroduced unnoticed.

Runtime status: source root cause fixed; physical Android PROD runtime still requires the normal post-build Golden confirmation before marking VERIFIED.

## 3. Defect -> roomId -> teamId hardening

Added `src/utils/defectLinkageUtils.ts` as the single linkage authority.

Behavior:

- Rectangle and polygon highlights share one point-in-room implementation.
- Creating a Defect now persists `roomId` from the actual pin geometry.
- Creating/updating assigned team persists `teamId` whenever the team is known.
- A valid existing per-Defect `teamId` wins over room default, preserving intentional manual assignment.
- If an old Defect only has stale `assignedTo` text, linkage can backfill from the room's durable `teamId` / assigned team.
- If a team is renamed, `assignedTo` display text is refreshed from durable `teamId` without losing the link.
- Legacy/stale Defects on the active floor are idempotently reconciled through `onUpdateDefect` only when a mismatch exists.
- Realtime loading protection: empty room/team collections do not erase already-persisted `roomId` / `teamId` while hydration is incomplete.

Added `scripts/defect-linkage-golden.ts` covering:

- rectangular highlight -> roomId;
- polygon highlight -> roomId;
- legacy room/team backfill;
- team rename while keeping teamId;
- explicit per-Defect teamId precedence;
- manual team selection while keeping roomId;
- protection against ID loss during empty realtime hydration.

## 4. Changed files

1. `src/App.tsx`
2. `src/components/SecurityModal.tsx`
3. `src/components/FloorPlanDefectTab.tsx`
4. `src/utils/defectLinkageUtils.ts` (new)
5. `scripts/contact-core-golden.ts`
6. `scripts/defect-linkage-golden.ts` (new)
7. `package.json` (adds Defect Linkage Golden to stability gate)

`package-lock.json` was not modified because no dependency/version changed.

## 5. Verification results

### PASS

- Baseline ZIP SHA256 verified.
- `npm run lint` / source-lint PASS:
  - package/lock version consistent (`6.3.0`);
  - no merge markers;
  - no private keys / GitHub tokens / Cloudflare R2 credentials;
  - Firebase-only role/cache guards present;
  - PROD deploy manual confirmation gate present.
- `src/types.ts + src/utils/defectLinkageUtils.ts` TypeScript isolated compile PASS using global TypeScript.
- `firebase.json` SHA256 unchanged vs baseline.
- `firebase.prod.json` SHA256 unchanged vs baseline.
- `.github/workflows` byte-for-byte unchanged vs baseline.
- `package-lock.json` byte-for-byte unchanged vs baseline.

### BLOCKED BY CURRENT EXECUTION ENVIRONMENT

A clean `npm ci` could not complete because npm registry DNS/network requests repeatedly returned `EAI_AGAIN`. As a result, the local dependency tree remained incomplete and these full gates could not be truthfully certified in this chat runtime:

- full `npm run typecheck`;
- full `npm run test:stability`;
- Firebase Rules emulator/runtime gate;
- `npm run security:audit`;
- full Vite/server `npm run build`;
- Windows EXE build;
- Android APK build.

The first full TypeScript attempt failed only because the interrupted install left the entire `@types/*` tree missing; it did not produce a source-level type error from the edited files.

## 6. Required next release gate before merge/deploy

Run in GitHub Actions / normal build machine with working npm registry:

`npm ci -> npm run test:stability -> npm run typecheck -> npm run lint -> npm run test:rules -> npm run security:audit -> npm run build -> Windows EXE -> Android APK`

Then perform Android runtime Golden specifically:

1. Open `Cài đặt/Bảo mật -> Thành viên`.
2. Tap `Thêm số điện thoại` or `Sửa số điện thoại`.
3. Confirm keyboard remains open while typing continuously for at least several edits/backspaces.
4. Save; close/reopen SecurityModal; confirm number persists.
5. Repeat in Chrome/PWA and APK wrapper.
6. Create Defect inside a rectangular and polygon highlight; verify persisted `roomId` and correct `teamId`.
7. Rename room/team and confirm Defect still resolves to the same IDs and updated display names.

Do not deploy PROD until these runtime gates are green.

## 7. Continuation gate run – 2026-09-04

After the first handoff package was produced, the same FULL SOURCE was re-opened and the remaining source-level gates that do not require a complete npm dependency tree were executed again.

### Additional PASS results

- `npm run test:offline` – PASS.
- `npm run test:category` – PASS.
- `npm run test:firebase-only` – PASS (the script intentionally retains GE1/GE3 as REVIEW and GE2 as BLOCKED external/runtime items).
- `npm run test:migration-audit` – PASS.
- `npm run test:emulator-config` – PASS.
- `npm run test:rbac` – MASTER RBAC MATRIX PASS.
- `node scripts/stability-gate.mjs` – PASS.
- `node scripts/r2-gateway-golden.mjs` – PASS.
- `node scripts/desktop-launcher-golden.mjs` – PASS.
- `node scripts/auth-popup-golden.mjs` – PASS.
- `npm run lint` – PASS again after the continuation audit.
- Defect Linkage Golden logic was executed with Node 22 native TypeScript type stripping in an isolated temporary copy (only import extensions/type-only import syntax adjusted in the temporary test copy; production source was not altered) – PASS.

### Dependency/environment status reconfirmed

- A fresh `npm ci` stalled on dependency retrieval in this runtime and was terminated.
- `npm ci --offline` then failed with `ENOTCACHED` for `yargs-parser-21.1.1.tgz`, confirming the local npm cache is incomplete.
- `npm run test:rules` also cannot complete here because `scripts/firebase-rules-check.mjs` invokes `npx firebase-tools@13.35.1`, which likewise needs registry/cache access.
- Therefore full dependency-backed `typecheck`, complete `test:stability`, Firebase Rules emulator behavior, `security:audit`, Vite/server build, Android APK build, and Windows EXE build remain **BLOCKED BY CURRENT EXECUTION ENVIRONMENT**, not marked PASS.

### Continuation conclusion

No new source defect was found during this continuation audit, so no additional application-code changes were made after the phone-input and Defect-linkage hardening. The next authoritative step remains CI/build-machine certification followed by physical Android/PWA runtime Golden before any merge or PROD deployment.
