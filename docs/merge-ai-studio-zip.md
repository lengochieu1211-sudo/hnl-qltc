# Merge AI Studio ZIPs

Goal: take a newer ZIP from AI Studio while preserving GitHub, Firebase, OAuth, database rules, and APK wrapper configuration.

## Protected files and folders

Do not overwrite these without reviewing the diff:

- `.git/`
- `.github/`
- `.env*`
- `.gitignore`
- `apphosting.yaml`
- `firebase.json`
- `.firebaserc`
- `firestore.rules`
- `android-wrapper/`
- `docs/`
- `src/lib/firebase.ts`
- `src/vite-env.d.ts`

## Safe merge flow

1. Extract the new ZIP into a temporary folder outside `QLCT`.
2. Compare `package.json`, `package-lock.json`, `server.ts`, `src/`, `public/`, `index.html`, `tsconfig.json`, and `vite.config.ts`.
3. Copy app UI/source changes into `QLCT`.
4. Reapply these required production patches if the new ZIP overwrote them:
   - `server.ts` must use `process.env.PORT || 3000`.
   - `server.ts` must treat bundled `dist/server.cjs` as production.
   - Google OAuth `/api/auth/url` and `/api/auth/callback` must keep session `state`.
   - `src/lib/firebase.ts` must read Firebase config from `VITE_FIREBASE_*` or Firebase Hosting `/__/firebase/init.json`, not from committed JSON keys.
   - Android wrapper must load `R.string.web_url` with local fallback.
5. Run:

```powershell
npm ci
npm run lint
npm run build
```

6. Rebuild APK after the production URL is known:

```powershell
$env:QLCT_WEB_URL="https://YOUR_FIREBASE_HOSTING_URL"
powershell.exe -ExecutionPolicy Bypass -File .\android-wrapper\build-apk.ps1
```

7. Commit and push to `main`; Firebase Hosting should automatically roll out the new version.

Never copy `firebase-applet-config.json`, `.env.local`, keystores, APKs, or any real API key into GitHub.
