# QLCT An Phú V6.1.1 — Project Recovery Fix

## Lỗi được sửa
Sau V6.1, danh sách project Cloud được siết quá mạnh nên một project local cũ chưa có/đã mất `users/{uid}.projects` index có thể biến mất khỏi danh sách chính và bị mục Bảo trì dữ liệu nhận nhầm là "dự án mồ côi".

Dữ liệu project không bị xóa; các key local vẫn còn.

## Sửa V6.1.1

### 1. Tự tìm lại project Cloud của chủ dự án
`subscribeCurrentUserProjectsRealtime()` nay lấy project từ:
- `users/{uid}.projects`
- lời mời project
- project có `ownerUid == current uid`
- project có `ownerEmail == current Google email`

Nếu tìm thấy project qua owner nhưng thiếu user index, app tự khôi phục `users/{uid}.projects` với role ADMIN.

### 2. Không tự làm mất project local cũ
Khi Cloud sync project list:
- project Cloud vẫn là nguồn chính;
- project local chưa có Cloud nhưng chưa có tombstone xóa sẽ được giữ làm recovery candidate;
- project đã xóa có `construction_deleted_projects` tombstone sẽ không tự sống lại.

### 3. Bảo trì dữ liệu an toàn hơn
- Không tự tick tất cả project local-only để xóa.
- Đổi "dự án mồ côi" thành "dự án cục bộ chưa liên kết Cloud".
- Mỗi project có nút `Khôi phục lên Cloud`.
- Recovery giữ nguyên `projectId`, không clone, không tạo duplicate.
- Recovery upload metadata + dữ liệu nghiệp vụ lên Firestore.
- Recovery xóa tombstone local cũ của đúng project khi người dùng chủ động khôi phục.
- Nút xóa đổi thành `Xóa khỏi máy` và phải tick thủ công.

### 4. Audit
Thêm action `PROJECT_RECOVER_LOCAL`.

## Trạng thái kiểm tra
- TypeScript global `tsc --noEmit`: không phát hiện lỗi code mới sau khi lọc các lỗi dependency do môi trường không có node_modules.
- Không sửa `firestore.rules`.
- Không sửa Primary Drive Bridge.
- Không sửa Android/Desktop wrapper.
- Không đổi projectId.

## Khuyến cáo phục hồi LTIA
1. Không bấm `Xóa khỏi máy`.
2. Có thể tải backup JSON trước như một lớp an toàn.
3. Deploy V6.1.1.
4. Mở Danh sách dự án:
   - nếu Cloud root LTIA vẫn còn, dự án sẽ tự xuất hiện lại;
   - nếu chỉ còn local, vào `Bảo trì dữ liệu` -> `Khôi phục lên Cloud`.
5. Kiểm tra đúng projectId cũ và dữ liệu trước khi xóa bất kỳ cache nào.
