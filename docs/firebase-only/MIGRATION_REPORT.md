# Legacy -> Firebase-only Migration Report / Runbook

## Không tự động chạy production

RC1 chỉ cung cấp code + audit tooling. Production migration chỉ chạy sau DEV Golden.

## Dry-run tooling

`node scripts/firebase-only-legacy-audit.mjs <backup.json> [report.json]`

Audit phát hiện:

- missing/duplicate ID;
- orphan room-floor;
- orphan defect-room/floor;
- orphan photo;
- deleted category referenced;
- missing `createdAt/deletedAt`;
- timestamp type lỗi;
- missing ownerUid/createdAt project;
- Drive binary references còn phải migrate.

Self-test: PASS.

## Production sequence bắt buộc

1. Export/backup production.
2. Inventory counts per collection + binary list.
3. Dry run migration — không write.
4. Fix blockers / map legacy IDs.
5. Migrate lifecycle fields non-destructively.
6. Backfill warehouse balances and verify ledger sums.
7. Copy Drive binaries to Storage — không delete source.
8. Verify count + checksum + Firestore references.
9. Run Golden multi-device.
10. Switch Storage read as sole binary provider.
11. Keep Drive read fallback during rollback window.
12. Only after parity 100% + retention window: retire Drive/Apps Script.
