# HNL QLTC – CONTINUATION CHECKPOINT – 2026-09-03 – POST PR53 / PROD #85

## Baseline bắt buộc
- Repository: lengochieu1211-sudo/hnl-qltc
- PROD source commit: `d1c93a9feddaae99fa2f2524240c60e3c4969a09`
- PROD workflow: `Deploy HNL QLTC PROD` run #85 = SUCCESS.
- Main gates trước deploy: Build #406 PASS, Windows EXE #202 PASS, Android APK #206 PASS.
- Không rollback source cũ. Không đổi Firebase Project, Hosting, GitHub repo hoặc R2.

## Các thay đổi gần nhất
- PR #52: sửa lưu/sửa số điện thoại thành viên, chia sẻ contact cùng email giữa các dự án mà user có quyền, làm sạch cảnh báo ảnh pending giả trong Chẩn đoán.
- PR #53: sửa Web Android Zalo fallback, tránh nhảy Google Play; tách editor số điện thoại ra component local để giảm re-render khi gõ.
- PROD #85 đã deploy PR #53.

## Lỗi runtime CHƯA ĐÓNG
- Trên điện thoại Android/Web PROD #85: khi bấm `Sửa số điện thoại` hoặc thêm số, bàn phím bật lên rồi biến mất. Đây vẫn là blocker runtime.
- Hướng điều tra tiếp: tìm nguyên nhân editor bị unmount/mất focus; không tiếp tục vá bằng state cục bộ đơn thuần. Kiểm `SecurityModal` lifecycle, `projects` prop identity, realtime subscription/effect, modal remount, và các handler làm đổi `isOpen`/active project.

## Contact / Zalo
- `memberContacts` tách riêng khỏi `members` để bảo vệ Viewer.
- ADMIN/Owner cập nhật contact; ADMIN/EDITOR đọc; VIEWER bị Rules chặn.
- Cùng email có thể lấy contact mới nhất từ các project mà user hiện tại được phép đọc.
- Web Android ưu tiên Share Sheet thay vì ép deep-link Zalo không chính thức; APK dùng Android native bridge; Desktop Web/EXE dùng fallback web/share/copy.

## Defect – căn hộ / highlight / đội thi công
- `DefectItem` có các trường liên kết: `floorId`, `floorName`, `roomId?`, `teamId?`, `assignedTo`, `x`, `y`.
- `RoomProgressItem` có `id`, `roomName`, vùng highlight (`x/y/width/height` hoặc polygon `points`), `assignedTeam?`, `teamId?`.
- `FloorPlanDefectTab` dùng `isPointInRoom()` để nhận diện pin nằm trong vùng highlight, và `getCandidateTeamsForDefect()` ưu tiên đội của căn/phòng tại vị trí pin.
- Khi tiếp tục audit, phải bảo đảm lúc tạo/sửa Defect: vị trí pin trong highlight được ghi bền vững vào `roomId` và đội được liên kết bằng `teamId` nếu có, không chỉ giữ tên text `assignedTo`. Không làm mất liên kết khi đổi tên căn/đội.

## Quy tắc làm việc qua chat mới
1. Đọc checkpoint này trước.
2. Lấy đúng FULL SOURCE POST PR53 / PROD #85 làm nền.
3. Không rollback, không đổi Firebase/GitHub/R2, không tự deploy PROD nếu chưa được yêu cầu.
4. Sửa nguyên nhân gốc, chạy TypeScript/Lint/Rules/Security/Build + EXE + APK trước merge/deploy.
5. Mọi workflow/script patch tạm phải xóa trước khi merge.
6. Sau mỗi mốc ổn định, cập nhật checkpoint + detailed change history + artifact APK/EXE/FULL SOURCE vào Drive.
