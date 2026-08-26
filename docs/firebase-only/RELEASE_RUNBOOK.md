# DEV / PROD Release Runbook

## DEV

1. Tạo Firebase project riêng `HNL QLTC DEV`.
2. Enable Google Auth, Firestore, Storage, Hosting.
3. Tạo Web App DEV, lấy `VITE_FIREBASE_*` vào GitHub DEV secrets/variables.
4. Không dùng `com-example-qlct-61329` cho DEV. Workflow có isolation gate chặn.
5. Deploy Firestore Rules + Storage Rules + Hosting lên DEV.
6. Chạy Rules emulator/behavior tests.
7. Seed test data, không copy raw PROD ngoài migration fixture đã ẩn dữ liệu nhạy cảm.
8. Chạy 20 Golden cases trên PC + Android + Windows.
9. Chỉ khi DEV Golden xanh mới cho phép PROD migration/deploy.

## PROD

1. Tạo backup/export production và ghi counts.
2. Chạy migration dry-run + binary inventory.
3. Xác nhận rollback snapshot.
4. GitHub workflow PROD dùng `workflow_dispatch` + confirmation `DEPLOY-PROD`.
5. Deploy Rules trước/đồng bộ với client cutover theo runbook.
6. Deploy Storage Rules + Hosting.
7. Migrate non-destructive; không xóa Drive source.
8. Verify counts/references/checksum.
9. Golden production smoke với 2 user/2 device.
10. Giữ rollback window và Drive read fallback.

## Blaze / Budget Alert

Firebase Storage/Hosting/Firestore production có thể cần Blaze tùy quota/chức năng. Khi nâng Blaze:

- Google Cloud Console -> Billing -> Budgets & alerts -> Create budget.
- Chọn đúng billing account/project PROD.
- Đặt budget nhỏ ban đầu theo mức sử dụng thực tế.
- Alert thresholds gợi ý: 50%, 80%, 100%.
- Bật email billing admins/project owners.
- Theo dõi Firestore reads/writes, Storage bytes/egress và Hosting bandwidth.
- Budget alert **không phải hard spending cap**; cần quota/rule/app guard để hạn chế bất thường.

## Rollback nếu migration PROD lỗi

1. Dừng rollout/cutover; không chạy purge.
2. Re-deploy previous known-good Hosting build + Rules tương thích.
3. Giữ Drive legacy read fallback ON.
4. Không copy ngược dữ liệu mới bằng JSON tự động.
5. So sánh backup counts/references với Firestore hiện tại.
6. Restore chỉ record/binary bị ảnh hưởng theo migration manifest.
7. Nếu Storage copy lỗi, giữ Drive source và rollback Firestore pointers tới manifest đã xác minh.
8. Chạy Golden smoke trước khi mở lại write rộng rãi.
