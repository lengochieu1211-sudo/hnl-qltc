# HNL QLTC V6.3.0 RC1 — P0 Architecture / Single Source of Truth Audit

Baseline duy nhất: `HNL-QLTC-V6.2.28-FULL-SOURCE.zip` trong chat hiện tại.

## Kết luận kiến trúc

Baseline V6.2.28 có nhiều persistence path cùng tồn tại: Firestore realtime, localforage/IndexedDB business arrays, localStorage metadata/cache, Google Drive + Apps Script cho binary, legacy Firestore chunks và JSON/Drive backup. Đây là nguyên nhân hệ thống của các lỗi đã gặp: dữ liệu cũ sống lại, ảnh lệch thiết bị, offline blank/Viewer, ghost category và vòng lặp upload/trash.

V6.3.0 RC1 chuyển runtime theo nguyên tắc:

- **Firestore**: nguồn nghiệp vụ duy nhất.
- **Firestore persistent local cache**: offline database chính thức; pending writes do Firebase SDK sở hữu.
- **Firebase Storage**: nơi ghi duy nhất cho binary mới (ảnh/mặt bằng/PDF/file).
- **Firebase Auth**: identity/role authority; offline chỉ dùng lease đã xác minh cho đúng identity + projectId.
- **GitHub**: source/build/deploy, không có dữ liệu công trình runtime.
- **JSON**: backup/export/import thủ công, không realtime.
- **Drive/Apps Script**: không ghi mới trong Firebase-only; chỉ giữ read-only legacy fallback/migration cho tới khi kiểm chứng count/checksum/reference.
- **Custom localforage business arrays**: không được ghi trong Firebase-only; chỉ đọc như migration candidate khi Firestore cache chưa có dữ liệu.

## Static inventory sau migration RC1

Static scan hiện còn nhiều reference legacy vì chúng phải tồn tại cho migration/backup, không có nghĩa chúng còn là source runtime:

| Công nghệ | Files tham chiếu | Số reference xấp xỉ | Ý nghĩa RC1 |
|---|---:|---:|---|
| Firestore API | 7 | 148 | runtime canonical + offline pending |
| localStorage | 24 | 303 | UI/device prefs, identity/role lease, legacy migration metadata |
| localforage/IndexedDB | 11 | 249 | photo temporary/outbox, backup DB, migration compatibility; business write mặc định OFF |
| Drive/Apps Script | 16 | 406 | legacy fallback/migration code, UI ẩn trong Firebase-only |
| JSON | 23 | 179 | backup/import/export/serialization |
| Base64/data URL | 17 | 86 | legacy/import/camera transitional paths; không lưu Firestore binary mới |

## Blockers phát hiện

1. **Drive binary production chưa inventory/checksum** → chưa được xóa fallback/Apps Script.
2. **Firebase DEV riêng chưa provision** → multi-device runtime Golden chưa VERIFIED.
3. **Rules emulator chưa chạy được trong môi trường build hiện tại** do không tải được `firebase-tools` → source/static rules checks PASS nhưng behavior runtime REVIEW.
4. **Kho legacy chưa backfill `inventory_balances`** → transaction engine đã có/wired, nhưng cutover tồn kho production vẫn REVIEW.
5. **Một số relationship legacy vẫn chứa text/name** → ID normalization tiếp tục trong migration; không batch-xóa text legacy trước khi verify references.

## Quy tắc không được phá

- Không auto-import legacy localforage vào live state trong Firebase-only.
- Không hard-delete 9 business datasets từ client.
- Không write ảnh mới sang Drive/Firestore chunks/Base64.
- Không dùng localStorage role/member cache để cấp quyền Cloud.
- Không để DEV fallback sang Firebase PROD.
- Không deploy PROD tự động từ push main; PROD phải manual-gated sau DEV Golden.
