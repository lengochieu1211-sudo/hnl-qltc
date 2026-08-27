# HNL QLTC V6.3.0 RC2.2.1 — Windows Emulator Launcher Fix

Baseline: `HNL-QLTC-V6.3.0-RC2.2-FULL-SOURCE.zip`

Purpose: repair the Windows-only RC2.2 DEV Emulator launcher failure observed on Node.js `v24.19.0`:

`Error: spawnSync npm.cmd EINVAL`

No Firebase project, Hosting target, GitHub repository, production workflow, business data model, or application feature was changed.

## Root cause

RC2.2 `scripts/emulator-dev.mjs` called `npm.cmd` / `npx.cmd` directly with Node `spawnSync(..., { shell: false })` on Windows. `.cmd` files require the Windows command interpreter, and Node 24 can return `EINVAL` when a batch command is spawned directly this way.

The top-level `START_HNL_QLTC_DEV_EMULATOR.cmd` itself was not the failing layer. It successfully reached `npm run dev:emulator`; the failure occurred inside the Node launcher when it attempted the nested `npm run build`.

## Fix

### `scripts/emulator-dev.mjs`

Windows now executes nested npm/npx commands through:

`%ComSpec% /d /s /c ...`

with fallback to `cmd.exe` when `ComSpec` is unavailable.

- `npm` becomes `npm.cmd` inside `cmd.exe`.
- `npx` becomes `npx.cmd` inside `cmd.exe`.
- Arguments are quoted before being assembled into the controlled command line.
- `shell: false` remains in `spawnSync`; Node launches only `cmd.exe`, rather than asking Node to directly execute a `.cmd` file.
- Linux/macOS behavior remains unchanged: npm/npx are spawned directly.
- DEV-only / `demo-hnl-qltc-dev` / PROD refusal guards are unchanged.

### `scripts/emulator-golden.mjs`

Added a regression guard requiring the Windows launcher to contain:

- `process.env.ComSpec || 'cmd.exe'`
- `/d /s /c`
- `.cmd` resolution for npm/npx
- `shell: false`

The gate also rejects the old direct `spawnSync(executable(name), ...)` pattern that caused the Node 24 Windows EINVAL failure.

### `START_HNL_QLTC_DEV_EMULATOR.cmd`

Only the displayed label was updated from RC2.2 to RC2.2.1. Dependency install and Java/Node checks remain unchanged.

## Files changed

1. `scripts/emulator-dev.mjs`
2. `scripts/emulator-golden.mjs`
3. `START_HNL_QLTC_DEV_EMULATOR.cmd`
4. `HNL-QLTC-V6.3.0-RC2.2.1-WINDOWS-LAUNCHER-FIX-REPORT.md` — new report

## Verification completed

PASS:

- `node --check scripts/emulator-dev.mjs`
- `node --check scripts/emulator-golden.mjs`
- `node scripts/emulator-golden.mjs`
- Stability Gate
- Offline Golden
- Category Golden
- Firebase-only G1–G20 source matrix
- Legacy migration audit self-test
- Source Lint
- No merge markers / private keys / GitHub tokens detected by source lint

RC2.2.1 regression result:

`PASS: Windows npm/npx launcher uses cmd.exe and avoids direct .cmd spawn EINVAL`

Unchanged byte-for-byte versus RC2.2:

- `package.json`
- `package-lock.json`
- `firebase.json`
- `.firebaserc`
- `.github/workflows/build.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `.github/workflows/firebase-hosting-merge.yml`

The production Firebase project remains `com-example-qlct-61329`. Emulator project remains `demo-hnl-qltc-dev`.

## Environment limitation

A fresh local `npm ci` attempt in the artifact environment timed out while reaching the npm registry, so full dependency-backed TypeScript/Rules/Build was not re-run locally for RC2.2.1. No dependency manifests changed. The authoritative full CI verification must therefore be the next GitHub Actions run after applying this patch to the existing RC2.2 branch.

The actual Windows runtime fix must then be confirmed by running `START_HNL_QLTC_DEV_EMULATOR.cmd` again on the user's Windows PC. Expected behavior: the nested `npm run build` proceeds without `spawnSync npm.cmd EINVAL`, then Firebase Emulator startup continues.

## Next gate

Apply this PATCH to the existing branch `rc2-2-emulator-dev-golden`, commit/push, and keep PR #4 open. Do not merge yet.

Required next sequence:

1. GitHub Actions must be green again for RC2.2.1.
2. Run `START_HNL_QLTC_DEV_EMULATOR.cmd` on Windows.
3. Confirm Emulator UI + Auth/Firestore/Storage/Hosting ports start.
4. Continue PC + phone + ADMIN/EDITOR/VIEWER + realtime/offline/reconnect Runtime Golden.
5. Merge PR #4 only after Runtime Golden passes.

No PROD deploy was performed.
