# HNL QLTC – DETAILED CHANGE HISTORY – 2026-09-03 – POST PR53

## Contact Phase 1–3
- Tạo contact helper/module dùng chung; không xây chat/call server riêng.
- Defect có ContactMenu và nội dung chia sẻ.
- Danh bạ thành viên tách `memberContacts` khỏi `members` để không lộ số cho Viewer.
- Rules: ADMIN/Owner ghi, ADMIN/EDITOR đọc, VIEWER deny.

## Hotfix PR #51
- Sửa payload member contact thiếu `updatedByEmail` làm Firestore deny lưu.
- Đổi fallback Zalo Web khỏi luồng root dễ kẹt splash.

## Hotfix PR #52
- Sửa UI sửa số điện thoại mobile.
- Thêm lookup contact cùng email qua các project user có quyền.
- Làm sạch cảnh báo diagnostic pending ảnh giả khi active metadata đã ready hết.

## Hotfix PR #53
- Web Android không ép mở URL Zalo; ưu tiên Share Sheet để user chọn Zalo đã cài.
- Tách editor số điện thoại sang local component để giảm re-render khi gõ.
- PR #53 PASS Build #405, Windows EXE #201, Android APK #205.
- Merge main commit `d1c93a9feddaae99fa2f2524240c60e3c4969a09`.
- Main certified: Build #406 PASS, Windows EXE #202 PASS, Android APK #206 PASS.
- PROD workflow #85 PASS: Rules + Hosting deployed.

## Runtime issue còn mở
- PROD #85 vẫn còn lỗi bàn phím Android bật rồi biến mất khi sửa/thêm số điện thoại trong `SecurityModal`.
- Không coi Contact phone editor là VERIFIED cho đến khi video/runtime test xác nhận focus ổn định.

## Ảnh / R2 / Diagnostic
- Runtime trước đó đã chứng minh multi-account metadata/R2 ready.
- Không đổi R2 project/gateway.
- Diagnostic được sửa để không giữ cảnh báo pending giả khi ảnh active thực tế `ready` hết.

## Defect / Highlight / Team
- Source hiện có `isPointInRoom(px, py, room)` hỗ trợ polygon và rectangular highlight.
- `getCandidateTeamsForDefect()` tìm `roomAtPos` từ pin và ưu tiên `roomAtPos.assignedTeam`.
- Data model hỗ trợ `DefectItem.roomId`, `DefectItem.teamId`, `assignedTo`, tọa độ pin; `RoomProgressItem` hỗ trợ `id`, `roomName`, `assignedTeam`, `teamId`.
- Việc cần audit tiếp: xác nhận đường save/update Defect luôn persist `roomId` và `teamId` theo pin/đội, không chỉ dùng tên hiển thị.
