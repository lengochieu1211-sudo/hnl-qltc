# QLCT An Phu v6 - Full Sync / Audit / PDF report

## Source modified
- `src/lib/firebase.ts`
  - Firestore real Google identity is the sync identity; development no longer silently falls back to a mock Firebase project.
  - Cloud project index/realtime helpers, project membership realtime, shared project settings, device registration, append-only activity log and per-record diff audit.
  - `activityLogs` realtime listener uses Firestore metadata so locally queued/offline entries show `PENDING` and server-acknowledged entries show `SYNCED` without modifying old log documents.
- `src/App.tsx`
  - Firestore/invitations are the cross-device project-list source of truth; local project list remains cache/offline compatibility only.
  - Project listener is scoped to the active `projectId`; switching guards prevent old-project callbacks from mutating the new project.
  - Cloud writes include stable IDs/timestamps/device audit context; shared project auto-sync setting is realtime/cloud-backed.
  - Important changes are appended to Cloud activity log after business writes succeed.
- `src/components/PrimaryDriveStatusCard.tsx`
  - Kept the Primary Drive bridge behavior and compacted the status UI while exposing Drive photo/floor-plan coverage.
- `src/components/ProjectManagerModal.tsx`
  - Cloud project creation/rename/delete/member operations use stable project IDs and Google/Firebase identity.
- `src/components/SecurityModal.tsx`
  - Project member list and activity log use live Firestore listeners per selected project.
  - Cloud audit is not deletable from the client. The UI button clears only this device's legacy/local audit cache.
- `src/utils/securityUtils.ts`
  - Legacy/local audit remains an offline cache/fallback and best-effort appends to Cloud when a real Google user/project is available.
- `src/components/ExportPdfModal.tsx`
  - Room origin dot: `0.55 -> 0.23`.
  - Room badge: `1.75 -> 0.95`.
  - Room badge font: `1.85 -> 1.05`.
  - Defect badge: `2.05 -> 1.05`.
  - Defect font: `1.90 -> 1.05`.
  - Collision radii reduced proportionally while retaining leader lines, fan-out/clustering, clamp and legend mapping.
  - Existing long-text wrapping/status-cell behavior retained (`white-space: normal`, `overflow-wrap`, `word-break`, auto-height compatible line-height).
- `firestore.rules`
  - Google-authenticated owner/member/role checks.
  - `ADMIN`, `ENGINEER`, `VIEWER` write restrictions.
  - Unified append-only path: `projects/{projectId}/activityLogs/{logId}`.
  - Audit create is identity-bound (`userUid`, `userEmail` must match Firebase Auth); update/delete denied.
  - `users/{uid}/devices/{deviceId}` writable only by the same UID.
  - Primary Drive config mutation restricted to `lengochieu1211@gmail.com`.

## Audit log structure
Cloud entries include the relevant fields from:
`id, projectId, userUid, userEmail, userName, actorRole, deviceId, deviceName, platform, clientType, browser, appVersion, module, action, recordId, description, changedFields, beforeData, afterData, createdAt, clientTimestamp, syncStatus`.

Large image/Base64/blob fields are omitted/summarized in the audit payload. Photo audit stores IDs/references/metadata rather than embedding image binaries.

The activity log itself is synchronized in realtime per project. A write queued by Firestore while offline appears through the local snapshot and is marked `PENDING`; after server acknowledgement the listener exposes it as `SYNCED`.

## Primary Google Drive
Primary owner remains `lengochieu1211@gmail.com`.
`apps-script/PrimaryDriveBridge` was preserved. Existing photo sync keeps Drive binary + Firestore metadata/reference behavior and does not deliberately move large images back into Firestore documents/JSON.

## Local storage / IndexedDB classification
- Business data/project list stored locally is treated as cache/offline/migration compatibility, not the authoritative cross-device source once Google/Firebase is connected.
- Project membership and project activity log are Firestore realtime sources of truth.
- Shared project auto-sync setting is cloud-backed; local value is a cache.
- Device ID/name, PIN, local file/folder handles, draft UI state and cache stay device-local.
- Existing IndexedDB/local cache mechanisms were preserved for offline use.

## Validation
- TypeScript/TSX parser check: **PASS** - 70 files parsed, 0 syntax diagnostics.
- `npm ci`: **FAIL / environment** - dependency installation did not complete within the available environment/network session, leaving partial type packages.
- `npm run lint`: **FAIL / dependency installation incomplete** - TypeScript reported missing installed type-definition packages such as `@types/node`, `@types/express`, Babel/Express dependency types; this is not a source syntax diagnostic.
- `npm run build`: **NOT CONFIRMED** because a clean `npm ci` could not be completed.
- PDF generation runtime: **NOT TESTED WITH REAL PROJECT DATA**.
- PDF visual inspection A4/A3 portrait/landscape: **NOT TESTED WITH REAL PROJECT DATA**. Source supports A4/A3 and portrait/landscape and marker sizing/wrapping was changed as described above.

## Deployment note
`firestore.rules` is source only until deployed. Deploy Firestore rules separately (for example through the existing Firebase workflow/CLI) together with the web release. Do not deploy the web code without the matching rules when relying on the new role/audit restrictions.
