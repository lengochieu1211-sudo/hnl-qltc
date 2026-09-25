# HNL QLTC RC2.2.23 — Windows Installer + User-first Desktop UI

## 1. Source base

- Sole source base: `HNL-QLTC-WINDOWS-DESKTOP-SUITE-RC2.2.22-DEV-CERTIFIED-FULL-SOURCE.zip`.
- Base ZIP SHA-256: `652376138090954daab1f866343d9b594d42b8f25ba90b7b1c84c4d0e3a66a8a`.
- Base DEV certified commit represented by that source: `a20e262ca07a788c4e0236c3cc81d0ddf2becef5`.
- No rollback and no copy-back from older source.
- Firebase Project / Hosting / R2 / GitHub repository identities were not changed.
- No GitHub push, no `main` merge and no PROD deployment were performed in this local candidate.

## 2. User-requested Windows changes

### Professional installer

Added an exact-launcher Windows Setup pipeline:

- PROD Setup: `HNL-QLTC-Setup.exe`.
- DEV Setup: `HNL-QLTC-DEV-Setup.exe`.
- PROD install target: `C:\Program Files\HNL\HNL QLTC\`.
- DEV install target: `C:\Program Files\HNL\HNL QLTC DEV\`.
- Installed main executable: `HNL QLTC.exe` / `HNL QLTC DEV.exe`.
- Creates `Start Menu > HNL > HNL QLTC` and an optional Desktop shortcut.
- Uses the canonical HNL logo for Setup/installed executable icon.
- Registers the app in Windows Installed Apps / Programs and Features with a dedicated uninstaller.
- Detects an existing installation and upgrades in place.
- Refuses overwrite while HNL QLTC is still running instead of killing the app.
- Uninstall removes only Program Files payload, shortcuts and uninstall registration.
- `Documents\HNL QLTC` and existing `%LOCALAPPDATA%\QLTCAnPhu` user data/cache are intentionally preserved on upgrade/uninstall.
- DEV and PROD install folders, executable names, shortcut names and uninstall keys are isolated so DEV cannot overwrite PROD.

### User-first Windows UI

The native Windows dashboard was simplified so it no longer looks like a Super Admin console:

- Header: `HNL QLTC Desktop` + HNL logo + friendly version label.
- Main action remains `Mở HNL QLTC`.
- Main cards are now `Dữ liệu & Sao lưu`, `Xuất hồ sơ`, `Ảnh hiện trường`, `Trạng thái hệ thống`.
- Footer now shows readable state such as `Dữ liệu cục bộ: Bình thường` and `Đồng bộ: Đã hoàn tất/Còn N mục` instead of raw SQLite/Queue counters.
- Raw Workspace/index/diagnostics/log tools remain available under `Công cụ nâng cao` instead of being exposed on the main screen.
- Main Desktop and Setup forms are DPI-aware and display the embedded HNL logo.

### RC2.2.22 hardening preserved

No changes were made to the certified core mechanics in `DesktopLocalStore.cs`, `DesktopSyncCenterForm.cs`, `src/lib/windowsDesktopSyncBridge.ts` or `src/utils/photoStorage.ts`. Therefore these remain source-identical to the RC2.2.22 certified base:

- Sync Center Queue + History.
- Batch retry/filter/search/retention.
- SQLite operation-level locking.
- Fail-safe scan.
- ACK schema/queueKey/sourceSha256/projectId/cloudVerified validation.
- deterministic photo ID.
- replay-safe one-time `attemptToken`.
- SQLite schema v4.

## 3. Changed / added files vs RC2.2.22 certified base

1. `.github/workflows/windows-exe-dev.yml`
2. `.github/workflows/windows-exe.yml`
3. `HNL-QLTC-RC2.2.23-WINDOWS-INSTALLER-REPORT.md`
4. `desktop-wrapper/HnlQltcInstaller.cs`
5. `desktop-wrapper/HnlQltcInstaller.manifest`
6. `desktop-wrapper/HnlQltcUninstaller.cs`
7. `desktop-wrapper/QLTCAnPhuLauncher.cs`
8. `desktop-wrapper/build-installer.ps1`
9. `desktop-wrapper/release-tag.txt`
10. `docs/WINDOWS_DESKTOP_SUITE.md`
11. `scripts/desktop-launcher-golden.mjs`
12. `scripts/windows-installer-golden.mjs`
13. `scripts/windows-installer-runtime-golden.ps1`

## 4. Verification completed locally

PASS:

- Exact base ZIP SHA verification.
- `node scripts/desktop-launcher-golden.mjs` including the new Windows installer source golden.
- `node scripts/source-lint.mjs`.
- `node scripts/prod-readiness-golden.mjs`.
- `node scripts/stability-gate.mjs`.
- Focused secret scan: no private key / GitHub PAT / Cloudflare API token pattern found.
- C# lexical/token balance check for launcher, installer and uninstaller.
- Modified GitHub workflow YAML parse check.
- `package.json` byte-for-byte unchanged from RC2.2.22 certified base.
- `package-lock.json` byte-for-byte unchanged from RC2.2.22 certified base.
- Firebase configs/rules byte-for-byte unchanged: `.firebaserc`, `firebase.json`, `firebase.prod.json`, `firebase.rules-ci.json`, `firestore.rules`, `database.rules.json`, `storage.rules`.
- Only Windows build workflows changed under `.github/workflows`.

Package hashes remain:

- `package.json`: `eb2df95b1773e5415b2173b39476ab603befa9b6a5e88d3cffd250571a77760c`
- `package-lock.json`: `4722b07631e27ba4b6e93e6b54220f7a6aa1d646878dc41d74856a3142c26b48`

## 5. Gates still requiring Windows/GitHub exact-source CI

This local environment does not provide Windows .NET Framework `csc.exe`/WinForms runtime. An attempt to install the Node dependency tree also timed out, and offline npm cache is incomplete. Therefore this package is deliberately marked **RC2.2.23 LOCAL CANDIDATE**, not DEV CERTIFIED yet.

Before DEV certification, the exact candidate must still run on GitHub `windows-latest`:

- `npm ci`
- full stability suite
- TypeScript
- lint
- production dependency security audit
- web build
- launcher C# compile
- Windows icon golden
- Windows SQLite local-store golden
- **new Setup EXE compile**
- **new installer runtime golden**
- DEV runtime golden exact SHA

The web TypeScript/package/Firebase source inputs are byte-identical to the already certified RC2.2.22 base; nevertheless the exact new commit must rerun those gates before certification.

## 6. Expected GitHub artifacts after an authorized DEV update

`Build HNL QLTC Windows DEV EXE` will produce both:

- `HNL-QLTC-Windows-DEV.exe` — portable engineering/rescue build.
- `HNL-QLTC-DEV-Setup.exe` — recommended end-user-style DEV installer.

The Setup build embeds the exact launcher produced earlier in the same Windows job, so it cannot silently package another source revision.

## 7. Release posture

**RC2.2.23 LOCAL CANDIDATE — source/audit gates above PASS; Windows native compile and exact-source CI certification pending.**

Do not call this DEV CERTIFIED, merge `main`, or deploy PROD until the exact-source CI chain is green.
