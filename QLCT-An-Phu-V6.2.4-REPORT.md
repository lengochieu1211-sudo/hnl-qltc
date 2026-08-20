# QLCT An Phú V6.2.4 – Mobile Camera Memory Hardening

## Mục tiêu
Khắc phục lỗi trên Android/điện thoại: mở Camera để chụp ảnh Defect hoặc ảnh nhật ký/quân số, quay lại ứng dụng bị giật mạnh, đứng hoặc WebView/app tự thoát.

## Nguyên nhân đã xác nhận trong source V6.2.3

1. `compressImage()` gọi `createImageBitmap(blob)` ở **độ phân giải gốc** chỉ để đọc width/height rồi mới tạo bitmap thu nhỏ.
   - Ảnh camera 48 MP khi decode RGBA có thể cần khoảng 180–200 MB RAM cho một bitmap.
   - Sau đó còn có bitmap resize, canvas và Base64 nên Android có thể kill WebView vì thiếu RAM.
2. `savePhotoAttachment()` tạo Base64 lớn cho ảnh chính, đổi Base64 ngược thành Blob, sau đó lại dùng Base64 để tạo thumbnail.
3. Ảnh mới được giữ bằng full data URL trong React state để preview tức thì dù UI chỉ cần thumbnail.
4. `PhotoAttachmentPicker` tự reload lại ảnh ngay sau optimistic update và còn có một reload 50 ms sau đó.
5. Sự kiện `qlct-photo-attachments-changed` không scope đủ chặt: thêm ảnh cho một Defect có thể làm nhiều Defect/PhotoPicker khác reload thumbnail.
6. `getPhotoDataUrl()` trả `blob:` URL nhưng một số component không revoke URL cũ khi reload/unmount, gây tăng RAM theo thời gian.
7. Cloud photo sync chạy khá sớm sau khi ảnh vừa được xử lý, có thể tranh CPU/RAM với UI trên điện thoại.

## Thay đổi V6.2.4

### 1. Nén ảnh Blob-first
File: `src/utils/imageCompressor.ts`

- Thêm `compressImageToBlob()`.
- Đọc kích thước JPEG/PNG/WebP từ một header slice tối đa 512 KiB, không decode bitmap gốc.
- Với Android/Chromium: gọi `createImageBitmap()` **một lần với resizeWidth/resizeHeight ngay từ đầu**.
- Không còn gọi `createImageBitmap(blob)` full-resolution chỉ để lấy kích thước.
- Canvas xuất bằng `toBlob()` thay vì `toDataURL()` trong pipeline chính.
- Bitmap/canvas/object URL được cleanup ngay sau xử lý.
- `compressImage()` vẫn giữ API data URL cho các caller cũ, nhưng nội bộ resize Blob-first trước.

### 2. Photo storage không giữ Base64 ảnh chính
File: `src/utils/photoStorage.ts`

- Ảnh chính sau nén được lưu thẳng dạng Blob vào IndexedDB/localforage.
- Thumbnail 320 px được tạo từ Blob đã nén.
- React chỉ nhận thumbnail nhỏ cho preview tức thì.
- Full image chỉ được load khi người dùng thật sự bấm xem/chỉnh.
- `cachePhotoBlob()` và `updatePhotoAttachmentBlob()` dùng Blob-first.

### 3. Chặn reload trùng của PhotoAttachmentPicker
File: `src/components/PhotoAttachmentPicker.tsx`

- Mỗi picker có `originId` riêng.
- Picker bỏ qua event do chính nó vừa phát ra.
- Bỏ reload nền 50 ms ngay sau optimistic update.
- Event chỉ reload picker đúng `entityType + entityId + category`.
- Có sequence guard để request load cũ không ghi đè request mới.

### 4. Thu hồi blob URL để chống memory leak
Files:
- `src/components/PhotoAttachmentPicker.tsx`
- `src/components/FloorPlanDefectTab.tsx`

