# P2 — Firestore Single Source Report

## VERIFIED_SOURCE

- 9 business datasets dùng centralized realtime registry.
- Firebase-only business writes đi Firestore; full sync là UPSERT/soft-delete có revision guard.
- Automatic editor recovery từ IndexedDB legacy **bị tắt trong Firebase-only**; legacy data phải Import/Validate rõ ràng.
- Custom localforage business array writes mặc định `false` (`VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE=false`).
- JSON không được dùng như realtime source.
- Drive write mặc định `false`; project manager không render Drive status/write card trong Firebase-only.

## Còn giữ vì migration

- `asyncStorage/localforage` vẫn tồn tại cho backup DB, photo temporary binary/outbox và legacy migration tooling.
- localStorage vẫn dùng cho active project ID, UI/device preferences, verified offline role lease và một số compatibility metadata.

Các phần này không được coi là authoritative business database trong RC1.
