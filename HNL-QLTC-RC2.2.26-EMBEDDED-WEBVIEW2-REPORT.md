# HNL QLTC RC2.2.26 — Embedded WebView2 Desktop Shell

## Source base
- Sole base: `HNL-QLTC-WINDOWS-DESKTOP-SUITE-RC2.2.25-DEV-CERTIFIED-FULL-SOURCE.zip`
- Certified base DEV head: `bf78ad30f585e1de31c6675a1f3796c30ef1b7e9`
- No rollback.
- Firebase / Hosting / R2 / GitHub identities are unchanged.
- No `main` merge and no PROD deployment.

## User request
Open HNL QLTC Web **inside the Windows EXE**, without launching a new Edge/Chrome tab/window for normal use.

## Changes

### 1. New embedded desktop shell
Added `desktop-wrapper/DesktopWebShellForm.cs`.

The EXE now starts in a native HNL shell containing:
- HNL branding + release tag
- Back / Forward
- Trang chủ
- HNL QLTC
- Đồng bộ
- Tải lại
- More menu
- embedded WebView2 content area
- native status/footer
- system tray support

The embedded HNL QLTC web view is opened automatically after the EXE starts.

### 2. Browser fallback is no longer the normal path
`Program.OpenHnlQltc()` first routes to the running `DesktopWebShellForm`.

The previous Edge/Chrome app-mode path remains as `OpenHnlQltcExternal()` only for explicit fallback use.

### 3. WebView2 SDK embedded into the single launcher EXE
`desktop-wrapper/build-launcher.ps1` now:
- reads a pinned SDK version from `desktop-wrapper/webview2-sdk-version.txt`
- downloads the Microsoft.Web.WebView2 NuGet package from nuget.org during Windows build
- extracts `net462` Core + WinForms assemblies
- embeds Core, WinForms, x64 loader and x86 loader as EXE resources
- still outputs one launcher EXE for the existing installer pipeline

Pinned SDK: `1.0.2903.40`.

### 4. Safe writable WebView2 profile
WebView2 browser data is stored in:
`%LOCALAPPDATA%\\QLTCAnPhu\\WebView2Profile`

This avoids attempting to write browser state under `C:\\Program Files` after Setup installation.

### 5. New-window requests remain inside the EXE
The embedded runtime handles WebView2 `NewWindowRequested`, marks it handled, and navigates the same embedded view. This prevents ordinary `window.open` navigation from creating a separate browser tab/window.

### 6. Fallback screen
If WebView2 cannot initialize, the EXE shows a native HNL fallback panel with:
- `Thử lại WebView2`
- `Mở bằng trình duyệt`

The browser is therefore a visible fallback, not a silent/default behavior.

### 7. Existing Windows features preserved
The existing native functionality remains available:
- Sync Center
- local SQLite workspace/cache
- queue/history
- background maintenance
- Backup / Imports / Exports / Photos / Reports / Logs / Diagnostics
- system tray
- system light/dark mode
- professional Setup / upgrade / uninstall behavior

No RC2.2.25 certified sync/RBAC/media hardening was intentionally weakened.

## Files changed/added
- `desktop-wrapper/DesktopWebShellForm.cs` (new)
- `desktop-wrapper/QLTCAnPhuLauncher.cs`
- `desktop-wrapper/build-launcher.ps1`
- `desktop-wrapper/release-tag.txt`
- `desktop-wrapper/webview2-sdk-version.txt` (new)
- `scripts/desktop-launcher-golden.mjs`
- `docs/WINDOWS_DESKTOP_SUITE.md`
- `HNL-QLTC-RC2.2.26-EMBEDDED-WEBVIEW2-REPORT.md` (new)

## Local source gates
PASS:
- `node scripts/desktop-launcher-golden.mjs`
- `node scripts/windows-installer-golden.mjs`
- `node scripts/source-lint.mjs`
- `node scripts/prod-readiness-golden.mjs`

## Windows exact-source gate still required
GitHub `windows-latest` must still compile and runtime-test this exact source. In particular:
- pinned WebView2 NuGet package extraction
- resource embedding
- C# compilation
- EXE launch
- Setup runtime golden
- DEV Runtime Golden
- package certification

Release posture before those gates: **RC2.2.26 LOCAL CANDIDATE**.

## Exact Windows runtime certification added

A dedicated `scripts/windows-webview2-runtime-golden.ps1` now launches the **real built EXE** on the GitHub Windows runner and requires a CI-only READY marker emitted only after `CoreWebView2` has initialized successfully.

The runtime gate also verifies that the single EXE extracted its embedded WebView2 Core, WinForms and native loader payloads. Both PROD/DEV Windows EXE workflows run this gate immediately after launcher build. Normal users are unaffected because the smoke marker is enabled only when the CI environment variable `HNL_QLTC_WEBVIEW2_SMOKE_FILE` is explicitly set.
