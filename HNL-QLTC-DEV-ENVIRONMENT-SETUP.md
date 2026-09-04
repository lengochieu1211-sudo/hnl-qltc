# HNL QLTC – Isolated DEV Environment

Date: 2026-09-04

## Locked production resources — DO NOT CHANGE

- Repository: `lengochieu1211-sudo/hnl-qltc`
- PROD branch: `main`
- Current PROD merge commit before DEV setup: `fb85f2a746fe0d3e833f2b7f57097bb5029de320`
- PROD Firebase project: `com-example-qlct-61329`
- PROD Hosting: `https://hnlqltc.web.app`
- PROD R2 bucket: `hnl-qltc-media`
- PROD R2 Worker: `hnl-qltc-r2-gateway`

DEV setup must never modify or reuse these resources for test writes.

## DEV resources

- Source branch: `dev`
- DEV Firebase project: separate project, project ID comes from the DEV service account JSON.
- DEV Firestore location: `asia-southeast1` (same location as PROD, read-only verified on 2026-09-04).
- DEV R2 bucket: `hnl-qltc-media-dev`
- DEV R2 Worker: `hnl-qltc-r2-gateway-dev`
- DEV R2 URL: `https://hnl-qltc-r2-gateway-dev.lengochieu1211.workers.dev`
- DEV Hosting URL after deployment: `https://<DEV_PROJECT_ID>.web.app`

## Required one-time credential

GitHub repository secret:

`FIREBASE_SERVICE_ACCOUNT_HNL_QLTC_DEV`

The JSON must belong to the new DEV Firebase project. The workflow hard-refuses `project_id = com-example-qlct-61329`.

Existing `CLOUDFLARE_API_TOKEN` is reused only as a deployment credential; the workflow creates/uses separate DEV R2 resources and refuses the PROD R2 URL.

## Automated by `.github/workflows/firebase-dev-environment.yml`

Once the DEV service account secret exists, a push to branch `dev` will:

1. Verify the service account project is not PROD.
2. Verify Cloudflare deployment access.
3. Create the DEV `(default)` Firestore database in `asia-southeast1` if missing.
4. Create/reuse a DEV Firebase Web App and resolve its SDK config automatically.
5. Create/reuse R2 bucket `hnl-qltc-media-dev`.
6. Deploy Worker `hnl-qltc-r2-gateway-dev` bound only to the DEV bucket and DEV Firebase project.
7. Run npm ci, Stability, TypeScript, Lint, Firebase Rules emulator, Security Audit, and Build.
8. Deploy DEV Firestore rules.
9. Deploy DEV Firebase Hosting.
10. Smoke-test DEV R2 and DEV Hosting.

## Manual Firebase console item still required

Enable Google sign-in for the DEV Firebase Authentication project so runtime multi-user tests can use Google accounts. Do not change PROD Auth configuration.

## Release rule

- DEV failures never trigger PROD deployment.
- DEV data must be disposable test data only.
- Changes move `dev -> PR -> main -> PROD` only after DEV Runtime Golden passes.
