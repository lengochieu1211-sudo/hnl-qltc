# QLCT - Quan Ly Thi Cong

React/Vite web app with Firebase Auth + Firestore cloud sync. The free deployment path uses Firebase Hosting static output from `dist`; the optional Express server is kept for future Google Drive/Sheets integration on App Hosting or another server.

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

## Android APK

The APK wrapper loads the deployed web app when `QLCT_WEB_URL` or `android-wrapper/web-url.txt` is set. If no URL is set, it uses bundled fallback assets.

```powershell
$env:QLCT_WEB_URL="https://YOUR_FIREBASE_HOSTING_URL"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

The APK is written to `a.apk`.
