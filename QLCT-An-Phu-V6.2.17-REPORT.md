# QLCT An Phú V6.2.17 – Cursor-Anchored Zoom & Drawing Gesture Hardening

Nền: V6.2.16 FULL SOURCE. Không đổi Firebase project/Hosting/repo, projectId, schema, Drive mapping, Firestore Rules hoặc dữ liệu cũ.

## Sửa theo video thực tế

### 1. Zoom PC theo đúng tâm con trỏ
- Wheel zoom không còn chỉ thay `zoomScale`.
- Trước khi zoom, app ghi lại điểm hình học đang nằm dưới con trỏ.
- Sau khi React render kích thước mới, app bù `scrollLeft/scrollTop` để điểm đó vẫn nằm dưới con trỏ.
- Giữ nguyên giới hạn zoom cũ 1x..20x cho bản vẽ lớn.
- Không đổi tọa độ Căn/Defect khi zoom.

### 2. Pinch mobile cũng giữ tâm hai ngón
- Điểm giữa hai ngón được dùng làm anchor.
- Pinch hủy long-press/pending click để không tạo Căn/Defect/điểm polygon ngoài ý muốn.

### 3. Chặn polygon/add-room/add-defect sau thao tác kéo
- Thêm click-vs-drag guard: di chuyển >8px được coi là navigation/drag, không phải click.
- Mobile một ngón có thể pan ngay cả khi Polygon / Thêm Căn / Thêm Defect đang được arm.
- Tap đứng yên vẫn thực hiện đúng hành động của mode.
- Middle mouse / Space+left pan trên PC không tạo thêm đỉnh polygon.
- Pinch/wheel không chấm thêm polygon.

### 4. Tránh xử lý wheel/touch hai lần
- Native gesture listener chỉ bind một lần ở scroll viewport.
- Bỏ tình trạng cùng một event bị parent và image cùng xử lý do event bubbling.

### 5. Thanh polygon gọn hơn
- Rút ngắn nội dung hướng dẫn và tên nút trong banner vẽ.
- Giữ đủ chức năng Đường / Chữ nhật / Gấp khúc / Đa giác / Xóa điểm cuối.
- Giảm chiều cao banner fullscreen để dành diện tích cho bản vẽ.

### 6. Defect label ít che bản vẽ hơn
- Badge chỉ giữ mã Defect ngắn như hiện tại.
- Thu nhỏ chiều cao/padding/font badge.
- Full category/description vẫn xem được qua title/click chi tiết.
- Không đổi tọa độ thật của Defect.

## Giữ nguyên từ V6.2.16
- Mobile: 1 ngón pan, 2 ngón zoom, long-press 2s chỉ paste Căn ở mode Căn/Phòng.
- PC: wheel zoom, middle-drag pan, Space+left-drag pan.
- Ctrl/Cmd+A/C/V, Delete/Backspace, Esc, Arrow/Shift+Arrow.
- Move/+ giữa căn để kéo; handles để resize.
- 3 công cụ Vẽ tự do / Đa giác / Chữ nhật.
- Role-resume hardening và pipeline ảnh nhẹ RAM.
- Không đổi giới hạn zoom 1x..20x.

## Không tự sửa Firebase App ID
Log deploy trước đó cho thấy `VITE_FIREBASE_APP_ID` trống. V6.2.17 không tự điền giá trị giả.
Chỉ nên cấu hình khi lấy được Firebase Web App ID chính xác từ Firebase Console/project hiện tại.

## Không làm
- Không migration dữ liệu.
- Không đổi/xóa/gộp project hoặc folder Drive.
- Không push GitHub.
- Không deploy Firebase.
- Không deploy Apps Script.

## Kiểm tra trước khi đóng gói
- typescript_tsx_syntax: **PASS - 85 files, 0 parser errors (TypeScript 5.8.3 parser)**
- relative_imports: **PASS - 0 missing**
- package_lock: **PASS - package.json ↔ package-lock root dependencies match**
- version: **PASS - 6.2.17 in package.json, package-lock.json, appVersion.ts and deploy workflows**
- workflow_yaml: **PASS - 3 workflow YAML files parse**
- npm_ci: **NOT PASS - online npm ci timed out at 45s; offline retry failed because yargs-parser tarball was not cached**
- npm_lint_build: **NOT RUN - dependencies were not installed; no fake PASS recorded**
- firestore_rules: **PASS - unchanged from V6.2.16**
- ZIP baseline diff: 7 file thay đổi/thêm, 0 file bị xóa.
- FULL SOURCE loại trừ node_modules/dist/.git.

## Đề xuất thêm
- Với bản vẽ rất lớn, nên thêm **Mini-map / Overview** thu gọn ở góc: chỉ để định hướng nhanh, không thay đổi zoom hiện tại.
- Thêm nút **Focus đối tượng đang chọn** để đưa Căn/Defect đang chọn về giữa viewport mà không đổi tọa độ.
- Có thể lưu **zoom + vị trí scroll theo từng tầng trong sessionStorage** để quay lại tầng không mất vị trí đang xem; không ghi Firebase để tránh realtime noise.
- Cần điền `VITE_FIREBASE_APP_ID` bằng **Web App ID thật** của project hiện tại; hiện source/workflow vẫn để trống. Không tự điền ID đoán.
- Sau deploy nên smoke-test zoom tại 1x/5x/10x/20x và rotation 0°/90°/180°/270° để xác nhận anchor không lệch ở bản vẽ xoay.
