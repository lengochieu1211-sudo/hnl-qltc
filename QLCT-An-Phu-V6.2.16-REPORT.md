# QLCT An Phú V6.2.16 – Floor Plan Navigation & Gesture Hardening

Nền kế tiếp V6.2.15. Không đổi Firebase project, Hosting, repo, projectId, schema, Drive mapping, Firestore Rules hoặc dữ liệu.

## Mặt bằng – bộ thao tác chuẩn
- Mobile: kéo 1 ngón trên nền = pan; 2 ngón pinch = zoom; tap đứng yên mới là hành động theo mode; giữ 2 giây chỉ paste Căn/Phòng trong mode Căn/Phòng. Di chuyển >12px hủy long-press/tap.
- Mobile khi đang vẽ hoặc kéo handle `+`/resize: gesture thuộc công cụ/đối tượng, không pan nền.
- PC: wheel = zoom; middle-mouse + drag = pan; Space + left-drag = pan. Giữ nguyên giới hạn zoom cũ 1x..20x.
- PC giữ Ctrl/Cmd+A/C/V, Delete/Backspace, Esc. Arrow keys nudge căn/nhóm 0.2%; Shift+Arrow nudge 1%.
- Kéo ký hiệu Move/+ giữa Căn = di chuyển Căn/nhóm; handle góc = resize/hình học.
- Ctrl/Shift+click vẫn chọn nhiều; Ctrl+A chọn tất cả căn tầng; copy/paste nhóm giữ logic hiện hữu.
- Input/Textarea/Select không bị keyboard shortcut mặt bằng bắt phím.

## Mode an toàn
- Căn/Phòng: tap trống thêm căn đúng tọa độ; long-press 2s mới paste.
- Defect: chỉ tạo sau khi bấm Thêm Defect; không paste Căn bằng long-press.
- Tổng hợp: tap trống không tự đoán; phải chọn rõ Thêm Căn/Phòng hoặc Thêm Defect.
- 3 công cụ Vẽ tự do / Đa giác / Chữ nhật giữ nguyên.
- Nút Thêm Căn/Phòng không sinh tọa độ giả.

## Camera/role
- Giữ hardening V6.2.15: auth hydrate sau camera/resume không tạm hạ role đã xác minh xuống VIEWER; pipeline ảnh nhẹ RAM hiện hữu được giữ.

## Không làm
Không migration, không đổi/xóa/gộp project/folder, không push/deploy.

## Kiểm tra đóng gói
- Static gesture assertions: PASS (7/7)
- package.json ↔ package-lock.json version: PASS 6.2.16
- Workflow YAML: PASS
- TypeScript build: NOT RUN: node_modules absent in clean FULL source
- Không ghi Build PASS giả.
