# HNL QLTC — DEV release tiết kiệm Firebase Spark

**Áp dụng cho nhánh `dev` sau khi patch workflow này được đưa vào repo.**
Không áp dụng lên `main`/PROD và không thay Firebase Project/R2/domain hoặc dữ liệu công trình.

## A. Hằng ngày — tự động, không deploy Hosting

1. Sửa source trên nhánh công việc; kiểm tra ảnh hưởng chéo.
2. Sau khi đưa thay đổi vào `dev`, GitHub Actions chạy **Build**: test ổn định, TypeScript, lint, Firebase Rules qua Emulator, bảo mật, build, kèm `dev-deploy-budget-golden.mjs`.
3. Workflow **Package HNL QLTC DEV Deliverables** lúc `push` chỉ chạy **Firebase Rules certification**; **không đóng gói CERTIFIED** khi chưa có Runtime Golden.
4. **Bootstrap HNL QLTC DEV Firestore** và **HNL QLTC DEV Runtime Golden** không tự chạy khi push. **Deploy HNL QLTC DEV Environment** chỉ tự kích hoạt bởi *commit xác nhận riêng* thay đổi đúng `.github/dev-release-approval.json`; mọi push source thông thường không deploy.
5. Workflow APK/EXE riêng vẫn có thể tự build nhưng không deploy Hosting.

## B. Khi cần cập nhật Web DEV — chạy theo đúng thứ tự

1. Trước tiên kiểm tra Firebase Usage & Billing. Nếu Storage đã >= 90% hoặc Downloads >= 80%, ưu tiên chờ dọn bản cũ/kiểm tra nguyên nhân; nếu vẫn cần triển khai, phải chấp nhận rủi ro chạm giới hạn trước khi chạy.
2. Đảm bảo hai cổng GitHub Actions của **đúng DEV HEAD** đã PASS:
   - **Build** (toàn bộ CI local source).
   - **Package HNL QLTC DEV Deliverables → Firebase Rules certification** (chỉ Rules, chạy do push).
3. **Sau khi chủ sở hữu xác nhận rõ triển khai DEV**, tạo **một commit độc lập** trên `dev` chỉ thay đổi `.github/dev-release-approval.json` có JSON sau (không bao giờ gộp với sửa source):
   ```json
   {"intent":"DEPLOY-FIREBASE-DEV","project_id":"hnl-qltc-dev","approved_source_sha":"<exact HEAD trước commit xác nhận>"}
   ```
   GitHub Actions tự kích hoạt **Deploy HNL QLTC DEV Environment** khi file này được thay đổi; workflow từ chối nếu commit chứa file khác hoặc HEAD trước commit không đúng SHA đã xác nhận. Sau đó chờ CI/Rules đúng **SHA commit xác nhận** PASS, khóa project DEV và phát hành Hosting đúng một lần. **Mọi lần push source thông thường KHÔNG deploy.** Có thể dùng `workflow_dispatch` thủ công dự phòng nếu cần.
   **Chú ý:** chỉ người có quyền ghi vào `dev` mới được tạo commit xác nhận. Không tự tạo file này trước khi người dùng đồng ý. Nếu không có secret Firebase DEV hoặc project không phải `hnl-qltc-dev` thì workflow FAIL an toàn.
4. Chờ deploy PASS rồi mở **HNL QLTC DEV Runtime Golden** → **Run workflow** → `dev`. Golden kiểm tra GitHub run DEV mới nhất cùng HEAD và SHA256 Web đang phục vụ (manifest `hnl-dev-release.json`, HTML, JS), thử nghiệm PC/điện thoại, offline/multi-user, Firestore/R2, **không triển khai Hosting lần nữa**. Golden kiểm tra lại manifest sau khi chạy toàn bộ test.
5. Khi Golden PASS, mở **Package HNL QLTC DEV Deliverables** → **Run workflow** → `dev`. Package chỉ được gắn nhãn CERTIFIED nếu đúng HEAD và live evidence đủ điều kiện; quota Firestore còn chặn thì chỉ được VERIFICATION/INFRA BLOCKED.
6. Tải artifacts (tệp kết quả), lưu FULL SOURCE/PATCH vào `01_FULL_SOURCE`, checkpoint vào `02_CHECKPOINT_HANDOFF`, report/SHA256 vào `03_AUDIT_REPORT`, bản EXE/APK nếu có vào `04_BUILD_EXE_APK`.

## C. Gate (điều kiện kiểm tra) khi lỗi

- **Build/Rules thất bại:** Không deploy, sửa nguyên nhân trong source trước.
- **HEAD thay đổi trong lúc chuẩn bị release:** Từ chối deploy source cũ; phải xác minh lại SHA và CI.
- **Đang deploy:** Không chạy Golden khi chưa xong deploy; lock release ngăn thao tác chồng nhau. Nếu HEAD thay đổi ngay từ đầu hoặc trước khi publish, workflow DEV từ chối triển khai.
- **Manifest SHA/index/JS không đúng:** Golden FAIL, tuyệt đối không coi là CERTIFIED.
- **Golden FAIL / hạ tầng hết quota:** Không gọi CERTIFIED và không chuyển PROD.
- **Hosting gần vượt gói Spark:** Tạm dừng deploy và kiểm tra Usage; việc xóa phiên bản cũ không hoàn lại bandwidth đã dùng trong tháng.

## D. Các rủi ro vẫn cần theo dõi

- Workflow PR preview hiện được phép cấu hình để tạo bản preview Hosting; không bật nếu chưa đánh giá quota. Workflow AI preview trên nhánh tính năng riêng cũng có khả năng deploy khi được kích hoạt.
- Các kiểm tra live vẫn tiêu thụ Reads/Writes/Downloads dù không tạo phiên bản Hosting mới.
- Nếu mới thay workflow, cần chạy CI trên GitHub và xác nhận các bước manual trước khi tuyên bố Runtime Golden hoặc CERTIFIED.

**Các thay đổi này chỉ tác động workflow và danh tính release; không sửa Firestore schema/Rules, app UI/logic, wrapper EXE/APK hoặc dữ liệu.**
