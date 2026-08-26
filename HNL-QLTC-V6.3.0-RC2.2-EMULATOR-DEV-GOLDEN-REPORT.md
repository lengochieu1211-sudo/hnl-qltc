# HNL QLTC V6.3.0 RC2.2 — Emulator DEV Golden Report

Date: 2026-08-26

Baseline: `HNL-QLTC-V6.3.0-RC2.1-FULL-SOURCE.zip`

Production Firebase preserved: `com-example-qlct-61329`

Production Hosting preserved: `https://com-example-qlct-61329.web.app/`

GitHub repo preserved: `lengochieu1211-sudo/hnl-qltc`

No GitHub push and no Firebase deploy were performed while preparing RC2.2.

## 1. RC2.2 objective

Provide a disposable Firebase Emulator DEV environment for PC + phone Golden testing without creating or touching a cloud DEV/PROD Firebase project.

Primary local emulator project: `demo-hnl-qltc-dev`.

Services:

- Hosting `0.0.0.0:5000`
- Auth `0.0.0.0:9099`
- Firestore `0.0.0.0:8080`
- Storage `0.0.0.0:9199`
- Emulator UI `0.0.0.0:4000`

## 2. Root architecture changes

### Firebase runtime fail-safe

`src/lib/firebase.ts`

- Added `VITE_USE_FIREBASE_EMULATORS` DEV-only switch.
- Emulator mode throws immediately when `VITE_APP_ENV=PROD`.
- Emulator project ID throws when equal to `com-example-qlct-61329`.
- Local emulator project ID must start with `demo-`.
- When Emulator mode is enabled, Firebase config is forced to synthetic `demo-*` config; ambient live `VITE_FIREBASE_*` variables are ignored.
- Firestore connects to the local Firestore Emulator before business operations.
- Auth connects to the local Auth Emulator.
- Host defaults to `auto`: browser hostname is used, enabling a phone opened on the PC LAN IP to reach the same emulator host.
- Added deterministic DEV Emulator accounts for ADMIN / EDITOR / VIEWER test identities.
- `getCurrentRealFirebaseUser()` accepts emulator email/password identities only while DEV Emulator mode is active; production still requires real Google provider identity.

### Firebase Storage emulator

`src/lib/firebaseStorage.ts`

- Added `connectStorageEmulator()` using the same resolved emulator host.
- Existing Storage path, metadata, upload/download/purge behavior is retained.

### App Check

`src/lib/appCheck.ts`

- App Check is skipped only in Emulator mode so local Golden tests do not require reCAPTCHA/App Check keys.
- Normal DEV cloud/PROD behavior remains unchanged.

### Deterministic multi-user login UI

`src/components/GoogleAuthModal.tsx`

- Emulator-only panel exposes `ADMIN`, `EDITOR`, `VIEWER` test login buttons.
- Test users exist only in Auth Emulator:
  - `admin@hnl.test`
  - `editor@hnl.test`
  - `viewer@hnl.test`
- The panel is not available in normal PROD runtime.

### LAN-ready Emulator Suite

`firebase.json`

- Added Hosting emulator.
- Bound Auth/Firestore/Storage/Hosting/UI to `0.0.0.0` for same-LAN phone testing.
- Enabled Emulator UI on port 4000.
- `singleProjectMode=true`.

### Cross-platform launcher

`scripts/emulator-dev.mjs`

- `npm run build:emulator` builds with DEV Emulator variables.
- `npm run dev:emulator` builds first, then starts Auth + Firestore + Storage + Hosting Emulator Suite.
- Uses fixed `demo-hnl-qltc-dev`, never PROD.
- Prints PC URL and detected LAN IP URLs for phone testing.

`START_HNL_QLTC_DEV_EMULATOR.cmd`

- One-click Windows launcher.
- Checks Node/npm/Java.
- Runs `npm ci` when dependencies are absent.
- Starts the RC2.2 Emulator stack.

### Emulator regression gate

`scripts/emulator-golden.mjs`

Checks that:

- emulator mode is DEV-only;
- production project ID is explicitly refused;
- demo project prefix is enforced;
- live Firebase config cannot override Emulator config;
- Auth/Firestore/Storage emulator connections exist;
- App Check bypass is emulator-only;
- LAN ports are fixed and exposed;
- deterministic DEV test users exist;
- scripts are wired into `test:stability`;
- optional Cloud DEV workflow still refuses PROD.

