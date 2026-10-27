# P16 – Trusted warehouse cutover: early fail-closed DEV guards

Baseline: P15 FULL SOURCE ZIP SHA256 `9514a2a741d3cd2c82720835d628489cc4de97d60889280a2cd8ecda3b4a8902`.

## Root cause
P15 prevented generic legacy inventory Cloud writes and rejected spoofed system-origin vouchers at the backend. However, UI still permitted the room auto-issue action and the bulk import path still submitted per-voucher independent transactions. In DEV trusted mode this could yield a failed room issue with confusing UI state or a partial multi-row import on the first later error. A transactional multi-row warehouse writer with server-authoritative provenance is not yet available.

## Minimal change
1. `src/utils/warehouseTrustedCutoverSafety.ts`: shared pure preflight refuses room-auto issues and multi-row import in DEV trusted mode, denies imported system-origin vouchers and stale local revision for a single manual update.
2. `src/App.tsx`: guards are called before per-voucher mutation; existing PROD/legacy behavior unchanged.
3. `src/components/RoomHighlightModal.tsx`: explicitly disable auto-issue button when trusted mode enabled and show explanatory tooltip. Handler independently rejects if invoked despite disabled UI.
4. `scripts/warehouse-trusted-cutover-golden.mjs`: 11 pure tests + source-hook checks.

## Rollout / safety
- NO Firebase/Rules/R2/CI changes; opt-in flag remains disabled by default and DEV-only.
- Do NOT activate DEV trusted writer until server has full room-auto and atomic batch import implementation and Firestore Emulator PASS.
- This patch intentionally **does not** complete P1-BALANCE or P1-ROOM and is NOT a replacement for server-side authentication/ledger transaction verification.
- No data migrations, remote writes, or schema/id changes.
- PROD has not been deployed; `main` is not changed.

## Required before PROD certification
Real Firebase Rules Emulator ALLOW/DENY, transactional room auto issue, atomic bulk import, trusted unit rename, copied DEV migration and READ parity, multi-user/offline/reconnect, Web/Windows/Android Runtime Golden, `npm ci`/Typecheck/Lint/Build, rollback proof and 27 PROD-only commit reconciliation.
