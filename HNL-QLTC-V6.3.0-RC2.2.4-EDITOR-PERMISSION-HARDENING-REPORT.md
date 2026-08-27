# HNL QLTC V6.3.0 RC2.2.4 – Editor Permission Hardening

## Baseline
- Exact baseline: `HNL-QLTC-V6.3.0-RC2.2.3-FULL-SOURCE.zip`
- Firebase PROD remains: `com-example-qlct-61329`
- No GitHub push and no Firebase deploy performed.

## Runtime blocker reproduced
During Emulator Golden, `editor@hnl.test` correctly resolved to EDITOR but the Work Volume screen still exposed structural controls:
- `+ Thêm`
- `Nhập lại từ Excel`
- `Sửa thông tin`
- delete icon / bulk-delete selection

This violated the intended role model. EDITOR should update site progress, defects, manpower, photos and room/floor-plan progress, but must not redefine or delete the project Work Volume master structure.

## Root-cause fix
### 1. Explicit Work Volume structure permission
`src/utils/securityUtils.ts`
- Added `canManageWorkVolumeStructure(role)`.
- Only `ADMIN` returns true.
- This is intentionally separate from generic `canEditProjectData`, because EDITOR may edit field records but not master Work Volume definitions.

### 2. Work Volume UI hardened
`src/components/WorkVolumeTab.tsx`
- `+ Thêm`: ADMIN-only.
- `Nhập lại từ Excel`: ADMIN-only.
- `Sửa thông tin`: ADMIN-only.
- single delete + bulk delete: ADMIN-only.
- selection checkboxes used for bulk structural deletion: ADMIN-only.
- non-ADMIN Excel export remains available but uses the existing financial redaction flag and is relabeled `Tải Excel`.
- add/edit/delete modals are rendered only while ADMIN.
- switching account/role without remounting now immediately clears selected items and closes any ADMIN-only Work Volume modal, fixing the stale Admin form seen after switching to Viewer/Editor.

### 3. App handler defense-in-depth
`src/App.tsx`
- Added ADMIN guards to add/save/delete/delete-multiple Work Volume handlers.
- Direct `actual` mutation handler is also ADMIN-only; normal EDITOR progress is field-driven through room/floor-plan workflows.
- Warehouse multi-sheet path that can carry Work Volume definitions now refuses to replace Work Volume structure unless role is ADMIN.

### 4. Firestore Rules enforcement
`firestore.rules`
- `work_volumes` create/update is now ADMIN-only.
- Other core business collections keep EDITOR/ADMIN edit permission and lifecycle/revision guards.
- This prevents bypassing the UI with direct Firestore writes.
- Physical core-record delete remains forbidden as before.

### 5. Rules behavior regression tests
`scripts/firebase-rules-behavior.mjs`
Added runtime cases:
- ADMIN can create Work Volume master definition.
- EDITOR can read Work Volume master definition.
- EDITOR cannot create Work Volume master definition.
- EDITOR cannot rename/change Work Volume structure.
- EDITOR cannot directly write Work Volume `actual`.
- EDITOR can still create/update room field-progress data that the app uses to derive Work Volume actual/status.

### 6. Golden static gate
`scripts/emulator-golden.mjs`
- Added source guards for UI/App/Rules separation.
- Prevents regression back to generic `canEditProjectData` for Work Volume master controls.

### 7. Runtime banner
- `scripts/emulator-dev.mjs`
- `START_HNL_QLTC_DEV_EMULATOR.cmd`
Updated visible test banner to `RC2.2.4` so runtime screenshots are unambiguous.

## Changed files
1. `src/utils/securityUtils.ts`
2. `src/components/WorkVolumeTab.tsx`
3. `src/App.tsx`
4. `firestore.rules`
5. `scripts/firebase-rules-behavior.mjs`
6. `scripts/emulator-golden.mjs`
7. `scripts/emulator-dev.mjs`
8. `START_HNL_QLTC_DEV_EMULATOR.cmd`
9. `HNL-QLTC-V6.3.0-RC2.2.4-EDITOR-PERMISSION-HARDENING-REPORT.md` (new)

## Verification completed locally
- `node --check scripts/emulator-golden.mjs`: PASS
- `node --check scripts/firebase-rules-behavior.mjs`: PASS
- `node scripts/emulator-golden.mjs`: PASS
- `npm run test:stability`: PASS
  - Stability Gate PASS
  - Offline Golden PASS
  - Category Golden PASS
  - G1–G20 PASS
  - Firebase-only source matrix PASS
  - Legacy migration self-test PASS
  - Emulator DEV Golden config PASS
- `npm run lint`: PASS / SOURCE LINT PASS
- TypeScript transpile syntax for changed TS/TSX (`App.tsx`, `WorkVolumeTab.tsx`, `securityUtils.ts`): PASS
- JSON parse: PASS (`package.json`, `package-lock.json`, `firebase.json`, `.firebaserc`)
- YAML parse: PASS for all three GitHub workflows
- Secret/private-key/GitHub-token scan: PASS through source lint

## Unchanged critical files/config
Byte-identical to RC2.2.3:
- `package.json`
- `package-lock.json`
- `.firebaserc`
- `firebase.json`
- `storage.rules`
- `.github/workflows/build.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `.github/workflows/firebase-hosting-merge.yml`

`firestore.rules` is intentionally changed for the new RBAC enforcement.

## Gates still requiring GitHub/Windows runtime
This container does not have installed project dependencies and cannot certify the full npm/Rules emulator chain here. Therefore the following must be re-certified on PR #4 using GitHub Actions and then Windows Emulator:
- `npm ci`
- full `tsc --noEmit`
- Firebase Rules Emulator behavior test
- security audit
- Vite production build
- Runtime Golden on ADMIN / EDITOR / VIEWER

## Next Golden check after Actions green
1. Restart `START_HNL_QLTC_DEV_EMULATOR.cmd`.
2. Verify banner says RC2.2.4.
3. Admin: Work Volume still has Add / Import / Edit / Delete.
4. Editor: sees Work Volume values but has no Add / Import / Edit / Delete or selection controls.
5. Editor: update room/floor-plan progress; verify Work Volume actual/status changes through computed linkage.
6. Viewer: remains read-only and financial data remains hidden.
7. Only after Runtime Golden passes should PR #4 be merged.
