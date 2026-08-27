# HNL QLTC V6.3.0 RC2.2.2 — Windows cmd.exe Quote Fix

Baseline: `HNL-QLTC-V6.3.0-RC2.2.1-FULL-SOURCE.zip`

## Runtime failure reproduced from Windows

RC2.2.1 successfully removed the Node 24 `spawnSync npm.cmd EINVAL` failure by routing npm/npx through `cmd.exe`, but Windows then reported:

`Unknown command: '"run"'`

The cause was quoting every npm argument before passing the command line to `cmd.exe`. npm therefore received the quote characters as part of the subcommand token.

## Root fix

### `scripts/emulator-dev.mjs`

- Still uses `%ComSpec%` / `cmd.exe /d /s /c` on Windows, so Node never directly spawns `.cmd` files.
- Replaces quote-every-token behavior with `quoteCmdToken()`.
- Simple controlled tokens such as `run`, `build`, `--yes`, `firebase-tools@13.35.1` and emulator arguments are passed unquoted.
- Only tokens that actually contain cmd-sensitive whitespace/metacharacters are quoted.
- Launcher banner updated to RC2.2.2.

The intended Windows commands are now effectively:

- `npm.cmd run build`
- `npx.cmd --yes firebase-tools@13.35.1 emulators:start --project demo-hnl-qltc-dev --only auth,firestore,storage,hosting`

### `scripts/emulator-golden.mjs`

Added regression guards that fail if the old `args.map(quoteCmdArg)` quote-every-token pattern returns.

### `START_HNL_QLTC_DEV_EMULATOR.cmd`

Banner updated to RC2.2.2. Node/npm/Java checks and the existing `npm ci` behavior are unchanged.

## Safety preserved

- PROD Firebase project remains `com-example-qlct-61329`.
- Emulator project remains `demo-hnl-qltc-dev`.
- Emulator runtime remains DEV-only and demo-project-only.
- No Firebase project, Hosting target, GitHub repo, rules, package metadata, lockfile, or production workflow was changed in this repair.
- No GitHub push or Firebase deploy was performed.

## Verification performed

- `node --check scripts/emulator-dev.mjs`: PASS
- `node --check scripts/emulator-golden.mjs`: PASS
- `node scripts/emulator-golden.mjs`: PASS
- `npm run test:stability`: PASS
  - Stability Gate PASS
  - Offline Golden PASS
  - Category Golden PASS
  - G1–G20 PASS
  - Legacy migration audit self-test PASS
  - Emulator DEV Golden config PASS

Full Windows runtime remains pending until the patched launcher is run on the user's Windows PC. Full CI should be re-run on PR #4 after pushing this patch before Runtime Golden continues.

## Files changed in RC2.2.2

- `scripts/emulator-dev.mjs`
- `scripts/emulator-golden.mjs`
- `START_HNL_QLTC_DEV_EMULATOR.cmd`
- `HNL-QLTC-V6.3.0-RC2.2.2-WINDOWS-CMD-QUOTE-FIX-REPORT.md`
