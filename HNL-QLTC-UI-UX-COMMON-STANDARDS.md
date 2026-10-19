# HNL QLTC — BỘ QUY CHUẨN GIAO DIỆN, BẢNG BIỂU VÀ THAO TÁC CHUNG

Ngày rà soát: 19/10/2026 · Nền: PC Workspace V3.5, DEV 51012f517cdaefa4d93190dc8781c95afffa25f0.
Trạng thái: tài liệu tham chiếu đã đối chiếu source; một số mục ghi rõ “đề xuất/chưa đồng bộ” để không hiểu nhầm là toàn bộ ứng dụng đã được sửa.
**Nguyên tắc:** Không rollback, giữ nguyên Firebase/R2/projectId/ID/schema/dữ liệu, quyền ADMIN/EDITOR/VIEWER, main/PROD. Mỗi thay đổi cần Audit → đề xuất → Patch nhỏ → CI/Rules/Regression → Runtime Golden → Drive Checkpoint.

## 1. Quy tắc chung khi thêm tính năng

- Đọc chuẩn này cùng HNL-MASTER-DEVELOPMENT-GUIDELINE.md, HNL-PC-DESIGN-SYSTEM.md và source DEV HEAD thực tế; phần hướng dẫn lịch sử chỉ dùng để tham khảo khi không trái với quyết định mới nhất.
- Ưu tiên tái sử dụng component/handler (QuickSortBar, MoveOrderControls, DataManagementMenu, modal/report/export, QuickEditGridModal) trước khi viết riêng.
- Không thay đổi quyền, logic lưu/xóa/khôi phục, đồng bộ, luồng ảnh hay ID chỉ để chỉnh giao diện; không tự đổi Firebase, Cloudflare R2, repo hoặc PROD.
- Không đổi toàn ứng dụng về một style mới khi chưa có kiểm thử PC/Windows/Android và ảnh thực tế; phân biệt “đã triển khai”, “đang đề xuất”, “chưa Runtime Golden”.

## 2. PC Workspace, điều hướng và tab con

- PC V3.5 ưu tiên thanh điều hướng trái gọn; không lặp thanh tab đen và tiêu đề lớn làm chật không gian. Nút theo nội dung, cân chiều cao trong cùng cụm, không giãn quá mức.
- Luồng hiển thị: dự án/phân hệ → chức năng chính và tab con → công cụ Tìm kiếm/Bộ lọc/Sắp xếp → bảng/canvas → trạng thái. Không đặt hai bộ lọc/tìm kiếm trùng chức năng cho cùng dữ liệu.
- Giữ tùy chọn PC cũ nếu đã chọn; không tự ghi đè preference. Màn hình 1024/1280/1440px, DPI 125%/150%, cửa sổ PC thu nhỏ vẫn dùng luồng PC phù hợp; responsive không được làm mất một nút nghiệp vụ.
- Khi dùng browser mobile/Android Desktop Site, tối ưu vòng đời bộ nhớ cho mobile; không tự mount các bảng PC nặng. Không dùng riêng chiều rộng CSS dưới 1024px để kết luận máy tính là điện thoại.
- Mở tab con không làm mất bộ lọc/chỗ cuộn vô cớ; Quay lại nên trả đúng phân hệ/bản ghi/trang trước theo cơ chế ngữ cảnh đang có.

## 3. Nút X / Đóng / Quay lại / Thoát

- **X** góc phải và **Đóng**: chỉ đóng lớp/tab con/chi tiết/modal đang mở, không nhảy tab chính hoặc mất dự án đang chọn. Icon X của Defect và Căn/Phòng nên cùng logic thoát ngữ cảnh đã chốt.
- **← Quay lại**: đi về ngữ cảnh trước (ví dụ danh sách → chi tiết → danh sách), phân biệt với đóng hoàn toàn.
- Hộp thoại lồng nhau: nút X đóng đúng tầng, overlay (nền tối) phủ đúng viewport; không cắt nút đóng hoặc tạo overlay giả khiến click xuyên qua.
- Đã thay đổi form mà chưa lưu: cần confirm trước khi bỏ nháp nếu form hỗ trợ trạng thái nháp. Không tự đóng sau lỗi lưu hoặc yêu cầu xác nhận bị hủy.

## 4. Lưu, Lưu thay đổi, Lưu & đóng, Lưu & thêm tiếp

