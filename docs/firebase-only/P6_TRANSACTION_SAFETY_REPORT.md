# P6 — Transaction / Concurrency Safety Report

## Kho

Đường mới dùng Firestore `runTransaction`:

- transaction ledger là nguồn gốc;
- `inventory_balances` là aggregate dẫn xuất;
- transaction ID idempotent;
- nhập/xuất cập nhật balance atomically khi online;
- không cho balance âm;
- chỉnh/xóa transaction đi qua transaction service;
- offline OUT cần invariant tồn kho bị **BLOCKED/không cho thao tác** thay vì giả đảm bảo global consistency.

## Các business record khác

- record stamp `revision + updatedAt` mỗi mutation;
- Firestore save path đọc/transaction hoặc Rules monotonic để stale client không overwrite newer revision;
- soft-delete tombstone giữ thời điểm xóa thật, không dùng reconnect time.

## REVIEW trước PROD

- Backfill `inventory_balances` từ toàn bộ ledger legacy và verify số dư.
- Golden đồng thời 2 thiết bị trên Firebase DEV.
- Batch/multi-record operations cần test emulator/runtime với failure injection.
