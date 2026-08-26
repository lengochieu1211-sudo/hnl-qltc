# V6.3.0 RC1 Golden Test Report

## Source-level Golden Matrix

| # | Case | Status |
|---:|---|---|
| 1 | 2 user sửa cùng project / revision guard | VERIFIED_SOURCE |
| 2 | PC + điện thoại dùng shared core/version | VERIFIED_SOURCE |
| 3 | Offline edit -> Firestore pending -> reconnect | VERIFIED_SOURCE |
| 4 | Mất mạng ở mặt bằng không blank | VERIFIED_SOURCE |
| 5 | Reload offline từ Firestore persistent cache | VERIFIED_SOURCE |
| 6 | Xóa hạng mục không ghost trên mặt bằng | VERIFIED_SOURCE |
| 7 | Restore hạng mục explicit lifecycle | VERIFIED_SOURCE |
| 8 | Xóa căn soft-delete/tombstone | VERIFIED_SOURCE |
| 9 | Restore căn không overwrite newer edit | VERIFIED_SOURCE |
| 10 | Defect + ảnh -> Storage | VERIFIED_SOURCE |
| 11 | Photo metadata realtime device B | VERIFIED_SOURCE |
| 12 | Viewer không ghi | VERIFIED_SOURCE / RULES_RUNTIME_REVIEW |
| 13 | Editor không đổi quyền | VERIFIED_SOURCE / RULES_RUNTIME_REVIEW |
| 14 | Admin thêm user | VERIFIED_SOURCE / RULES_RUNTIME_REVIEW |
| 15 | Nhập kho atomic | VERIFIED_SOURCE |
| 16 | Xuất kho atomic | VERIFIED_SOURCE |
| 17 | Offline OUT không giả đảm bảo tồn | VERIFIED_SOURCE |
| 18 | Import backup không realtime source | VERIFIED_SOURCE |
| 19 | Reconnect không nhân đôi ID | VERIFIED_SOURCE |
| 20 | Legacy dry-run trước migration | VERIFIED_SOURCE |

`npm run test:stability`: PASS toàn bộ source Golden.

## External verification

- Multi-device Firebase DEV: **REVIEW** — DEV project chưa provision.
- Drive->Storage checksum/count parity: **BLOCKED**.
- Firestore/Storage emulator rules behavior: **REVIEW** — toolchain download timeout trong môi trường hiện tại.

Không mục external nào được gắn VERIFIED chỉ vì source test/build.
