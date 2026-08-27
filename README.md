# HNL Quan Ly Thi Cong

React/Vite web app with Firebase Auth + Firestore cloud sync. The production deployment is the free Firebase Hosting static output from `dist`. The optional Express server is kept for local development or a future explicitly approved backend, but Google Drive/Sheets server features are gated off on the free Hosting path.

## Local development

```powershell
npm ci
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Build

```powershell
npm run lint
npm run build
node dist/server.cjs
```

## Secrets

Do not commit real values from `.env.local`, Firebase config files, OAuth credentials, keystores, or generated APKs.

Deployment notes are in `docs/deploy-firebase-app-hosting.md`.
Future AI Studio ZIP merge notes are in `docs/merge-ai-studio-zip.md`.

## Cost policy

The recurring-cost target is 0 VND/month. Do not enable Firebase Blaze, App Hosting, Cloud Run, paid APIs, paid databases, paid VPS, paid domains, or trial services that can auto-charge unless the owner explicitly approves it first.

## Android APK

The APK wrapper loads the deployed web app when `QLCT_WEB_URL` or `android-wrapper/web-url.txt` is set. If no URL is set, it uses bundled fallback assets.

```powershell
$env:QLCT_WEB_URL="https://com-example-qlct-61329.web.app"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

The APK is written to `QLTC An Phu.apk`.
