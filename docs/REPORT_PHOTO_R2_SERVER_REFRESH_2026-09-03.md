# HNL QLTC – Report Photo / R2 Server Refresh Fix

Baseline: main `e2f34a3c63561605c43c74ec62d1f4d21013be56`

## Runtime evidence
Diagnostic showed two report photos unavailable on the current Android Web device:
- `8cdfa0fe-c26f-4c87-a4f3-d90d4d035caa` — R2 metadata exists but no local binary.
- `c8a748e4-8d7b-4100-9d4d-fc64f2376c3e` — legacy `firestore-fallback` metadata, no local binary.

The runtime log repeatedly attempted legacy migration using cached metadata and reported missing local/legacy binary.

## Root fix
`src/lib/photoCloudSync.ts` now:
1. Uses Firestore SERVER metadata first for online photo synchronization decisions, with cache fallback only when server read is unavailable/offline.
2. Reads legacy Firestore photo metadata and chunk documents from SERVER first while online, then falls back to cache.
3. Preserves the existing authenticated R2 server retry in `downloadPhotoBlobFromCloud`.
4. Preserves offline mode: cache reads still operate when offline.

## Safety
- No Firebase project/config change.
- No R2 gateway/provider change.
- No Firestore schema migration.
- No Firestore Rules relaxation.
- No PROD deployment in this PR.
- No Contact/Zalo feature mixed into this fix.

## Gates
Required before merge: Stability, TypeScript, Lint, Firebase Rules/Emulator behavior, Security audit, production build, APK and EXE packaging.