- **Lưu**: xác thực đầu vào, chỉ báo thành công khi handler xác nhận thành công; không tạo trùng do bấm nhiều lần.
- **Lưu thay đổi**: sửa bản ghi hiện có, bảo toàn ID/quan hệ/ảnh; không biến thành thao tác thêm mới.
- **Lưu và đóng**: ghi thành công rồi đóng, nếu thất bại giữ nguyên form và nội dung đang nhập.
- **Lưu và thêm tiếp**: ghi thành công bản ghi hiện tại; tạo form sạch cho bản ghi tiếp theo; giữ ngữ cảnh có ích (dự án/tầng/ngày/đội tùy nghiệp vụ), nhưng không tái dùng ID bản ghi vừa lưu hoặc tạo ảnh/phiếu trùng.
- **Hủy/Bỏ thay đổi**: không ghi dữ liệu. **Đặt lại/Xóa lọc**: chỉ reset filter; không phải xóa bản ghi. **Xóa**: phải xác nhận đúng số dòng/mục và quyền.
- Nếu mất mạng, refresh realtime hoặc gửi lỗi: giữ nháp theo luồng có sẵn, không tự coi là đã lưu. Form đã lưu phải phản ánh lại dữ liệu đúng nguồn.

## 5. Màu sắc, font, bố cục nút

- Dùng token màu thương hiệu HNL; đỏ/nguy hiểm, vàng/cảnh báo, xanh lá/thành công; giữ ngoại lệ ngữ nghĩa. Font PC ưu tiên Segoe UI, mobile Roboto, fallback sans-serif.
- Trong *cùng nhóm* input/select/nút cùng cấp chữ và chiều cao; bộ lọc báo cáo đã chốt select/date 12px, nhãn 11px; sắp xếp/khổ/hướng giấy PDF cũng cần thống nhất. Không tăng font 9/10px hàng loạt bên ngoài nhóm vừa audit.
- Nút thao tác ngang có kích thước nhất quán, không tràn chữ, icon đi kèm nhãn hoặc aria-label/tooltip; không dùng emoji/màu đơn lẻ để biểu đạt lệnh nguy hiểm.
- **PC Workspace từ 1024px**: nút thao tác sâu trong form (Lưu / Lưu & thêm tiếp / Lưu & đóng / Hủy / Xuất) **co theo nội dung**, sắp hàng trái và tự xuống dòng khi hẹp; không kéo giãn bằng `flex-1`, `w-full` hoặc cột `grid` chia đều khi không cần. Nút xác nhận nguy hiểm, ô nhập, vùng cuộn bảng và điều khiển chọn ngày/tầng có ngoại lệ riêng; không áp `button { width: auto }` toàn ứng dụng. Mobile vẫn ưu tiên nút đủ rộng để chạm.
- **Settings**: thẻ mở Đồng bộ, Health Center, Mẫu, Chất lượng ảnh, Dữ liệu đã ẩn trên PC có chiều rộng vừa đọc (tối đa khoảng 680px); **khung feature sheet sau khi mở vẫn có chiều rộng và vùng cuộn riêng**. Không thu nhỏ vùng nhập dữ liệu vì chuẩn nút.
- **Danh mục kho**: bảng vật tư/thiết bị có viền xám nhạt `border-slate-200` như Gợi ý vật tư tổng hợp; viền ở vỏ ngoài, thanh cuộn trong lớp riêng có chừa `scrollbar-gutter`. Giữ sticky header, hàng 32px, chức năng mở lịch sử, tìm/sắp xếp và khả năng cuộn ngang khi màn hình hẹp.
- Khi kiểm tra nút kéo giãn, rà cả các form sâu của Nghiệm thu, Kho, Định mức, Khối lượng, Checklist, Quân số, Báo cáo, Trung tâm thông báo và Cài đặt; nút xác nhận xóa trong popup nhỏ chỉ thay đổi sau kiểm thử hành vi thực tế.
- Các nút Xuất: Nội dung, Excel, PDF, Ảnh, JSON phải phân biệt; ưu tiên Nội dung trung tính, Excel xanh lá, PDF đỏ, JSON tím, Ảnh xanh khi thuộc cùng nhóm định dạng; không tự đổi màu các phiếu có quy ước riêng.

## 6. Tìm kiếm, lọc và Sắp xếp nhanh

