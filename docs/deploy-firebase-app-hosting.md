# Deploy QLCT

## Free Firebase Hosting path

Use this path when the Firebase project is on the free Spark plan and has no payment card.

This deploys the Vite web app as static files from `dist`. Firebase Auth and Cloud Firestore still work for login and cloud sync. Google Sheets/Drive routes in `server.ts` need a real server, so they are disabled on this static-only path.

Current decision for the 0 VND/month target:

- Keep Firebase Hosting static deployment.
- Keep Firebase Authentication on the free/Spark allowance.
- Keep Cloud Firestore usage inside the free/Spark allowance.
- Do not enable Firebase App Hosting, Cloud Run, Cloud Functions, Blaze billing, paid domains, paid databases, paid VPS, or trial services that can auto-charge.
- Do not show Google Drive/Sheets buttons on the live static Hosting app unless a real backend URL is explicitly configured and approved.

## Required Firebase setup

1. Create or select the Firebase project.
2. Authentication > Sign-in method:
   - Enable Anonymous.
   - Enable Google if the app should show the user's Google account.
3. Create Cloud Firestore in production mode.
4. Publish `firestore.rules`.
5. Hosting > Get started.
6. Connect the GitHub repo `qlct-an-phu`.
7. Choose branch `main`.
8. Build command: `npm ci && npm run build`.
9. Public/output directory: `dist`.
10. Keep automatic deploys enabled.

`firebase.json` already contains the Hosting rewrite that sends every route back to `index.html`.

## Firebase config without GitHub secrets

On Firebase Hosting, the app loads config at runtime from:

```text
/__/firebase/init.json
```

That means Firebase web config does not need to be committed to GitHub or placed in GitHub Secrets for the static Hosting path.

For local development or a different host, use `.env.local` based on `.env.example`.

## Optional App Hosting/server path

Use this later only if the project owner explicitly approves a backend path. Firebase App Hosting and most Firebase server runtimes require billing/Blaze, so they are not part of the current free production architecture.

The Node server in `server.ts` provides:

- `/api/auth/*` Google OAuth session routes.
- Google Drive backup routes.
- Google Sheets sync routes.

Required server environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_URL`
- `GEMINI_API_KEY` if Gemini server features are used.

Frontend server API gate:

- `VITE_API_BASE_URL` can point the static frontend at an approved backend.
- `VITE_ENABLE_SERVER_API=true` allows same-origin `/api/*` calls for an approved server deployment.
- Without those settings, the live Firebase Hosting app treats Google Drive/Sheets API features as unavailable and hides the server-only UI.

Do not commit real values to GitHub. Keep local values in `.env.local` or provider secrets.

## APK web URL

The current production URL is:

```text
https://com-example-qlct-61329.web.app
```

Rebuild the APK with one of these:

```powershell
$env:QLCT_WEB_URL="https://com-example-qlct-61329.web.app"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

or create local ignored file `android-wrapper/web-url.txt` containing only the deployed URL, then run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

The final APK is written to `QLTC An Phu.apk`.
