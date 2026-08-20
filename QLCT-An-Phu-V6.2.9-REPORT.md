# QLCT An Phu V6.2.9 - Firestore Storage Quota Hardening

## Root cause confirmed from video/error
Observed error:
`FIRESTORE (12.17.x) INTERNAL ASSERTION FAILED ... QuotaExceededError ... localStorage ... firestore_mutations_* exceeded the quota.`

This is not primarily a weak-network error. A weak connection can keep mutations pending longer and make the issue appear sooner, but the direct failure is Web Storage quota exhaustion.

## Source findings in V6.2.8
1. Firestore initialized `persistentLocalCache` with `persistentMultipleTabManager()`. Multi-tab mode uses localStorage coordination keys including `firestore_mutations_*`.
2. Legacy Defect draft code persisted a full Base64 photo in `construction_defect_draft_photoUrl` in localStorage.
3. `stripHeavyImages()` claimed to remove heavy image data but actually returned all strings unchanged.
4. Legacy localStorage -> IndexedDB migration covered only floor plans, defects, and crew records; other business collections could remain duplicated in localStorage.
5. Quota errors reached ErrorBoundary and offered a generic reset rather than a safe transient-cache recovery.

## V6.2.9 changes
### Firestore persistence
- Removed `persistentMultipleTabManager()`.
- `persistentLocalCache({})` now uses Firebase's single-tab persistent IndexedDB cache.
- Multi-device sync is unchanged; only same-browser multi-tab shared persistence is removed.
- Before Firestore init, if localStorage pressure is high, only transient Firestore coordination / draft cache keys are cleaned.

### Defect photos
- Full Base64 Defect draft photos are no longer written back to localStorage.
- A legacy Base64 draft photo is migrated once to IndexedDB PhotoStorage and the localStorage copy is removed only after migration succeeds.
- Draft text/position/status fields remain small and use safe localStorage writes.

### Legacy storage migration
Expanded migration to IndexedDB for:
- floor plans
- defects
- crew records
- room progress
- checklist
- material norms
- inventory
- work volumes
- teams
- tombstones
- legacy construction_present

The localStorage copy is removed only after IndexedDB verification succeeds.

### Quota recovery
- Added localStorage usage estimation and quota-error detection.
- Added safe transient-cache cleanup.
- ErrorBoundary recognizes storage-quota failures and shows `Dọn cache tạm an toàn & tải lại`.
- The destructive full reset button is hidden for this specific quota error.

### Safe cache compaction
- `stripHeavyImages()` now actually removes large inline data:image/PDF/video/audio payloads only when a localStorage write already failed due pressure.
- Business metadata is preserved.

## Validation
- TS/TSX static parse: 83 source files, 0 syntax diagnostics.
- GitHub workflow YAML parse: PASS.
- package.json/package-lock root dependency/version sync: PASS.
- V6.2.9 version synchronized in package.json, package-lock, appVersion and Firebase Hosting workflows.
- Full `npm ci / npm run lint / npm run build` still requires GitHub Actions or a network-enabled dependency install environment for final production confirmation.

## Expected behavior after update
- The exact `firestore_mutations_* ... QuotaExceededError` crash should no longer occur from Firestore multi-tab coordination.
- Weak/unstable network may show pending/offline sync status but should not crash the app for this reason.
- Existing IndexedDB/Cloud project data is not reset by the fix.