- Tìm đúng đối tượng: Tìm vật tư / Căn / Tầng / Nhật ký, có xóa nhanh nếu thích hợp; không trùng ô. Chỉ tìm trong phạm vi có quyền.
- Bộ lọc có trạng thái rõ, không tự đổi dữ liệu gốc. Tìm kiếm → lọc → Sắp xếp nhanh → Mặc định/xóa lọc. Khi quay lại, giữ ngữ cảnh nếu đã hỗ trợ.
- Tái sử dụng QuickSortBar; theo chuẩn đang áp dụng **dưới 6 mục không hiện**, từ 6 mục hiện. Tùy chọn Mặc định và hướng tăng/giảm; đúng nhãn Ngày mới/cũ, Tầng thấp/cao, Tên A–Z/Z–A.
- Phân biệt *thứ tự hiển thị* (sort) với *di chuyển thứ tự lưu thực tế* (MoveOrderControls, Drag); không ghi lại thứ tự chỉ vì đổi filter/sort.
- Không tự xếp lại thứ tự quy trình hạng mục chính/con trong Căn/Phòng.

## 7. Tickbox, chọn dòng, chọn nhiều, thao tác hàng loạt

- Checkbox dùng **chọn**, không phải xóa. Có chọn tất cả/bỏ chọn trong vùng được phép, thể hiện số mục và phạm vi rõ. Viewer không được hiện handler ghi dữ liệu.
- Xóa nhiều, di chuyển, xuất chọn lọc phải xác nhận thao tác nguy hiểm theo quyền; không tác động mục không chọn, không ghi hai lần, không bỏ qua thùng rác/undo khi đang được áp dụng.
- Chọn *dòng* bằng checkbox khác chọn *ô* bằng Ctrl/Shift; đừng dùng cùng trạng thái để vô tình xóa dòng khi người dùng chỉ muốn copy ô.
- Chọn tất cả trong bảng có lọc/phân trang phải minh bạch chọn những dòng nào; đây là điểm cần kiểm thử ở từng phân hệ trước khi đồng bộ toàn cục.

## 8. Bảng chỉnh nhanh PC (Quick Edit Grid)

- **Mặt bằng/Căn-Phòng, Quân số, Kho vật tư và Khối lượng** đều có Bảng chỉnh nhanh; không bị mất trên PC thu nhỏ, zoom cao, Windows EXE/DPI 125–150%. Mobile Web/APK và Chrome Android Desktop Site không tự tải Quick Edit PC để giữ hiệu năng.
- **Kho đã bật chọn nhiều ô kiểu Excel**: click một ô, Shift+click góc cuối chọn vùng hình chữ nhật; Ctrl/Cmd+click thêm/bỏ ô không liền kề; Ctrl+C copy vùng TSV; Ctrl+V dán TSV từ Excel hoặc một giá trị vào nhiều ô đã chọn; chọn nhiều ô cùng cột rồi đổi dropdown để áp dụng đồng loạt.
- Các cột khóa/chỉ đọc/ĐVT không được ghi đè. Mã lưu trữ material/equipment giữ nguyên, nhãn hiển thị tiếng Việt; paste hàng loạt gặp ô khóa/giá trị dropdown không hợp lệ phải **từ chối cả vùng** (fail-closed), không âm thầm lưu một phần.
- Bản chỉnh là **nháp**. Hoàn tác/Làm lại bằng nút hoặc phím tắt **Ctrl+Z / Ctrl+Y** (Ctrl+Shift+Z cũng làm lại); trong ô grid dùng lịch sử nháp, ở ô tìm kiếm/thanh công cụ giữ phím tắt văn bản của trình duyệt. Bỏ thay đổi, Lưu thay đổi; đóng/chuyển tab có nháp phải xác nhận, lưu lỗi không được mất nháp. Khi Undo trở về dữ liệu ban đầu phải vẫn giữ khả năng Redo. Không ghi Firestore khi chỉ copy/dán/chọn ô.
- Bảng Quân số/Khối lượng/Mặt bằng hiện hỗ trợ chỉnh theo bảng và dán dữ liệu dạng nhiều dòng cơ bản, nhưng **chế độ Shift/Ctrl chọn vùng nhiều ô đầy đủ hiện chỉ bật ở Kho**. Muốn mở rộng phải audit kỹ hàm lưu/ID/đặc thù quyền từng tab trước khi triển khai, không giả vờ đã có.
- Phím tắt trong input đang nhập chữ phải không phá thao tác văn bản mặc định. Khi một vùng grid đang được chọn thì clipboard hoạt động theo vùng, có trạng thái số ô được chọn; kiểm tra sau lọc/sắp xếp.
- Regression bắt buộc: Excel TSV, ô rời, vùng liên tiếp, dropdown hàng loạt, một giá trị dán nhiều ô, từ chối ô khóa, undo/redo, hủy, vai trò Viewer, realtime refresh khi chưa lưu.

