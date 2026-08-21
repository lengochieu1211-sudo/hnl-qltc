# QLCT An Phú V6.2.11 – JSON Scope UI Cleanup

Nền: V6.2.11 recheck cuối. Không thay đổi Firebase project, Firestore rules, projectId, dữ liệu nghiệp vụ, realtime sync hoặc Drive photo pipeline.

## Thay đổi
1. Bỏ hoàn toàn khối **“Phạm vi sao lưu”** khỏi màn hình chính `Đồng bộ & Sao lưu`.
2. Đổi nút **“Xuất File JSON”** thành **“Xuất bản sao JSON”**.
3. Chỉ khi bấm nút này mới mở hộp **“Chọn phạm vi xuất bản sao JSON”** với 3 lựa chọn:
   - Dự án hiện tại.
   - Chọn nhiều dự án.
   - Tất cả dự án.
4. Với `Chọn nhiều dự án`, danh sách project chỉ hiện trong hộp xuất JSON, có checkbox và `Chọn tất cả`.
5. Thêm chú thích rõ: phạm vi này **chỉ áp dụng cho file JSON**, không thay đổi Firebase realtime, Google Drive hay quyền truy cập dự án.
6. Mỗi lần mở hộp xuất JSON mặc định về **Dự án hiện tại** để giảm nguy cơ vô tình xuất toàn bộ dữ liệu/ảnh nặng.
7. Cloud backup nội bộ không còn dùng biến `saveScope`; nếu hàm này được dùng, nó luôn lấy **dự án hiện tại**. Như vậy lựa chọn JSON không thể âm thầm ảnh hưởng sao lưu Cloud.
8. Nhấn `Esc` khi hộp chọn phạm vi JSON đang mở chỉ đóng hộp này, không đóng toàn bộ Trung tâm đồng bộ.
9. Không thay đổi cách import JSON, mã hóa AES-256, dữ liệu ảnh trong JSON hay restore.

## Kiểm tra
- Static TypeScript/TSX parse: **84 files, 0 syntax errors**.
- Relative imports: **0 file thiếu**.
- `package.json` ↔ `package-lock.json`: **0 dependency mismatch**.
- Version giữ nguyên **6.2.11** vì đây là UI patch trên cùng baseline.
- `npm ci` không hoàn tất trong môi trường container; không ghi Build PASS giả. GitHub Actions vẫn là xác nhận build production cuối.
