# HNL QLTC — Chuẩn thiết kế PC Desktop Workspace v1

## Bảo toàn
- Nền: `lengochieu1211-sudo/hnl-qltc`, `dev` tại `ba19956863c16878861368f97e1976cb94da2604`; không dựa lên AQ01 candidate chưa merge.
- Không sửa Trang chủ, business handlers, dữ liệu Firestore/R2, Auth, ID, Rules, Android, package/lockfile hoặc workflow.
- Giao diện cũ được chọn mặc định. Tùy chọn `hnl_desktop_workspace_mode_v1` chỉ lưu ở **localStorage trình duyệt PC**, không đồng bộ lên Cloud.
- Hoàn nguyên tức thì bằng **PC cũ** trong đầu trang; xóa key hoặc set `classic` cũng khôi phục, không cần thay đổi dữ liệu.
- CSS chỉ áp dụng với `data-hnl-desktop-design=modern` và chiều rộng từ 1024px; tab Trang chủ luôn giữ thiết kế gốc.

## Quy tắc hình thức, dùng chung tất cả phân hệ / tab con
- Primary: sử dụng biến `--hnl-primary`, `--hnl-primary-action`, `--hnl-primary-hover`; tuân theo màu thương hiệu được cài đặt sẵn, không hardcode primary riêng từng màn.
- Canvas nền `#f1f5f9`, card trắng `#ffffff`, nội dung `#0f172a`, chữ phụ `#475569`, border `#dbe3ef`; dark-mode tự chuyển qua token tương ứng.
- Chỉ dùng màu ngữ nghĩa cho trạng thái: đỏ cảnh báo/lỗi, vàng cần chú ý, xanh lá thành công; không đổi màu của trạng thái nghiệp vụ.
- Cỡ chữ: tên trang 24px/850, nội dung 13px, nhãn/tab/nút 12px/700, breadcrumb/chú thích 11px, tiêu đề bảng 11px, ô bảng 12px.
- Cỡ nút header 38px; thanh điều hướng mỗi mục >=44px; tab con >=36px; bo góc card 16–20px, nút 9–12px; khoảng cách 4/8/12/16/20/24px.
- Cấu trúc: thanh điều hướng trái 224px → breadcrumb + tên phân hệ + ngữ cảnh dự án/quyền/sync → nút Dự án/Báo cáo/Thông báo/Bảo mật → điều hướng nhanh → chức năng và tab con vốn có.
- Tất cả mô-đun giữ nguyên logic/hàm click, toolbar chức năng, modals, nested tabs, filter, search, export, bảng, canvas mặt bằng.
- Navigation, brand actions, report/security shortcuts gọi đúng handler đang dùng trong App. Không tạo handler thao tác Cloud mới.
- Quy tắc tiếp cận: focus-visible rõ ràng; tiêu đề có h1, nav có aria-label, button có type=button; tên trang và mô tả rõ ràng.
- Responsive: không thay đổi mobile dưới 1024px; hỗ trợ PC browser và Windows WebView2 không ép layout modal ảnh/canvas.

## Tiêu chí nghiệm thu và rollback
1. Kiểm tra các tab chính Mặt bằng, Quân số, Kho, Khối lượng, Checklist, Trao đổi, HNL AI, Hệ thống, Cài đặt và các cửa sổ Dự án/Báo cáo/Thông báo/Bảo mật; ADMIN/EDITOR/VIEWER đều chỉ thấy tính năng có quyền.
2. So sánh giao diện cũ và mới trên cùng dữ liệu; ngắt mạng, reconnect, đổi project, Undo/Redo, mở modal, xuất file.
3. Test PC 1024/1280/1440/1920px, 125–150% Windows DPI, dark/light, Android 393px.
4. CI PASS → triển khai Web DEV → runtime thực tế; hoàn nguyên bằng chọn `PC cũ` nếu không thích, revert commit UI để trả DEV web cũ nếu bất ổn. Không reset/rebase làm mất commit và không chạm PROD.
