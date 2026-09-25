# HNL QLTC RC2.2.25 — Desktop EXE UI Dark Mode Refresh (LOCAL CANDIDATE)

## 1. Source base
- Sole base: `HNL-QLTC-WINDOWS-DESKTOP-SUITE-RC2.2.23-DEV-CERTIFIED-FULL-SOURCE.zip`
- No rollback.
- No Firebase / Hosting / R2 identity changes.
- No main merge.
- No PROD deployment.

## 2. User request addressed
User clarified that the target was **the Desktop EXE interface itself**, not the Setup UI:
- make the EXE interface look more professional
- support dark mode following the Windows system theme
- keep the experience cleaner for normal daily use

## 3. Scope implemented
### A. Main Desktop EXE home window redesigned
Refreshed `desktop-wrapper/QLTCAnPhuLauncher.cs`:
- upgraded main title area to **HNL QLTC Windows Desktop Suite**
- introduced cleaner layout with:
  - professional header
  - release badge
  - “Tự động theo hệ thống” theme note
  - focused quick-action area
  - clearer grouped cards for Data/Backup, Exports, Photos/Sync, Support/Tools
- simplified wording so the main screen is easier for daily users
- kept all existing functional paths and actions intact

### B. Dark mode / light mode by Windows system theme
Added reusable UI theming layer in desktop launcher source:
- reads Windows setting from `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`
- auto-selects light or dark palette
- listens for `SystemEvents.UserPreferenceChanged`
- reapplies UI styling when system theme changes
- attempts dark title bar on supported Windows versions via DWM attribute

### C. Sync Center visually aligned with the new desktop UI
Refreshed `desktop-wrapper/DesktopSyncCenterForm.cs`:
- theme now follows the same light/dark system behavior
- action buttons use the same flat modern style
- tabs, filters, footer, labels and data grids are themed consistently
- Sync Center keeps the same queue/history logic; visual layer only was updated

## 4. Files changed
1. `desktop-wrapper/QLTCAnPhuLauncher.cs`
2. `desktop-wrapper/DesktopSyncCenterForm.cs`
3. `HNL-QLTC-RC2.2.25-DESKTOP-UI-DARKMODE-REPORT.md`

## 5. Local verification
PASS:
- `node scripts/source-lint.mjs`
- `node scripts/prod-readiness-golden.mjs`

Notes:
- These checks confirm no project-safety regression was introduced in the source tree.
- Native WinForms compile/runtime validation still requires Windows / GitHub Actions because this environment does not provide the Windows .NET build toolchain.

## 6. Expected Windows verification next
Run on Windows from this exact source:
- build Desktop launcher EXE
- open main Desktop EXE
- verify light mode
- switch Windows to dark mode and verify live/next-open dark UI
- verify tray flow
- verify Sync Center opening, filters, queue/history tables, retry buttons
- verify Advanced Tools modal

## 7. Release posture
**RC2.2.25 LOCAL CANDIDATE — Desktop EXE UI refresh + system dark mode source changes complete; Windows native build/runtime certification still required.**
