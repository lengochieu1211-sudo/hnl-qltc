# P3 — Offline / Reconnect Report

## Luồng RC1

1. Online: Auth + server role verification -> Firestore realtime -> persistent cache.
2. Offline startup: exact identity + projectId verified lease -> hydrate business state từ Firestore cache.
3. EDITOR/ADMIN offline: mutation được stamp revision/timestamp và **queue ngay vào Firestore SDK persistent pending writes**; không cần custom outbox business database.
4. VIEWER offline: chỉ đọc.
5. Reconnect: Firebase SDK gửi pending; Rules/revision quyết định. Pending bị stale/denied không tự overwrite Cloud; UI chuyển conflict/error và realtime hòa giải.

## Guard quan trọng

- Không tháo quyền user thành VIEWER chỉ vì network unavailable.
- Không auto-import legacy IndexedDB vào live state.
- Offline autosave không còn phụ thuộc `cloudInitialReady`; nó chỉ cần cache Firestore + role lease đúng identity/project.
- Offline mutation timer = 0ms debounce để đưa write vào SDK persistence sớm nhất sau state update.
- UI pending counter là telemetry, không phải persistence queue.

## Test source

- `offline-golden.mjs`: PASS.
- `firebase-only-golden.mjs` G3/G4/G5/G19: PASS source-level.

## REVIEW

- Cần Firebase DEV riêng để test thực tế reload offline trên Chrome/Android/Windows và conflict giữa hai thiết bị.
