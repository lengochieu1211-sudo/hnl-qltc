# Quản Lý Thi Công An Phú — V6.1.3

## Phạm vi bản vá
Bản vá này nối tiếp trực tiếp source hiện tại, không viết lại ứng dụng và không tự xóa dữ liệu/dự án. Trọng tâm:

1. `createdAt` dự án phải lấy chuẩn từ Firestore và bất biến.
2. Nhận diện dự án trùng tên nhưng `projectId` khác; hỗ trợ so sánh/hợp nhất an toàn.
3. Sắp xếp nhanh nhật ký nhập/xuất kho.
4. Rà logic Trung tâm thông báo tiến độ/checklist/defect và bảng thông báo nổi trên mobile/PC.

## 1. createdAt Cloud chuẩn

### Lỗi cũ
Danh sách dự án có các fallback kiểu `cached.createdAt || remote.updatedAt || Date.now()`. Vì cache PC/điện thoại khác nhau, cùng một `projectId` có thể hiển thị ngày “Khởi tạo” khác nhau.

### Bản V6.1.3
- Khi tạo metadata dự án mới: `projects/{projectId}.createdAt = serverTimestamp()`.
- Khi cập nhật dự án: không ghi lại `createdAt`.
- Realtime project index đọc document Firestore theo đúng `projectId`; ưu tiên `getDocFromServer()`.
- Không dùng `cached.createdAt`, `updatedAt` hay `Date.now()` làm ngày tạo thay thế.
- Nếu dự án cũ thiếu `createdAt`, Admin/Owner chạy migration một lần bằng transaction và `serverTimestamp()`.
- Trong lúc chưa lấy được mốc Cloud, UI hiển thị `Đang chuẩn hóa từ Cloud…`, không bịa ngày.
- Restore/import/download Cloud cũng không còn tự gán ngày hiện tại vào danh sách dự án.
- `firestore.rules` khóa `createdAt` bất biến sau khi đã có; chỉ cho phép legacy document thêm trường này đúng một lần.

> Lưu ý: migration cho dự án legacy xác lập một mốc Cloud chuẩn từ thời điểm migration. Không thể suy đoán chính xác ngày tạo lịch sử nếu document cũ chưa từng lưu trường `createdAt`.

## 2. Dự án trùng tên, projectId khác
- Chuẩn hóa tên để phát hiện nhóm trùng tên kể cả khác dấu/khoảng trắng.
- Card dự án hiển thị ID ngắn, ví dụ `…a72f`, `…5e02`.
- Nhóm trùng có badge `Trùng tên · ID khác`.
- Cảnh báo rõ: không dùng ngày “Khởi tạo” để quyết định xóa.
- Có nút `So sánh & hợp nhất vào ID này` cho Admin.
- Trước khi hợp nhất, app tải dữ liệu Cloud của từng ID và hiển thị số lượng:
  - định mức;
  - nhập/xuất;
  - khối lượng;
  - mặt bằng;
  - defect;
  - căn/phòng;
  - checklist;
  - quân số;
  - đội.
- User chủ động chọn ID nào là dự án chính.
- Hợp nhất dùng logic `smartMergeProjectData` hiện có và lưu vào ID chính.
- **Không tự xóa projectId nguồn** sau khi hợp nhất. Các bản nguồn vẫn tồn tại để đối chiếu PC/điện thoại trước khi quyết định xóa thủ công.

## 3. Sắp xếp nhanh Nhật ký nhập/xuất
Bổ sung các lựa chọn:
- Ngày mới nhất;
- Ngày cũ nhất;
- Vật tư;
- Vị trí/Tầng;
- Người thực hiện.

Sắp xếp chỉ thay đổi thứ tự hiển thị, không sửa dữ liệu gốc. Có tie-break bằng ID để thứ tự ổn định giữa thiết bị khi giá trị bằng nhau.

## 4. Trung tâm thông báo + bảng nổi

