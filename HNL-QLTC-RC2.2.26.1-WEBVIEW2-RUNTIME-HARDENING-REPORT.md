# HNL QLTC RC2.2.26.1 — WebView2 Runtime Hardening Report

## Source base
- Sole source base: `HNL-QLTC-RC2.2.26-DEV-CERTIFIED-FULL-SOURCE.zip`.
- Exact certified DEV base HEAD: `e99bc2748a8a4406a2ceaad89d1210207a0227f5`.
- Firebase / Hosting / R2 / GitHub identities are unchanged.
- No `main` merge and no PROD deployment.

## Root-cause fixes
1. **OAuth / `window.open()`** — RC2.2.26 marked `NewWindowRequested` handled and navigated the requested URL in the primary WebView. That destroys the real popup/opener relationship expected by OAuth/Firebase flows. RC2.2.26.1 now takes a WebView2 deferral, creates a child WebView on the **same CoreWebView2Environment/profile**, assigns it to `NewWindow`, and closes it via `WindowCloseRequested`.
2. **Downloads** — RC2.2.26 had no `DownloadStarting` handler although the report said downloads were routed to the HNL workspace. RC2.2.26.1 routes PDF to `Documents\HNL QLTC\Exports\PDF`, Excel/CSV to `...\Excel`, and other downloads to `...\Exports`, with collision-safe file names.
3. **Camera/microphone** — explicit WebView2 `PermissionRequested` handling was added for the HNL app origin; every camera/microphone request asks the user and is not silently persisted. Normal HTML file upload remains handled by WebView2's native file picker.
4. **External protocols** — unsafe arbitrary non-HTTP scheme launching was removed. Only `tel:`, `mailto:`, `sms:` and `zalo:` may leave WebView2; `blob:`, `data:` and `about:` remain inside the embedded browser.
5. **DPI** — the single-file WinForms launcher now opts into Per-Monitor V2 DPI awareness with Windows 10/8.1 fallbacks **before `Application.EnableVisualStyles()` and before UI handles are created**, in addition to `AutoScaleMode.Dpi`.
6. **Tray / theme** — tray restore preserves prior Normal/Maximized state; Windows theme change callbacks are marshalled back to the UI thread before applying Light/Dark colors.

## Release identity
- Desktop release tag: `6.3.0-rc2.2.26.1` to avoid runtime/cache ambiguity with the already-certified RC2.2.26 binary.

## Windows certification boundary
Source-level/local gates can be rerun cross-platform, but native WebView2/installer GUI execution must run on Windows. This package therefore does not claim a new exact GitHub HEAD or Windows-certified binary until the patched source is intentionally pushed/built on the existing DEV branch.
