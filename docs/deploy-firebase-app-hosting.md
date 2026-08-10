# Deploy QLCT

## Hosting target

Use Firebase App Hosting, not GitHub Pages, because this app needs the Node server in `server.ts` for `/api/auth/*`, Google Drive, and Google Sheets routes.

Firebase App Hosting connects directly to a GitHub repo and can automatically roll out every push to the live branch.

## Required Firebase setup

1. Create or select a Firebase project.
2. Enable Blaze billing if Firebase asks for it for App Hosting.
3. Create a Firebase Web App.
4. Enable Authentication > Anonymous sign-in.
5. Enable Cloud Firestore.
6. Deploy or paste `firestore.rules`.
7. Go to Hosting & Serverless > App Hosting.
8. Create a backend, connect the GitHub repo, choose branch `main`, app root `/`, and keep automatic rollouts enabled.

## App Hosting environment variables

Set these in Firebase App Hosting > Backend > Settings > Environment, or store them as Cloud Secret Manager secrets referenced by `apphosting.yaml`.

Build-time Firebase values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIRESTORE_DATABASE_ID`

Runtime Google OAuth values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_URL` only if OAuth redirect inference does not match the deployed domain.

Do not commit real values to GitHub. Keep local values in `.env.local`.

## Google OAuth

Create an OAuth 2.0 Client ID of type Web application in Google Cloud Console.

Authorized JavaScript origins:

- `https://YOUR_APP_HOSTING_URL`
- Any custom domain you add later.

Authorized redirect URIs:

- `https://YOUR_APP_HOSTING_URL/api/auth/callback`
- `https://YOUR_CUSTOM_DOMAIN/api/auth/callback` if using a custom domain.

The backend already passes state through OAuth so the Android WebView can open Google login externally and still update the web session.

`apphosting.yaml` currently sets `maxInstances: 1` because OAuth tokens are held in server memory. If the backend is later scaled to multiple instances, move OAuth token storage to Firestore, Redis, or encrypted cookies first.

## APK web URL

After Firebase App Hosting gives the production URL, rebuild the APK with one of these:

```powershell
$env:QLCT_WEB_URL="https://YOUR_APP_HOSTING_URL"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

or create local ignored file `android-wrapper/web-url.txt` containing only the deployed URL, then run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

The final APK is written to `a.apk`.
