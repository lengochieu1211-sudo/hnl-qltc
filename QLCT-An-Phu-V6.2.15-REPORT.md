# QLCT An Phú V6.2.15 – Mobile Camera, Role Resume & Floor Plan Gesture Hardening

Nền: V6.2.14 FULL SOURCE. Không đổi Firebase project/Hosting/repo, projectId, Firestore schema, Drive identity mapping hoặc dữ liệu cũ.

## Thay đổi
- Giữ pipeline ảnh Blob-first/resize sớm hiện có để giảm RAM camera Android; không đưa Base64 ảnh gốc trở lại Firestore.
- Khi camera/app resume mà Auth đang hydrate, không tạm hạ role đã xác minh xuống VIEWER. `auth loading != VIEWER`.
- Mode Căn/Phòng: tap vùng trống mở thêm Căn/Phòng tại đúng tọa độ tap; giữ 2 giây mới arm paste; di chuyển >12px hủy long-press.
- Mode Defect: tap thường không tự tạo Defect; phải bấm `Thêm Defect` rồi tap. Không cho long-press dán Căn/Phòng.
- Mode Tổng hợp: tap vùng trống không tự đoán loại đối tượng. Phải bấm rõ `Thêm Căn/Phòng` hoặc `Thêm Defect`.
- `Thêm Căn/Phòng` không còn sinh tọa độ mặc định 25/25 hoặc rectangle 20/20/30/25; chuyển sang `Chạm vị trí Căn/Phòng…`.
- Giữ 3 công cụ cũ: Vẽ tự do / Vẽ đa giác / Vẽ chữ nhật; bấm trực tiếp là kích hoạt và hủy mode đặt đối tượng khác để chống double-trigger.
- Giữ keyboard desktop hiện tại: Ctrl/Cmd+A, Ctrl/Cmd+C, Ctrl/Cmd+V, Delete/Backspace, Esc, mouse/pan/zoom. Mobile gesture không thay thế desktop.

## Đề xuất UI Defect nên làm tiếp
- Marker chỉ ưu tiên số defect ngắn; label dài chỉ hiện khi tap/hover để không che số phòng.
- Nhiều defect gần nhau dùng badge cụm (ví dụ `3`) rồi tap bung danh sách, thay vì chồng marker.
- Thanh mode gọn luôn thấy trong canvas: `Xem`, `Đặt Defect`, `Vẽ Căn`, `Dán Căn`.
- Filter nhanh Defect theo trạng thái/mức độ/đội phụ trách, nhưng filter chỉ đổi lớp hiển thị, không ghi Firebase.
- Khi `Thêm Defect`, hiện crosshair/preview marker và nút Hủy; chỉ mở form sau khi người dùng đặt vị trí.
- Mobile: toolbar quan trọng sticky, phần nâng cao thu gọn; không để công cụ che canvas.

## Không thay đổi
Không migration dữ liệu; không đổi projectId/canonicalProjectId/aliases; không gộp/xóa 2 project Sân Bay hoặc Mizuki `default`; không thay Chat/Drive mapping/Firestore Rules; không push/deploy.