### Trung tâm thông báo
- Đổi tiêu đề thành `Trung Tâm Thông Báo Tiến Độ & Defect`.
- Tách bộ lọc nội dung: Tất cả / Tiến độ / Checklist / Defect.
- Giữ bộ lọc hạn: Tất cả / Quá hạn / Hôm nay / Sắp tới 3 ngày.
- Search theo công việc, tầng và hạng mục.
- Không còn nút “hoàn thành” trực tiếp từ thông báo.

### Sửa lỗi logic quan trọng
Thông báo trước đây có thể gọi hàm hoàn thành trực tiếp, dẫn đến:
- khối lượng thực tế bị ép bằng khối lượng kế hoạch;
- checklist có thể thành `passed` mà chưa nghiệm thu;
- defect có thể nhảy thẳng sang `Đã nghiệm thu`.

V6.1.3 loại bỏ hành vi này. Thông báo chỉ **điều hướng tới đúng bản ghi** để người dùng xử lý trong màn hình nghiệp vụ tương ứng.

### Bảng thông báo nổi
- Mobile mặc định thu nhỏ thành badge gọn.
- Đặt cao hơn bottom navigation (`bottom-20`) và giảm `z-index` xuống dưới modal.
- Khi mở rộng: giới hạn `max-height` và cho scroll, tránh che quá nhiều màn hình.
- Chỉ còn `Xem ngay`, điều hướng trước/sau, thu nhỏ/đóng và mở Trung tâm thông báo.

## 5. Phiên bản / deploy
- UI hiển thị phiên bản `V6.1.3`.
- GitHub Firebase Hosting workflows khai báo `VITE_APP_VERSION=V6.1.3`.
- Workflow merge hiện có bước deploy `firestore:rules`, vì vậy khi push/merge source lên nhánh `main`, rule bất biến `createdAt` cũng được triển khai cùng quy trình hiện tại.

## 6. Kiểm tra đã thực hiện
- Parse/transpile TypeScript/TSX cho **67 file source** (không tính file khai báo `.d.ts`): **OK**, không có lỗi cú pháp.
- Kiểm tra YAML hai workflow Firebase Hosting: **OK**.
- Kiểm tra source không còn fallback `createdAt` từ cache / `updatedAt` / `Date.now()` trong project-list logic: **OK**.
- Kiểm tra Cloud create/migration đều dùng `serverTimestamp()`: **OK**.
- Kiểm tra `firestore.rules` giữ `createdAt` bất biến: **OK**.
- Kiểm tra notification UI không còn gọi hàm hoàn thành trực tiếp: **OK**.
- Kiểm tra thuật toán nhận diện tên LTIA có/không dấu và ID ngắn: **OK**.
- Kiểm tra quick-sort nhật ký nhập/xuất tồn tại và không mutate dữ liệu: **OK**.

## 7. Hạn chế kiểm tra trong môi trường hiện tại
ZIP gốc không kèm dependency đã cài. `npm run build` không chạy vì `vite` chưa có; thử cài dependency không hoàn tất do môi trường hiện tại không truy cập npm registry. Vì vậy không tuyên bố full production build đã chạy tại đây. Source đã qua kiểm tra cú pháp TypeScript/JSX độc lập; GitHub Actions của repo vẫn có `npm ci`, typecheck và build khi cập nhật lên GitHub.

## 8. Tiêu chí nghiệm thu sau khi deploy
1. Cùng một `projectId` trên PC và điện thoại phải hiện cùng ngày `Khởi tạo`.
2. Dự án legacy thiếu ngày ban đầu hiển thị `Đang chuẩn hóa từ Cloud…`, sau migration sẽ ổn định và không đổi nữa.
3. Hai LTIA tên giống nhau nhưng ID khác phải cùng xuất hiện với ID ngắn khác nhau; không tự xóa cái nào.
4. Chọn một ID chính → xem bảng so sánh → hợp nhất → ID nguồn vẫn còn.
5. Nhật ký nhập/xuất đổi nhanh 5 kiểu sort trên PC/mobile.
6. Toast mobile không che bottom nav; mở Trung tâm thông báo thì modal nằm trên toast.
7. Bấm thông báo defect/tiến độ/checklist chỉ mở đúng mục, không tự thay đổi trạng thái hoặc số liệu.
