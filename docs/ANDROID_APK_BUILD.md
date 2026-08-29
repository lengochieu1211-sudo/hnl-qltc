# HNL QLTC Android APK – RC2.2.7

## Web endpoint

Production APK opens:

`https://hnlqltc.web.app/?app=android&v=6.3.0-rc2.2.7`

The WebView keeps a bundled `dist/` copy as an offline/failure fallback.

## GitHub Actions

Workflow: `.github/workflows/android-apk.yml`

The workflow runs the same Stability, TypeScript and source-lint gates before building the web bundle, then builds/signs `HNL-QLTC-Android.apk` on `windows-latest` and uploads it as a GitHub Actions artifact.

For upgradeable production APKs, configure these GitHub Secrets and keep them unchanged between releases:

- `QLCT_ANDROID_KEYSTORE_BASE64`
- `QLCT_ANDROID_KEYSTORE_PASSWORD`
- `QLCT_ANDROID_KEY_PASSWORD`
- `QLCT_ANDROID_KEY_ALIAS`

If the keystore secret is not supplied, the build script generates a development keystore. That is acceptable for testing but should not be used as the long-term production signing identity.

## Local Windows build

Requirements:

- Node.js 22
- JDK 17+
- Android SDK with platform/build-tools installed
- `ANDROID_SDK_ROOT` or `ANDROID_HOME`
- `JAVA_HOME`

Commands:

```powershell
npm ci
npm run verify
npm run build:apk:windows
```

Output:

`HNL-QLTC-Android.apk`

The wrapper takes `versionName` and `versionCode` from `package.json`. The Android URL may be overridden by `QLCT_WEB_URL`; release cache-busting may be overridden by `QLCT_RELEASE_TAG`.