- Revoke thumbnail `blob:` URL cũ khi reload.
- Revoke URL khi component unmount.
- Revoke full gallery URLs khi đóng viewer.
- Revoke URL ảnh chỉnh sửa khi đóng Image Editor.

### 5. Defect photo event được scope theo đúng Defect
Files:
- `src/utils/photoStorage.ts`
- `src/lib/photoCloudSync.ts`
- `src/components/FloorPlanDefectTab.tsx`

- Cloud event mang danh sách entity thực sự thay đổi.
- Defect A thay ảnh không còn buộc mọi Defect B/C/D reload thumbnail.
- Initial cloud sync vẫn cập nhật đúng các entity có thay đổi.

### 6. Giãn cloud upload trên mobile
File: `src/App.tsx`

- Desktop giữ debounce khoảng 700 ms.
- Mobile dùng khoảng 1.8 s để UI/camera có thời gian giải phóng bitmap/canvas trước khi chạy upload cloud.
- Cloud upload vẫn tuần tự như trước, không mất đồng bộ.

### 7. Version
- `package.json`: 6.2.4
- `package-lock.json`: 6.2.4 ở root package
- `src/config/appVersion.ts`: `V6.2.4 – Mobile Camera Memory Hardening`

## Tương thích dữ liệu
- Không đổi schema ảnh hiện tại.
- Không xóa ảnh cũ.
- Không đổi photoId / defectId / crewRecordId.
- Không đổi Firebase project, Firestore paths, Drive bridge hay rules.
- Ảnh cũ dạng Blob/Data URL vẫn đọc được.
- Backup cũ vẫn tương thích.

## Kiểm tra đã chạy

- Static transpile/parsing toàn source: **83 TS/TSX files, 0 syntax errors**.
- `tsc` riêng `imageCompressor.ts + imageQualitySettings.ts`: **PASS**.
- `npm ci`: môi trường kiểm tra timeout sau 90 giây nên chưa thể xác nhận Vite production build ở container này.

## Kỳ vọng sau sửa trên Android

- Quay lại app sau khi chụp ảnh 12–48 MP không còn cần decode bitmap gốc chỉ để lấy kích thước.
- Peak RAM giảm rất mạnh.
- Ảnh preview xuất hiện từ thumbnail nhỏ.
- Thêm một ảnh Defect không còn tạo hàng loạt reload ở các card ảnh khác.
- Dùng lâu/xem nhiều ảnh giảm tích lũy `blob:` URL không được giải phóng.

## Rủi ro còn lại / cần test thực tế

1. Một số Android WebView rất cũ không hỗ trợ `createImageBitmap` resize options; code có fallback nhưng fallback có thể dùng nhiều RAM hơn. Cần test trên máy đang gặp lỗi.
2. Ảnh HEIC/HEIF vẫn chủ động từ chối vì khả năng decode khác nhau theo trình duyệt.
3. Floor-plan cloud hydration hiện còn giữ data URL bản vẽ trong state; đây không phải pipeline Camera nhưng vẫn là nguồn RAM nền khi một dự án có nhiều bản vẽ rất lớn.
4. Xuất Backup_TatCa kèm toàn bộ ảnh vẫn có thể tốn RAM vì JSON bắt buộc chứa Base64; nên tránh xuất backup ảnh rất lớn trên điện thoại yếu và ưu tiên PC khi cần full backup.

## Test thực tế đề nghị sau deploy

1. Mở Defect -> Chụp ảnh trước sửa bằng camera sau -> quay lại app -> ảnh phải hiện, app không thoát.
2. Chụp liên tiếp 3 ảnh Defect.
3. Chụp 3 ảnh Nhật ký quân số.
4. Chuyển Defect A -> B -> A và xem thumbnail.
5. Mở ảnh full-screen rồi đóng 5–10 lần.
6. Tắt/mở mạng khi vừa chụp ảnh, kiểm tra ảnh local vẫn còn và cloud sync sau đó.
7. Thử ảnh camera độ phân giải cao nhất của máy.
