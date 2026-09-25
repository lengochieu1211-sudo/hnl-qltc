# HNL QLTC RC2.2.24 — Windows Installer UI Hotfix (LOCAL CANDIDATE)

## 1. Source base

- Sole source base: `HNL-QLTC-WINDOWS-DESKTOP-SUITE-RC2.2.23-DEV-CERTIFIED-FULL-SOURCE.zip`
- Base ZIP path: `/mnt/data/RC2.2.23-DEV-CERTIFIED-FINAL/HNL-QLTC-WINDOWS-DESKTOP-SUITE-RC2.2.23-DEV-CERTIFIED-FULL-SOURCE.zip`
- Base ZIP SHA-256: `c143e581a6addc54f9790466a808339015b5dd95ef9a63c4be5c8c2007a22a19`
- No rollback.
- No Firebase / Hosting / R2 / GitHub identity changes.
- No `main` merge and no PROD deployment.

## 2. User-reported issue addressed

User runtime feedback on the new Setup EXE:

1. **Installer did not show the “Cài đặt” button** in the visible area.
2. User requested a **more professional installer UI**.
3. User requested **dark mode following the Windows system theme**.

## 3. Hotfix implemented

### A. Missing install button fixed

`desktop-wrapper/HnlQltcInstaller.cs` was refactored from hard-coded absolute placement into a safer layout structure using:

- root `TableLayoutPanel`
- dedicated header row
- dedicated scroll-safe content row
- dedicated footer/action row
- right-aligned button bar

Result:

- the primary **Cài đặt / Nâng cấp** button is always rendered inside a reserved footer area
- the **Hủy** button remains visible beside it
- layout is more resilient under DPI scaling
- content no longer pushes the action row outside the form

### B. Professionalized installer UI

The installer UI was redesigned to look more like a finished Windows installer:

- larger header with HNL logo and clear title
- cleaner spacing and grouping
- dedicated **Tùy chọn cài đặt** card
- dedicated **Cài đặt chuyên nghiệp cho Windows** summary card
- read-only install path field
- clearer status/progress area
- explicit confirmation that **dữ liệu dự án và cache không bị xóa hoặc reset**

### C. System dark mode support

Added system-theme-aware styling directly in the installer source:

- reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`
- automatically selects **light** or **dark** palette
- updates the installer when Windows user preference changes during runtime
- attempts to enable **dark title bar / immersive dark mode** on supported Windows versions

### D. Existing installer guarantees preserved

The hotfix kept the previously certified Windows installer behavior intact:

- installs to `C:\Program Files\HNL\...`
- Start Menu + optional Desktop shortcut creation
- DEV / PROD isolation
- in-place upgrade behavior
- safe refusal when app executable is locked/running
- uninstall registration in Windows Installed Apps
- user-data preservation policy

## 4. Files changed in this hotfix

1. `desktop-wrapper/HnlQltcInstaller.cs`
2. `HNL-QLTC-RC2.2.24-WINDOWS-INSTALLER-UI-HOTFIX-REPORT.md`

## 5. Verification completed locally

PASS:

- `node scripts/windows-installer-golden.mjs`
- `node scripts/source-lint.mjs`
- `node scripts/prod-readiness-golden.mjs`

Observations:

- Source-level Windows installer golden checks passed after the UI rewrite.
- No PROD/Firebase/R2 identity drift was introduced.
- This environment still does **not** provide Windows .NET Framework `csc.exe` / real WinForms runtime, so native Setup EXE compilation + runtime click-through must still be confirmed on Windows/GitHub Actions.

## 6. Required next gate on Windows

Before calling this DEV certified, run the exact-source Windows chain again:

- build launcher EXE
- build Setup EXE
- installer runtime golden on Windows
- verify visible **Cài đặt** button at runtime
- verify system dark/light mode behavior
- verify install / upgrade / uninstall flow

## 7. Release posture

**RC2.2.24 LOCAL CANDIDATE — installer UI hotfix applied, source-level gates PASS, Windows native compile/runtime certification still required.**
