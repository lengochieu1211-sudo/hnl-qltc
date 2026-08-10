# Deploy QLCT

## Free Firebase Hosting path

Use this path when the Firebase project is on the free Spark plan and has no payment card.

This deploys the Vite web app as static files from `dist`. Firebase Auth and Cloud Firestore still work for login and cloud sync. Google Sheets/Drive routes in `server.ts` need a real server, so they are disabled on this static-only path.

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

Use this later only if the project is upgraded to Blaze or another server host is available.

The Node server in `server.ts` provides:

- `/api/auth/*` Google OAuth session routes.
- Google Drive backup routes.
- Google Sheets sync routes.

Required server environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_URL`
- `GEMINI_API_KEY` if Gemini server features are used.

Do not commit real values to GitHub. Keep local values in `.env.local` or provider secrets.

## APK web URL

After Firebase Hosting gives the production URL, rebuild the APK with one of these:

```powershell
$env:QLCT_WEB_URL="https://YOUR_FIREBASE_HOSTING_URL"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

or create local ignored file `android-wrapper/web-url.txt` containing only the deployed URL, then run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

The final APK is written to `a.apk`.
