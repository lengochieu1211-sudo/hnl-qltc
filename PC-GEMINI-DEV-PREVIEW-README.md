# HNL QLTC – Gemini PC-only Preview from canonical DEV 2026-11-20

- Existing repository: `lengochieu1211-sudo/hnl-qltc`.
- Base branch: `dev` exact SHA `4b8235bcf7336a7f5836552d26680781b0de76c2` (verified at preparation).
- Preview branch: `preview/pc-gemini-dev-20261120` (independent; never merge into `main`/`dev` automatically).
- Source of PC UI: uploaded `HNL-QLTC-PR474-PROD-ROOM-UNIT-20261120-PC-UI-PRO (1).zip`, corrected CSS from R2.
- User requirement: PC-only Gemini layout, unchanged phone/Android, unchanged handlers/logic/Firestore/R2/RBAC and persistence.

## Exactly changed on DEV

1. `src/styles/desktopWorkspacePro.css`: PC >=1024-only design rules, light/dark, collapsible sidebar, tables and subdialogs.
2. `src/components/BottomNav.tsx`: visible PC sidebar brand and collapsible button, delegating all existing nav callbacks, no new business routes.
3. `src/components/DesktopWorkspaceHeader.tsx`: PC topbar/heading presentation using existing App callbacks, classic/modern toggle.
4. `src/main.tsx`: imports Gemini CSS after existing PC CSS; no changed bootstrap or data logic.
5. `scripts/pc-gemini-preview-regression.mjs`: source regression and frozen DEV checks.
6. `.github/workflows/pc-gemini-dev-preview.yml`: guarded DEV-only preview CI and Hosting preview channel, no Rules/PROD deploy.
7. This README.

## Must pass before use

- CI pins exact parent DEV SHA and allows *only* the seven UI/preview files above.
- Keep `src/App.tsx`, `src/components/RoomHighlightModal.tsx`, package/lock and three previous PC styles bit-identical to DEV base.
- TypeScript, lint, Rules tests, RBAC, PC regression, UI return regression, build PASS on exact candidate.
- Service account MUST have `project_id=hnl-qltc-dev` and Firebase SDK MUST have `projectId=hnl-qltc-dev`.
- Create only `hosting:channel:deploy pc-gemini-dev-20261120` with a generated hosting-only config, 30-day expiry.
- Preview URL produced by GitHub Actions artifact only after actual deployment.

## Post-deploy Runtime Golden

Test in a separate Chrome profile / incognito window with DEV-only accounts and test project:

- Desktop widths 1024/1280/1440/1920; Dark/Light; sidebar collapse/expand; PC old/new toggle.
- Every tab and button, modal overlays, keyboard/focus, dashboard, table scroll and print/export.
- ADMIN / EDITOR / VIEWER must have their original permissions.
- Change no PROD data. DEV-only create/update/deletion tests need disposable test records.
- Check offline/reconnect/2 accounts, upload images to DEV R2 and sync to DEV Firestore.
- Normal Android/mobile UI remains unchanged. Chrome Desktop Site 980px bridge remains.

**This preview is not PROD, not CERTIFIED before runtime checks, and does not require changing Firebase project, production domain or main branch.**