## 9. Xuất và chia sẻ: Nội dung, Excel, PDF, Ảnh, JSON

- **Nội dung**: xem, sao chép và chia sẻ đoạn văn bản; không coi là đã gửi ảnh. **Excel**: bảng, số/ngày, freeze/auto filter khi biểu mẫu hỗ trợ, ID kỹ thuật phải tuân mẫu; nhập Excel là thao tác khác xuất.
- **PDF**: dùng bộ lọc/phạm vi và thứ tự chọn, khổ giấy A4/A3, dọc/ngang, không cắt chữ/ảnh, Defect/phụ lục theo thứ tự dữ liệu; Excel/PDF tương đương phải cùng phạm vi lọc khi nghiệp vụ cùng báo cáo.
- **Ảnh**: chia sẻ đúng ảnh lưu trữ/durable, không dùng placeholder thay ảnh thật. **JSON**: sao lưu có cấu trúc, không phải báo cáo; nhập/khôi phục phải xác nhận phạm vi và bảo toàn IDs, R2/media, quyền, dữ liệu.
- Rõ hành vi Xuất/Tải xuống vs Sao chép vs Chia sẻ vs Nhập/Khôi phục; không thông báo “đã chia sẻ” trước khi nền tảng xác nhận. Tiếp tục dùng các component xuất/chia sẻ hiện có, không tạo exporter mới chỉ để đổi nút.

## 10. Popup, feature sheet, scroll và bảng

- Popup trung tâm phủ đúng viewport, không bị transform/overflow/backdrop-filter cha làm cắt; dùng ViewportModalPortal ở nơi đã test. Header X và footer Lưu/Hủy nên nhìn thấy kể cả nội dung dài; giữ một vùng cuộn chính trừ khi bảng nhiều cột cần cuộn riêng.
- Bảng có sticky header/dòng chỉ mục khi đã thiết kế; nội dung dài phải wrap/truncate với cách xem đầy đủ; không để bảng, nút, dropdown nằm ngoài viewport.
- Modal sâu JSON, Định mức, Kho, Defect, Quân số, HNL AI, Cài đặt cần test mở/đóng lần lượt, focus, ESC, click-outside, dark/light và DPI thật; không thay portal hàng loạt khi chưa có bằng chứng.

## 11. Mặt bằng/Defect và vẽ Căn/Phòng

- **Hình chữ nhật Căn/Phòng có đúng bốn góc vuông, không bo góc** lúc kéo, preview, lưu và xem lại. Giữ x/y/width/height, floorId, IDs, zoom, hitbox, màu tô và Defect hiện có; không thêm cornerRadius/schema.
- Polygon giữ nguyên các đỉnh, không làm tròn tự động. Không tạo Căn/Phòng do drag thả sai; zoom/pan không thay tọa độ thật. Thay ảnh nền/mặt bằng phải giữ cơ chế liên kết và ảnh hiện có.
- Defect xem/đóng chi tiết phải đúng ngữ cảnh, ảnh thật qua R2, role read/write chuẩn; Viewer không sửa/xóa. Nút X màu xám đầu góc đóng cùng tầng như cửa sổ Căn/Phòng.

## 12. Quy chuẩn nghiệp vụ: Kho, Quân số, Khối lượng, Checklist, Trao đổi và AI

