# HNL QLTC RC2.2.26.4 — Offline Mirror + Minimal Windows UI Report

Date: 2026-09-19
Base: RC2.2.26.3 local candidate, originally based on certified DEV head `22e5d749ca32073712166ba078fa72802f996f52`.
Release tag: `6.3.0-rc2.2.26.4`

## Scope

This candidate keeps the RC2.2.26.3 minimal native Windows chrome and adds a read-only Offline Mirror layer for the currently selected HNL QLTC project. It does not replace Firebase/R2 synchronization and does not create a second Cloud authority.

## Native Windows UI retained from RC2.2.26.3

- Minimal top bar: HNL branding + Sync status + Reload + More + Compact toggle.
- Removed redundant Back / Forward / Home / HNL QLTC navigation buttons.
- Native footer remains hidden by default.
- Sync Center opens as compact summary first; queue/history/retry details use progressive disclosure.
- Technical DesktopBridge controls remain outside the normal user surface.

## Offline Mirror added

- New Settings card: `Dữ liệu offline trên PC`.
- User can explicitly enable `Giữ sẵn offline` per Firebase UID + project ID.
- Initial offline preparation:
  1. Reads current project/business data from Firestore server so the official Firestore persistent cache is refreshed.
  2. Refreshes project photo metadata from Firestore.
  3. Downloads only missing photo originals through the existing authenticated Cloud binary pipeline; `downloadPhotoBlobFromCloud()` writes the original and thumbnail to existing IndexedDB/localforage cache.
  4. Reuses `cacheFloorPlansForOffline()` for floor-plan binaries, including existing shared-storage-path dedupe.
- Photo download concurrency is capped at 3 to avoid saturating R2/network/CPU.
- Requests persistent browser storage when supported (`navigator.storage.persist()`) to reduce cache eviction risk.
- Once enabled, Firestore photo realtime updates prefetch newly Cloud-ready photos in the background. Existing local blobs are skipped.
- Disabling `Giữ sẵn offline` does NOT delete local cache. Cache deletion remains a separate future/advanced operation.

## Authority / security invariants

- Cloud remains authoritative: Firestore business data + existing R2/Firebase binary provider.
- Offline Mirror has no independent `setDoc`, `writeBatch`, direct R2 PUT, or upload authority.
- Existing Firebase Auth, project RBAC, R2 gateway authorization, photo metadata rules and floor-plan rules are unchanged.
- Offline preference is scoped by the authenticated Firebase UID and project ID.
- If Cloud metadata cannot be verified, offline preparation fails closed instead of reporting a false ready state.
- No Firebase project, Hosting site, R2 endpoint/bucket or GitHub repository configuration was changed.

## Files changed from RC2.2.26.3

- `desktop-wrapper/release-tag.txt`
- `scripts/desktop-launcher-golden.mjs`
- `scripts/offline-golden.mjs`
- `src/components/GoogleConfigTab.tsx`
- `src/components/ProjectOfflineMirrorCard.tsx` (new)
- `src/lib/offlineMirrorSettings.ts` (new)
- `src/lib/photoCloudSync.ts`
- `src/lib/projectOfflineMirror.ts` (new)
- `HNL-QLTC-RC2.2.26.4-OFFLINE-MIRROR-MINIMAL-UI-REPORT.md` (new)

## Verification completed locally

PASS:

- `node scripts/offline-golden.mjs`
- `node scripts/source-lint.mjs`
- `node scripts/stability-gate.mjs`
- `node scripts/desktop-launcher-golden.mjs`
- PROD readiness / Auth popup / RBAC / R2 gateway / AI gateway / emulator config gates were already re-run after the Offline Mirror integration and passed; the only later code change was browser-storage persistence request plus release-tag/golden-tag update.
- TypeScript syntax transpile check using global TypeScript 5.8.3: PASS for all new/modified TS/TSX files.
- Source secret scan: PASS through `source-lint`.
- `package.json` / `package-lock.json`: unchanged from RC2.2.26.3.
- Firebase config and `.github/workflows`: unchanged from RC2.2.26.3.

Not locally certified in this Linux container:

- `npm ci` repeatedly times out at the container network/registry layer.
- Therefore full semantic `npm run typecheck`, Vite production build, Firebase Rules emulator behavior and Windows EXE/Setup runtime for this exact RC2.2.26.4 candidate still require the Windows/GitHub runner once a DEV update is explicitly authorized.

## Release safety state

- No GitHub push performed for RC2.2.26.4.
- No merge to `main`.
- No PROD deployment.
- No Firebase/R2 configuration change.
