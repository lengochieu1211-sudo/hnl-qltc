# P13 — Trusted warehouse retry and ledger integrity, 2026-10-26

**Basis:** P12 FULL SOURCE local candidate (SHA256 `3ca34c4ced5a43026393d147daf5f6fc2f65d15b86665f24dc68c7eaecd4b532`), not a GitHub commit. **DEV-only, NOT CERTIFIED, PROD BLOCKED.**

## Root cause / changed behavior

1. Cloud callable responses can be lost after a Firestore transaction commits. Before P13, retrying an `update` with the same `expectedRevision` yielded only `WAREHOUSE_REVISION_CONFLICT`, even if the prior update had already succeeded. P13 recognizes an **exact-payload, one-revision-later replay**, returns `duplicate:true` and the current stock **without writing or incrementing revisions**. Any conflicting/stale modification still fails closed.
2. A legacy voucher may carry a forged/stale `materialKey` that disagrees with the key derived from its item identity. Before P13, the server could debit that untrusted key. P13 refuses this ledger row before touching any balance.
3. DEV-copy balance reconciliation must not treat an explicit forged voucher `materialKey` as authoritative. P13 refuses the entire repair for a mismatching key, including one in a different material, before any writes.

## Isolation and limits

- Changes only the DEV-only server writer (`warehouse-trusted/engine.mjs`, `reconcile.mjs`) and their pure simulated tests; does **not** switch UI to the service, turn on feature flags, deploy Rules, change existing Firebase, GitHub, R2, schema, data, or project IDs.
- Existing P12 sidecar room tooling and generated *never-deployed* DEV-copy candidate Rules remain intact.
- Browser warehouse unit rename under trusted mode already FAILS CLOSED in P12 and remains **not supported** pending a real trusted server writer; release cannot proceed until all voucher/unit/batch/legacy client writers are migrated.
- Production data must be audited for key mismatches before cutover: safe refusal is preferable to silently adjusting a different material's stock.
- Pure simulated tests are not evidence of Firestore transaction behavior, emulator ALLOW/DENY, authentication integration, offline/reconnect, or Windows/Android runtime.

## Release decision

**NO-GO.** `P1-ROOM` and `P1-BALANCE` remain unfixed in the active Rules, verified copy migration and full cutover are outstanding, npm dependencies are unavailable in the current environment, and end-to-end DEV and restore evidence is missing.
