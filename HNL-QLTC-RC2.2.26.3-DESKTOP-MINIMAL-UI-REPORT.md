# HNL QLTC RC2.2.26.3 — Windows EXE Minimal Native UI Report

## Source base
- Certified DEV base: `22e5d749ca32073712166ba078fa72802f996f52`.
- Prior local candidate: `6.3.0-rc2.2.26.2`.
- Current local candidate: `6.3.0-rc2.2.26.3`.
- No rollback.
- Firebase Project / Hosting / R2 / GitHub repository identities are unchanged.
- No `main` merge and no PROD deployment.

## Goal
Reduce native Windows chrome so the EXE behaves like a focused HNL QLTC application instead of a developer utility shell.

## Native toolbar changes
- Removed browser-like `Back` / `Forward` controls.
- Removed duplicated `Trang chủ` and `HNL QLTC` destination buttons from the main toolbar.
- Main toolbar now focuses on:
  - HNL logo / product identity.
  - One compact sync status button.
  - Reload.
  - Grouped More menu.
  - Explicit compact/expand control.
- Native footer/status bar is hidden by default to return vertical space to the embedded WebView2 app.
- Toolbar actions remain right-aligned and resize-safe.
- Compact mode remains explicit through the visible button, More menu and `F11`; no timer-based auto-hide is introduced.

## Sync UX changes
- Sync toolbar button shows user-facing health:
  - `✓ Đồng bộ` when clear.
  - `⚠ N chờ` when local work remains.
- Clicking the sync status button shows a small menu with:
  - current status,
  - `Đồng bộ ngay`,
  - `Xem chi tiết`.
- Sync Center now opens in compact summary mode first.
- Queue/history/filter/retry tables are hidden until the user chooses `Xem chi tiết`.
- `DesktopBridge` is no longer exposed in the normal Sync Center and remains available only under technical/support tools.

## More menu organization
- `Công cụ máy tính`: Backup, exported files, local photos, optional tools screen.
- `Đồng bộ nâng cao`: Sync Center and local HNL rescan.
- `Hỗ trợ & kỹ thuật`: Diagnostics, Logs, DesktopBridge, external-browser fallback.
- `Giao diện`: compact mode.
- `Thoát HNL QLTC` remains explicit.

## Safety / architecture
- No Firebase rules/data-model changes.
- No R2 endpoint/policy changes.
- No cloud sync authority changes.
- No package.json or package-lock.json changes.
- No GitHub workflow changes.
- Existing Firestore persistent cache, IndexedDB photo cache, WebView2 profile, SQLite local workspace and cloud ACK contract are preserved.
- Offline project mirroring/prefetch is intentionally kept as a separate follow-up change so the UI refinement does not destabilize the certified sync path.

## Local gates
PASS:
- `node scripts/desktop-launcher-golden.mjs`
- `node scripts/source-lint.mjs`
- `node scripts/stability-gate.mjs`
- `node scripts/prod-readiness-golden.mjs`
- `node scripts/auth-popup-golden.mjs`
- `node scripts/offline-golden.mjs`
- `node scripts/firebase-only-golden.mjs`
- `node scripts/rbac-matrix.mjs`
- `node scripts/r2-gateway-golden.mjs`
- `node scripts/ai-gateway-golden.mjs`
- `node scripts/emulator-golden.mjs`

## Certification status
`RC2.2.26.3 LOCAL CANDIDATE`.

Native Windows compile / WebView2 runtime / installer / DPI validation must be run on a Windows runner after the user explicitly authorizes updating the existing DEV branch. This candidate must not be described as Windows-certified until that exact-source run passes.