### PR Cloud DEV workflow

`.github/workflows/firebase-hosting-pull-request.yml`

- RC2.2 primary DEV is local Emulator.
- If `HNL_QLTC_DEV_PROJECT_ID` is not configured, optional Cloud DEV preview job is skipped rather than making every PR red.
- If a Cloud DEV project is configured later, the existing isolation gate still rejects `com-example-qlct-61329`.

## 3. Changed / added files

1. `.env.emulator.example` — added
2. `.github/workflows/firebase-hosting-pull-request.yml` — modified
3. `.gitignore` — modified
4. `START_HNL_QLTC_DEV_EMULATOR.cmd` — added
5. `docs/firebase-only/RC2_2_EMULATOR_DEV_GOLDEN.md` — added
6. `firebase.json` — modified
7. `package.json` — modified scripts only
8. `scripts/emulator-dev.mjs` — added
9. `scripts/emulator-golden.mjs` — added
10. `src/components/GoogleAuthModal.tsx` — modified
11. `src/lib/appCheck.ts` — modified
12. `src/lib/firebase.ts` — modified
13. `src/lib/firebaseStorage.ts` — modified
14. `vite.config.ts` — modified
15. `HNL-QLTC-V6.3.0-RC2.2-EMULATOR-DEV-GOLDEN-REPORT.md` — added report

`package-lock.json` is byte-for-byte unchanged because no dependency/version was changed.

## 4. Verification results in this environment

### PASS

- RC2.2 Emulator config Golden: PASS
- Stability Gate: PASS
- Offline Golden: PASS
- Category Golden: PASS
- Firebase-only G1–G20 source matrix: PASS
- Legacy migration self-test: PASS
- Source Lint: PASS
- JSON parse: `package.json`, `package-lock.json`, `firebase.json`, `.firebaserc`: PASS
- GitHub workflow YAML parse: PASS
- Modified TS/TSX/Vite syntax transpile: PASS
- Production `.firebaserc` project remains `com-example-qlct-61329`: PASS
- Production deploy workflow still targets `com-example-qlct-61329`: PASS
- `package-lock.json` hash unchanged from RC2.1: PASS
- Sensitive private-key/GitHub-token pattern scan: PASS

### BLOCKED locally — not classified as source failure

`npm ci` could not complete in the current execution environment due external npm/network availability and timed out.

As a consequence:

- Full TypeScript semantic check: BLOCKED locally because runtime dependencies/types are unavailable. A direct `tsc --noEmit` reports missing installed modules/types, not a specific RC2.2 source error.
- Firebase Rules emulator behavior: BLOCKED locally because `npx firebase-tools@13.35.1` cannot be fetched/completed here.
- Security audit: BLOCKED locally with `EAI_AGAIN registry.npmjs.org`.
- Build: BLOCKED locally because `vite` is not installed after `npm ci` could not complete.

RC2.1 full CI was already green on GitHub Build #75 before these RC2.2 changes. RC2.2 must therefore be pushed through GitHub Actions once to re-certify TypeScript + Rules + Security + Build.

## 5. Runtime Golden status

Not falsely marked VERIFIED.

- PC + phone live runtime matrix: REVIEW — requires actual devices/browser sessions.
- Emulator Auth/Firestore/Storage runtime behavior through the application: REVIEW until the local stack is started on the user's PC.
- Mobile offline edit/reconnect: REVIEW.
- Mobile offline full reload over plain LAN HTTP: separate wrapper/HTTPS gate because browser Service Worker secure-context rules may apply.
- Production Firebase touched: NO.

Detailed runtime sequence is in `docs/firebase-only/RC2_2_EMULATOR_DEV_GOLDEN.md`.

## 6. Next required gate

1. Update existing GitHub repo with RC2.2 via a branch/PR.
2. Confirm normal Build workflow is fully green.
3. Do not run PROD deploy.
4. On Windows, run `START_HNL_QLTC_DEV_EMULATOR.cmd`.
5. Open PC at `http://127.0.0.1:5000` and phone at the printed LAN URL.
6. Execute ADMIN / EDITOR / VIEWER + realtime + image + offline + reconnect Golden matrix.
7. Only after runtime matrix passes should RC2.2 be classified `EMULATOR DEV GOLDEN VERIFIED`.
