# HNL QLTC V6.3.0 RC2 — FULL CI / Firebase-only Root-Cause Audit

Date: 2026-08-26  
Baseline: `HNL-QLTC-V6.3.0-RC1-FULL-SOURCE(1).zip`  
Release artifact label: **V6.3.0 RC2** (core app version remains `6.3.0` from `package.json`)  
Firebase PROD project: **UNCHANGED** — `com-example-qlct-61329`  
Firebase Hosting: **UNCHANGED** — `https://com-example-qlct-61329.web.app/`  
GitHub repo/workflows: **UNCHANGED**  
Push/Deploy/Production migration: **NOT PERFORMED**

## 1. Executive result

RC1 source-level architecture was already substantially Firebase-only, but the audit found remaining paths where Firebase-only operations could still treat legacy IndexedDB/localforage as business source or could create a backup that looked successful while silently missing image binaries.

RC2 fixes these root causes without changing Firebase project, Hosting, Rules, package version, package-lock, or GitHub workflows.

### Release classification

- **Source architecture / source-level Golden:** VERIFIED
- **Lint / package-lock / config syntax:** VERIFIED
- **Full TypeScript compile:** BLOCKED by incomplete dependency installation in this execution environment
- **Firebase Rules emulator behavior:** BLOCKED because `firebase-tools` could not be downloaded/run in this execution environment
- **Security `npm audit`:** BLOCKED by npm registry DNS error `EAI_AGAIN`
- **Production build:** BLOCKED because `npm ci` could not complete; `vite` is consequently unavailable
- **Multi-device DEV runtime Golden:** REVIEW / still requires separate Firebase DEV
- **Drive → Firebase Storage production parity:** BLOCKED until inventory/count/checksum/reference verification

No blocked item is reported as PASS.

## 2. Root-cause fixes

### 2.1 Project Manager manual Cloud sync no longer uploads stale localforage business data

File: `src/components/ProjectManagerModal.tsx`

Before RC2, the manual “Upload Active Project to Cloud” path could rebuild the project from `getStorageDataForScope('active')`, which in RC1 could originate from legacy localforage/IndexedDB. In Firebase-only this could re-upload stale business arrays and recreate a second Source of Truth.

RC2:

- flushes the current project first;
- Firebase-only sync uses the live React state already hydrated/reconciled by Firestore cache/realtime;
- legacy storage-dump behavior remains only outside Firebase-only;
- marker/regression guard: `FIREBASE_ONLY_PROJECT_MANAGER_CLOUD_FIRST`.

### 2.2 Pull-by-sync-code no longer materializes Cloud business arrays into IndexedDB in Firebase-only

File: `src/components/ProjectManagerModal.tsx`

RC2 keeps only lightweight project metadata in localStorage for UI/index compatibility. The nine business collections are not written to localforage when Firebase-only is active; project switching hydrates them from Firestore persistent cache/realtime.

Marker: `FIREBASE_ONLY_PULL_METADATA_ONLY`.

### 2.3 Create / copy project is Cloud-first and template-safe

File: `src/components/ProjectManagerModal.tsx`

RC1 could copy broad `construction_*` local storage data into a new project, including operational datasets not implied by the UI copy option.

RC2 Firebase-only behavior:

- creates the new project in Firestore, not localforage;
- “copy” is explicitly a **template copy**;
- copies material norms, floor/room structure and checklist template;
- resets room/checklist execution/inspection/assignment lifecycle;
- preserves floor IDs/names needed by room references but removes floor-plan image/binary/cloud pointers;
- does **not** copy inventory, work volumes, defects, crew records, teams, or photos;
- lifecycle fields are reset for the new project scope;
- legacy localforage copy path remains only outside Firebase-only.

Marker: `FIREBASE_ONLY_TEMPLATE_CLONE_CLOUD_FIRST`.

### 2.4 Firebase-only JSON backup no longer uses legacy business mirror as its source

Files:

