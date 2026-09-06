# HNL QLTC – Health Center / Hệ thống, Chẩn đoán & Audit

## Mục tiêu

Health Center là nguồn kết quả duy nhất cho kiểm tra kỹ thuật và dữ liệu nghiệp vụ. Không duy trì hai engine Audit độc lập giữa Cài đặt và AI. AI chỉ phân tích/diễn giải trên snapshot Health Center hiện tại; không tự sửa dữ liệu.

## Nguyên tắc an toàn

1. READ + ANALYZE + EXPORT mặc định.
2. Không tự sửa ERROR/REVIEW.
3. Chỉ gắn nhãn `SAFE_REPAIR` khi cách sửa là duy nhất, có thể chứng minh từ durable ID và không làm thay đổi ý nghĩa nghiệp vụ.
4. Mọi repair phải theo Preview -> Backup -> Confirm -> Apply -> Re-audit.
5. Không cộng lẫn đơn vị khác nhau.
6. Không cộng headcount sáng + chiều + tối thành số người duy nhất.
7. Không suy diễn dữ liệu lịch sử từ snapshot hiện tại.
8. Mọi issue phải có evidence và metadata nghiệp vụ đủ để định vị: ngày, đội, tầng, căn/phòng, hạng mục khi nguồn có các trường này.

## Phân loại issue

- `ERROR` – mâu thuẫn hoặc tham chiếu hỏng có thể kết luận chắc chắn.
- `WARNING` – dữ liệu legacy/thiếu metadata/rủi ro có thể ảnh hưởng báo cáo.
- `REVIEW` – có khả năng hợp lệ về nghiệp vụ, cần người dùng xác nhận.
- `INFO/RECOMMENDATION` – đề xuất tối ưu, không tính vào lỗi dữ liệu.

UI phải tách thêm action class:
- `SAFE_REPAIR`
- `NEEDS_CONFIRMATION`
- `MANUAL_FIX`
- `READ_ONLY`

## A. Technical Diagnostics

### A1. Runtime / Build
- App version, build SHA, build date.
- Web/APK/EXE target đúng DEV/PROD.
- Service Worker/cache version lệch build.
- Online/offline state.
- Runtime error log, unhandled exceptions, repeated retry loops.

### A2. Firebase / Auth / Realtime
- Auth user có hợp lệ.
- projectId hiện tại và quyền user.
- Firestore read/write capability theo role.
- Realtime listener alive / reconnect.
- pending writes / offline queue.
- dữ liệu cache quá cũ so với cloud khi online.

### A3. R2 / ảnh
- R2 gateway reachable.
- metadata ảnh có object/path tương ứng.
- ảnh cloud marker nhưng không tải được.
- imageRevision / imageCloudRevision lệch bất thường.
- object orphan hoặc metadata orphan (nếu backend API cho phép kiểm tra an toàn).

### A4. Storage / Offline
- IndexedDB/local cache readable.
- sync queue stuck.
- backup/autosave folder khả dụng trên Android.
- storage quota gần đầy.

## B. Business Data Audit

### B1. Project / ID integrity
- Duplicate active ID trong từng collection.
- durable ID thiếu khi có thể resolve duy nhất.
- tham chiếu tới entity đã mất.
- floorId/teamId/roomId/name mismatch.

### B2. Tầng / căn / tiến độ
- ROOM_FLOOR_NOT_FOUND.
- ROOM_TEAM_NOT_FOUND.
- ROOM_SUBITEM_TEAM_NOT_FOUND.
- floorName snapshot lệch floorId hiện tại.
- `Đã hoàn thành`/`Đạt nghiệm thu` nhưng sub-item hoặc frame/board còn `Chưa làm/Đang làm` -> REVIEW/ERROR tùy quan hệ xác định.
- inspection đạt nhưng các inspection con chưa đạt -> REVIEW.
- target date không hợp lệ hoặc trước createdAt -> WARNING/ERROR.
- polygon/geometry bất thường (tọa độ ngoài 0-100, width/height <= 0, polygon rỗng) -> WARNING/ERROR.

### B3. Defect
- floorId/roomId/teamId broken hoặc mismatch.
- pin nằm ngoài room đang liên kết.
- assignedTo và teamId mâu thuẫn.
- `Mới phát hiện`/`Đang sửa` nhưng có `completedAt` -> ERROR `DEFECT_OPEN_WITH_COMPLETED_AT`.
- `Đã khắc phục/Đã nghiệm thu` nhưng thiếu completedAt -> WARNING `DEFECT_CLOSED_WITHOUT_COMPLETED_AT`.
- completedAt trước createdAt -> ERROR.
- dueDate trước createdAt -> WARNING/ERROR tùy dữ liệu.
- afterImageUrl có nhưng status vẫn `Mới phát hiện` -> REVIEW.
- status đã nghiệm thu nhưng thiếu ảnh sau khi quy trình dự án yêu cầu ảnh sau -> REVIEW, không hard-code nếu project chưa bật yêu cầu.

### B4. Quân số
- CREW_DATE_INVALID.
- CREW_COUNT_INVALID / NOT_INTEGER.
- CREW_TEAM_ID_MISSING / NOT_FOUND / ID_NAME_MISMATCH / AMBIGUOUS.
- CREW_FLOOR_NOT_FOUND / FLOOR_ID_NAME_MISMATCH.
- workerCount khác headcount lớn nhất của ca -> REVIEW.
- workersInside + workersOutside khác workerCount -> REVIEW.
- exact duplicate -> WARNING nguy cơ double count.
- cùng đội/ngày/ca có headcount xung đột -> REVIEW.
- taskDescription rỗng -> WARNING `CREW_TASK_EMPTY`.
- chuỗi nhiệm vụ có nhóm `()` rỗng -> WARNING `CREW_TASK_DETAIL_EMPTY`.
- floorWorks tham chiếu floorId không tồn tại -> ERROR.
- floorWorks trùng tầng/hạng mục/subitem -> WARNING/REVIEW.

