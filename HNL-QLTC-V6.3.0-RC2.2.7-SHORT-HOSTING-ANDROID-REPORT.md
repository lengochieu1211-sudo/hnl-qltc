# HNL QLTC V6.3.0 RC2.2.7 – Short Hosting + Android APK Report

## Baseline

- Baseline: HNL QLTC V6.3.0 RC2.2.6 R2 source.
- Firebase project remains `com-example-qlct-61329`.
- Existing Hosting site is not deleted.
- New site created by project owner: `hnlqltc` → `https://hnlqltc.web.app`.
- No GitHub push or Firebase deployment was performed while preparing this package.

## Changes

1. Added `firebase.prod.json` that pins production Hosting to site `hnlqltc`.
2. Updated the manual production workflow so Firestore Rules deploy independently and Hosting deploys with `firebase.prod.json`; Firebase Storage is no longer a deploy blocker for the R2 release.
3. Kept `firebase.json` generic for emulator/DEV compatibility.
4. Updated Android wrapper default URL to `https://hnlqltc.web.app/?app=android`.
5. Reworked `android-wrapper/build-apk.ps1` to auto-detect Android SDK/JDK instead of hard-coded paths.
6. Android `versionName` and deterministic `versionCode` are derived from `package.json`; release URL gets a version cache-buster.
7. Added optional stable signing through GitHub Secrets; a generated development keystore is only the fallback for testing.
8. Added `.github/workflows/android-apk.yml` to build and upload `HNL-QLTC-Android.apk` as an Actions artifact.
9. Added `npm run build:apk:windows` and Android build documentation.
10. Stability Gate now guards the short Hosting configuration and Android CI contract.

## Verification results

PASS:

- Stability Gate.
- Offline Golden.
- Category Golden.
- Firebase-only Golden source matrix.
- Legacy migration audit self-test.
- Emulator configuration Golden.
- Master RBAC matrix.
- R2 Gateway Golden.
- Source lint / merge-marker scan / secret scan.
- `package.json` ↔ `package-lock.json` root version consistency.
- GitHub workflow YAML parse.
- `firebase.prod.json` JSON parse.

Environment blocker:

- `npm ci` timed out in the current sandbox while fetching packages. It left an incomplete `node_modules` tree.
- Therefore local full TypeScript and Vite build cannot be certified from this sandbox run; TypeScript reports missing type packages and Vite is unavailable because the install was incomplete.
- GitHub Actions is intentionally configured to run clean `npm ci → Stability → TypeScript → Lint → Build` before creating the APK or deploying Hosting. Do not treat APK/PROD as certified until those CI jobs are green.

Known release dependencies before PROD:

- `VITE_R2_GATEWAY_URL` must point to the deployed Cloudflare Worker before R2 production release can pass its gate.
- `VITE_FIREBASE_APP_ID` repository variable should be populated/verified.
- For a production-upgradeable APK, configure the four Android signing secrets and retain the same keystore permanently.

## Deployment sequence

1. Configure/verify Cloudflare R2 Worker and `VITE_R2_GATEWAY_URL`.
2. Update the existing GitHub repository with this source; do not create a new repo.
3. Wait for Build workflow to pass.
4. Run `Build HNL QLTC Android APK`; download the APK artifact and smoke-test it on a physical Android phone.
5. Run the manual PROD workflow with `DEPLOY-PROD` only after the gates are green.
6. Verify `https://hnlqltc.web.app` on desktop and phone.
7. Keep the old Hosting address as fallback until runtime verification is complete.