- `src/App.tsx`
- `src/components/ProjectManagerModal.tsx`
- `src/lib/firebase.ts`

RC2:

- active project backup uses live Firestore-derived application state;
- non-active project backup performs server-only Firestore reads (`serverOnly: true`);
- all-project backup no longer uses `getAllStorageData()` as business source in Firebase-only;
- legacy storage-dump path remains available only for legacy runtime compatibility;
- backup refuses to complete if a required project cannot be read from Firestore.

Markers:

- `FIREBASE_ONLY_BACKUP_CLOUD_SOURCE`
- `FIREBASE_ONLY_ALL_BACKUP_CLOUD_SOURCE`

### 2.5 Backup photo index is server-verified before export

Files:

- `src/lib/photoCloudSync.ts`
- `src/App.tsx`
- `src/components/ProjectManagerModal.tsx`

Added `refreshProjectPhotoMetadataFromCloud(projectId)` using `getDocsFromServer()` so a self-contained Firebase-only backup does not depend only on whichever photo metadata happened to be hydrated on the current PC/phone/tab.

If the Firestore photo index cannot be verified, the backup fails closed instead of silently exporting an incomplete archive.

### 2.6 Backup now requires every active photo binary

File: `src/utils/photoStorage.ts`

`getProjectPhotosWithBinary(projectId, requireBinary)` now supports strict backup mode. Backup callers use `requireBinary=true`.

If an active photo has metadata but its binary cannot be loaded from local cache / Firebase Storage / permitted legacy fallback, export throws an error and refuses to create an incomplete backup.

This closes the previous failure mode where JSON could contain photo metadata but omit the actual image binary.

### 2.7 Floor-plan backup is self-contained and fail-closed

Files:

- `src/App.tsx`
- `src/components/ProjectManagerModal.tsx`

For self-contained JSON backup:

- existing Data URLs are preserved;
- Blob URLs are converted to Data URLs;
- Firebase Storage / legacy Drive / legacy Firestore fallback images are hydrated through the existing cloud image loader;
- HTTP image URLs are fetched when applicable;
- if a floor plan claims an image/cloud pointer but binary cannot be resolved to `data:image/...`, backup is refused.

This prevents a backup from containing only a transient Blob URL or unresolved cloud marker.

## 3. Regression / Golden protection added

File: `scripts/stability-gate.mjs`

New source guards verify that future changes retain:

- Project Manager Cloud-first sync;
- metadata-only pull in Firebase-only;
- safe template clone;
- Firebase-only backup source markers;
- server-only reads for non-active projects;
- Firestore server photo-index verification;
- strict photo binary completeness for self-contained backups;
- no accidental template copy of inventory/defects/crew/teams/media.

## 4. Files changed

1. `src/components/ProjectManagerModal.tsx`
2. `src/App.tsx`
3. `src/lib/firebase.ts`
4. `src/lib/photoCloudSync.ts`
5. `src/utils/photoStorage.ts`
6. `scripts/stability-gate.mjs`
7. `HNL-QLTC-V6.3.0-RC2-MASTER-REPORT.md` — added report

No Firebase config, Rules, workflow, package, lockfile, Android URL, or Windows URL file was changed.

## 5. CI / verification matrix