### B5. Khối lượng
- planned/actual/unitPrice âm hoặc NaN -> ERROR.
- actual > planned -> REVIEW/WARNING, vì có thể phát sinh hợp lệ nhưng cần xác nhận.
- status `Đã hoàn thành` nhưng actual < planned -> REVIEW.
- planned = 0 nhưng actual > 0 -> REVIEW.
- unit rỗng/không canonical -> WARNING.
- floorId/floorIds không tồn tại.
- cùng workCategory bị duplicate semantic record -> WARNING.
- không cộng tổng khác đơn vị; mọi tổng phải group theo unit.

### B6. Vật tư / định mức / kho
- inventory quantity âm/NaN -> ERROR.
- transaction `out` vượt tồn kho tại thời điểm tính theo ledger -> ERROR/REVIEW tùy engine ledger.
- sourceRoomId/sourceFloorId/sourceNormId broken.
- materialId/name mismatch.
- định mức tham chiếu workCategoryId không tồn tại.
- định mức âm/0 bất thường -> WARNING/ERROR.
- unit định mức không tương thích basis unit -> REVIEW.
- auto-generated warehouse transaction trùng sourceIssueKey -> ERROR/WARNING nguy cơ double count.

### B7. Checklist
- floorId/roomId/teamId broken.
- room-floor mismatch.
- status passed nhưng có defect mở liên kết cùng phạm vi -> REVIEW.
- inspectedAt có nhưng inspectedBy rỗng -> WARNING.
- dueDate invalid.

### B8. Cross-module consistency
- Defect team khác Room team -> REVIEW, vì có thể phân công riêng.
- Crew team/tầng/ngày có công việc nhưng không có room/work category tương ứng -> INFO/REVIEW, không ERROR.
- Khối lượng hoàn thành tăng nhưng tiến độ room/subitem chưa thay đổi -> REVIEW nếu có mapping duy nhất.
- Nghiệm thu đạt nhưng Defect nghiêm trọng còn mở cùng room -> REVIEW/ERROR tùy rule dự án.
- Vật tư xuất tự động từ room nhưng source room đã bị xóa/rollback -> REVIEW.

## C. AI Grounded Analysis

AI chỉ đọc snapshot Health Center đã tạo và có thể:
- nhóm lỗi theo đội/tầng/ngày/module;
- giải thích nguyên nhân khả dĩ;
- đánh giá ảnh hưởng tới báo cáo/tính toán;
- đề xuất thứ tự xử lý;
- tạo executive summary.

AI không được:
- thay đổi severity do HNL Engine xác định;
- tự tạo số, đội, tầng, record;
- tự áp dụng repair;
- gọi dữ liệu ngoài phạm vi đã chọn mà không có opt-in.

## D. Deep-link & Issue card

Mỗi issue card cần hiển thị khi có dữ liệu:
- Ngày
- Đội
- Tầng
- Căn/phòng
- Hạng mục / hạng mục con
- Ca
- Giá trị hiện tại
- Giá trị kỳ vọng/canonical
- Rule ID (dòng phụ)
- Record ID (dòng phụ)

Action:
- Xem bản ghi
- Xem vị trí
- Xem liên kết
- Xem cách xử lý
- Preview sửa (chỉ SAFE_REPAIR)
- Phân tích bằng AI

Deep-link phải dùng durable ID, không dùng tên làm khóa.

## E. Export

Cả JSON / Excel / PDF phải dùng đúng cùng `auditSnapshotId` và `asOf` đang hiển thị, không chạy lại engine riêng khi export.

### JSON
Bao gồm summary, technical status, issues, evidence, metadata, action class, auditSnapshotId, app/build version. Secret/token/password phải được redact.

### Excel
Sheet tối thiểu:
- Tong quan
- Loi nghiem trong
- Canh bao
- Can xac nhan
- Ky thuat
- Quan so
- Defect
- Tien do
- Khoi luong
- Vat tu
- Checklist
- Lien ket ID
- AI nhan xet (nếu người dùng đã yêu cầu AI)

### PDF
- Health summary
- Technical status
- Top critical issues
- Issue detail theo ngày/đội/tầng
- AI analysis nếu có

Cho phép xuất `Toàn bộ` hoặc `Chỉ kết quả đang lọc`.

## F. Release gate cho Health Center

Bắt buộc:
- TypeScript
- lint/source-lint
- unit/golden test từng audit module
- regression fixture có lỗi thật và fixture sạch
- no-secret export test
- JSON/Excel/PDF snapshot consistency test
- dark mode + mobile/desktop UI
- role/RBAC: Viewer chỉ xem/export; repair chỉ role được phép
- DEV Runtime Golden

## Thứ tự triển khai

1. Bổ sung rule chắc chắn: Defect date/status, Crew task quality, floorWorks links.
2. Chuẩn hóa issue metadata/action class.
3. Tạo Health Center aggregator dùng runtimeDiagnostics + projectAudit.
4. Di chuyển UI Audit khỏi AI thành màn Health Center; AI chỉ mở/đọc snapshot Audit.
5. Deep-link theo durable ID.
6. Repair Engine Preview -> Backup -> Confirm -> Apply -> Re-audit.
7. Export JSON/Excel/PDF từ cùng snapshot.
8. Mở rộng cross-module rules và Technical Diagnostics sâu.
9. Golden regression + DEV runtime trước khi cân nhắc main/PROD.