- **Kho**: tách Danh mục/Định mức/Phiếu nhập/Phiếu xuất/Tồn; tồn kho và ĐVT/ID có vùng chỉ đọc, cập nhật phải tính đúng số dư và liên kết; xác nhận xóa phiếu/chi tiết; không duplicate vật tư/danh mục.
- **Quân số**: các ngày, tầng, đội, ca, nhật ký/ảnh và báo cáo phải giữ đúng ID/nhân sự; nút Lưu và thêm tiếp không ghi trùng nhật ký/ảnh. Không mất nháp do realtime, thao tác liên hệ đúng quyền.
- **Khối lượng**: nhóm/hạng mục, tỷ lệ/khối lượng, hạn, đơn vị và liên kết Căn/Phòng đúng; sửa theo bảng không được thay đổi thứ tự thủ công khi không yêu cầu; không làm mất giá trị khi đổi tab.
- **Checklist**: nhóm kiểm tra, ngày/tầng/trạng thái và quyền cấu trúc; checkbox tick hoàn thành khác với checkbox chọn bản ghi để xóa.
- **Trao đổi**: tin nhắn/ảnh/file, thành viên, gửi/đọc, offline/reconnect, scroll và keyboard trên mobile; không công bố ảnh chưa durable.
- **HNL AI**: 4 nút HNL Data / Kiểm tra dữ liệu / AI chung / HNL + AI phải luôn đọc được. Trên PC, nút đang chọn có nền xanh HNL thì **chữ + icon trắng**, nút chưa chọn nền trắng chữ tối; không áp CSS chung màu chữ xanh lên nền xanh. Không nhân đôi heading; không rò dữ liệu vượt quyền, báo lỗi provider/rate limit rõ ràng, xử lý bản xuất đúng phạm vi dự án.

## 13. Phân quyền, dữ liệu, đồng bộ và bảo mật

- RBAC theo vai trò: ADMIN cấu trúc/quản trị, EDITOR nghiệp vụ được cấp, VIEWER chỉ đọc theo quyền; cả UI, handler, Firebase Rules phải kiểm tra, không sửa một phía. Viewer không xem đơn giá khi bị khóa.
- Ảnh mới qua private Cloudflare R2 (đảm bảo binary tồn tại rồi mới publish Firestore ready). Cache/offline/reconnect, outbox, legacy media chỉ đọc, quan hệ ID phải được bảo toàn.
- JSON backup/restore, thùng rác, undo/redo và quyền chính phải thử với dữ liệu cũ/đa thiết bị; không ghi undefined, không duplicate, không biến đổi IDs.
- Secrets không đưa vào ZIP/repo; package.json/package-lock.json, GitHub workflows, Firebase config, Android/Windows wrapper phải được gate trước handoff.

## 14. Ma trận nghiệm thu và yêu cầu cho tính năng mới

1. Xác minh repo/branch/exact HEAD, checkpoint mới nhất; so sánh git diff, bảo vệ main/PROD.
2. Audit tình trạng/nguồn gốc lỗi → báo đề xuất, file ảnh hưởng, rủi ro dữ liệu/quyền/sync → sửa tối thiểu.
3. Test typecheck, lint, build, lockfile, Firebase Rules, RBAC/regression, behavior của chức năng và ảnh hưởng chéo.
4. UI PC tại 1024/1280/1440px, Windows DPI 125/150%, EXE/Web, dark/light; Android app và Chrome Desktop Site; role ADMIN/EDITOR/VIEWER, offline/multi-user khi có liên quan.
5. Sau khi CI và Runtime Golden xanh trên exact DEV HEAD: lưu PATCH, FULL SOURCE, REPORT, SHA256, checkpoint, EXE/APK/evidence vào 5 thư mục HNL QLTC Backup đã có; không tạo folder trùng.
6. **Chỉ gọi toàn diện CERTIFIED sau nghiệm thu trên thiết bị thực tế**; CI PASS hoặc automated Runtime Golden PASS không thay thế kết quả thiết bị thật.

## 15. Việc còn phải audit (không xem như đã sửa)

- Nút HNL AI mất chữ, popup JSON nhiều cấp, thanh cuộn/định mức Kho, nút X chi tiết sâu, bảng 1024px+DPI thật, vướng overlay tại Defect và Báo cáo.
- Tiếp tục đối chiếu những nơi chưa có chuẩn đồng nhất cho Lưu/Lưu và thêm tiếp/Đóng/Quay lại và bảng chọn nhiều; không refactor cùng lúc.
- Mở rộng Shift/Ctrl chọn vùng từ Kho sang các Bảng chỉnh nhanh khác chỉ sau audit nghiệp vụ và kiểm thử an toàn tương ứng.

**Nguồn đối chiếu:** App.tsx; QuickEditGridModal.tsx; quickGridClipboard.ts; DataManagementMenu.tsx; ExportPdfModal.tsx; FloorPlanDefectTab.tsx; QuickSortBar.tsx; MoveOrderControls.tsx; WarehouseTab.tsx; CrewTabBase.tsx; WorkVolumeTab.tsx; scripts/quick-edit-excel-golden.ts; HNL-PC-DESIGN-SYSTEM.md; checkpoint DEV 51012f51.