| Gate | Result | Evidence / note |
|---|---|---|
| ZIP baseline / package version | PASS | `package.json` = `6.3.0`; lock root = `6.3.0` |
| `package.json` ↔ `package-lock.json` specs | PASS | Root dependency/devDependency specs match exactly |
| Stability architecture gate | PASS | Includes new Project Manager + backup guards |
| Offline Golden | PASS | Firestore persistent cache/pending-write architecture retained |
| Category Golden | PASS | Deleted-category regression guards retained |
| Firebase-only G1–G20 source matrix | PASS | 20/20 source-level scenarios PASS |
| Legacy migration self-test | PASS | `firebase-only-legacy-audit --self-test` |
| Source lint | PASS | No merge markers/private keys/GitHub tokens; PROD gate retained |
| TS/TSX syntax transpile | PASS | 93 executable `src/**/*.ts(x)` files parsed/transpiled; `.d.ts` excluded from emit check |
| `scripts/*.mjs` syntax | PASS | Node syntax check |
| JSON syntax | PASS | `package.json`, `package-lock.json`, `firebase.json`, `.firebaserc` |
| GitHub workflow YAML syntax | PASS | All 3 workflow YAML files parse |
| Permissive Rules scan | PASS | No `allow ... if true` found in `*.rules` |
| Firebase project/config unchanged | PASS | `.firebaserc`, `firebase.json`, `firestore.rules`, `storage.rules` byte-identical to RC1 baseline |
| GitHub workflows unchanged | PASS | PR / PROD / build workflows byte-identical to RC1 baseline |
| `package.json` + lock unchanged | PASS | Byte-identical to RC1 baseline |
| Hosting/wrapper URL unchanged | PASS | Android/Windows remain `com-example-qlct-61329.web.app` |
| `npm ci` | BLOCKED | Registry/dependency installation stalled in environment; forced stop. `npm audit` independently reports npm registry DNS `EAI_AGAIN` |
| Full `npm run typecheck` | BLOCKED | Partial install left required `@types/*` unavailable; TS2688 missing type-definition errors |
| `npm run test:rules` emulator | BLOCKED | `firebase-tools`/emulator command could not become available; command timed out |
| `npm run security:audit` | BLOCKED | npm registry request failed: `getaddrinfo EAI_AGAIN registry.npmjs.org` |
| `npm run build` | BLOCKED | `vite: not found` because dependency install did not complete |
| PC/mobile rendered runtime check | NOT VERIFIED | Build cannot be produced in this environment; no claim of visual runtime verification |
| DEV multi-user/multi-device Golden | REVIEW | Requires separate Firebase DEV runtime |
| Drive → Storage parity | BLOCKED | Production inventory/count/checksum/reference verification not yet executed |

## 6. Security / secret audit

Static source scan found:

- no private-key PEM blocks;
- no GitHub personal-access-token patterns;
- no service-account JSON/private key file;
- no real `.env` / `.env.local` committed.

Firebase Web API key values are present in the existing browser client configuration / example / workflow / Apps Script. These are Firebase client identifiers, not service-account private keys. RC2 did not add or change them.

## 7. Firebase / Hosting / GitHub preservation

Verified byte-identical to RC1 baseline:

- `.firebaserc`
- `firebase.json`
- `firestore.rules`
- `storage.rules`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `.github/workflows/firebase-hosting-merge.yml`
- `.github/workflows/build.yml`
- `package.json`
- `package-lock.json`

Current PROD identity remains:

- Firebase Project: `com-example-qlct-61329`
- Hosting: `https://com-example-qlct-61329.web.app/`

The temporary `qltc.web.app` idea is not included in RC2.

## 8. Remaining blockers before PROD migration/cutover

1. Run clean `npm ci` in GitHub Actions or a network-enabled Node environment.
2. Require green `typecheck`, Rules emulator behavior tests, security audit and production build.
3. Provision isolated Firebase DEV; do not point DEV workflow to PROD.
4. Run actual PC + phone / 2-user / offline/reconnect Runtime Golden on DEV.
5. Inventory legacy Drive binaries and verify count + checksum/hash + project/entity/photo references.
6. Only after 100% migration verification consider disabling Drive legacy reads / Apps Script dependency.
7. Do not delete Drive data automatically.

## 9. Final decision

**RC2 source changes: VERIFIED at source/static Golden level.**

**FULL CI Certification: NOT YET VERIFIED** because dependency/network-dependent gates are BLOCKED in this execution environment. The correct next certification environment is GitHub Actions (or a machine with working npm registry access), followed by isolated Firebase DEV Runtime Golden. PROD should remain untouched until those gates are green.
