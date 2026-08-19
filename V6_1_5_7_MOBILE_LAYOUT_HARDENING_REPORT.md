# V6.1.5.7 – Mobile Layout Hardening

## Mục tiêu
Chỉnh bố cục mobile cho màn hình 360/375/390/412/430 px mà không thay đổi công thức hay giá trị dữ liệu nghiệp vụ.

## Các chỉnh sửa chính
- Danh sách Defect: đổi bộ lọc/sắp xếp rời rạc thành khối **Sắp xếp nhanh** đồng bộ toàn app; tự xuống dòng trên màn hình hẹp; nút chiều sắp xếp hiển thị bằng từ dễ hiểu (Mới nhất/Cũ nhất, Gần nhất/Xa nhất, Tăng dần/Giảm dần); có nút Mặc định.
- Danh sách Defect: mã ID dài chỉ rút gọn ở phần hiển thị; ID thật không đổi. Ngày deadline/ngày hoàn thành hiển thị DD/MM/YYYY.
- Thanh điều hướng dưới: thêm `safe-area-inset-bottom`; nội dung app chừa đúng khoảng cho thanh home/gesture.
- Header Mặt bằng: trên mobile chuyển các nút Cập nhật bản vẽ / Thêm Căn / Phòng / Thêm Defect sang lưới 2 cột, tránh tràn ngang.
- Danh sách tầng: ẩn nhóm icon sửa/nhân bản/xóa/di chuyển trên mobile; thao tác nâng cao thực hiện qua nút **Tùy chỉnh tầng**. Desktop vẫn giữ nút nhanh.
- Canvas Mặt bằng: chiều cao mobile theo `dvh` với min/max; điện thoại thấp và cao đều cân đối hơn.
- Popup thao tác trên bản vẽ: clamp vị trí theo mép canvas để không bị cắt khi chạm sát mép.
- Banner sau khi vẽ vùng: nhóm nút tự wrap trên màn hình nhỏ.
- Modal Thống kê Căn / Phòng & Defect: header wrap, nút đóng không bị chèn; modal tôn trọng safe-area trên/dưới.
- Sửa thiếu helper `getNextAvailableQuickRoomName()` phát hiện qua typecheck tĩnh; tên tạo nhanh không trùng trong tầng.

## Kiểm tra kỹ thuật
- 74 file TS/TSX được parse/transpile bằng TypeScript 5.8.3: 0 lỗi cú pháp.
- `tsc --noEmit`: không còn lỗi TypeScript nội bộ sau khi loại nhóm lỗi do môi trường audit không có `node_modules`/Node type declarations.
- Version workflow/env: V6.1.5.7.
- Giá trị nghiệp vụ và công thức không bị thay đổi bởi patch mobile này.

## Lưu ý kiểm tra sau deploy
1. Test 360/375/390/412/430 px.
2. Mặt bằng tổng hợp: 3 nút hành động không tràn.
3. Danh sách Defect: Sắp xếp nhanh tự wrap và không đè dòng “Chọn tất cả Defect”.
4. Chạm gần 4 góc canvas: popup thao tác vẫn nằm hoàn toàn trong khung.
5. Android gesture navigation/iPhone safe-area: thanh bottom không che nội dung.
6. Modal thống kê đội: badge + định biên + nút đóng không chồng nhau.
