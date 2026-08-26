# HNL QLTC V6.3.0 RC2.1 — GitHub Actions Typecheck Repair

Baseline: `HNL-QLTC-V6.3.0-RC2-FULL-SOURCE.zip`

GitHub repository checked: `lengochieu1211-sudo/hnl-qltc`

GitHub commit checked: `4ad9fbceba0aa620e031663121ba22ec1eef7aea` — `V6.3.0 RC2 – Full CI Certification`

GitHub Actions run: Build #73 / run `32959449282`.

## Actions result before repair

- Checkout: PASS
- Source root: PASS
- Node 22 setup: PASS
- `npm ci`: PASS — 385 packages installed
- Stability / Golden: PASS
- TypeScript: FAIL
- Lint: SKIPPED after TypeScript failure
- Firebase Rules check: SKIPPED
- Security audit: SKIPPED
- Build: SKIPPED
- PROD deploy: NOT RUN (production deploy workflow is manual-gated)

`npm ci` reported 2 HIGH vulnerabilities, but the configured production security gate did not execute because TypeScript stopped the job first. Do not classify the security gate as PASS until Actions reaches it.

## Root causes repaired

### 1. `src/components/ProjectManagerModal.tsx`
`Array.from(new Set(targetIds.filter(Boolean)))` was inferred as `unknown[]` in the full GitHub TypeScript environment. The project IDs are now explicitly narrowed to non-empty strings and the Set is typed as `Set<string>`.

This resolves the TS2345 errors at the backup/Firestore project ID calls and preserves the Firebase-only Cloud/live-state backup behavior.

### 2. `src/utils/securityUtils.ts`
Added `BACKUP_IMPORT_FIREBASE_ONLY` to the `AuditLogEntry.action` union. The runtime already logs this action during Firebase-only backup import; the type definition was stale.

### 3. `src/components/WarehouseTab.tsx`
Changed `handleSubmit` to `async` because it awaits `onUpdateInventory` / `onAddInventory`. This fixes TS1308 without changing warehouse transaction semantics.

## Regression checks after repair

- Stability Gate: PASS
- Offline Golden: PASS
- Category Golden: PASS
- Firebase-only G1–G20: PASS
- Legacy migration self-test: PASS
- Source Lint: PASS

Full local TypeScript/build remains environment-blocked because this runtime cannot complete npm dependency download. The original GitHub runner installed dependencies successfully, so the authoritative next verification is a new GitHub Actions run with RC2.1.

## Files changed in RC2.1

- `src/components/ProjectManagerModal.tsx`
- `src/components/WarehouseTab.tsx`
- `src/utils/securityUtils.ts`
- `HNL-QLTC-V6.3.0-RC2.1-ACTIONS-FIX-REPORT.md`

## Next gate

Push RC2.1 to the existing repository and run Build again. Required sequence:

`npm ci -> Stability -> TypeScript -> Lint -> Firebase Rules -> Security Audit -> Build`

Do not classify RC2.1 as FULL CI VERIFIED until every step above is green. Do not run the manual PROD deployment workflow as part of this certification.
