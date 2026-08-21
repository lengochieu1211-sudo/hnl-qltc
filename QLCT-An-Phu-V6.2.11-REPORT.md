# QLCT An Phú V6.2.11 – Realtime Performance & Project Identity Hardening

## Nền nâng cấp
- Nâng trực tiếp từ repo người dùng gửi: `qlct-an-phu-main(3).zip` – V6.2.10.
- Không đổi Firebase project, Hosting URL hay cấu trúc dữ liệu nghiệp vụ chính.
- Không tự xóa project cũ khi phát hiện trùng ID/tên.
- Không push GitHub và không deploy Firebase trong đợt sửa này.

## Mục tiêu
1. Giảm lag khi 2 tài khoản mở 2 projectId khác nhau.
2. Cắt vòng lặp Firestore: listener → ghi index/quyền → listener nhảy → đọc/ghi tiếp.
3. Giảm số read/write nền của project discovery, role, autosave, audit và photo sync.
4. Chuyển dự án không reload toàn app; local hiển thị trước, Cloud đồng bộ nền.
5. Giữ chat badge nhưng giảm tải khi app/tab nằm nền.
6. Không tự tải thumbnail hàng loạt cho Defect và Báo quân số.
7. Xử lý an toàn trường hợp 2 project Cloud thật sự khác ID nhưng cùng tên.

## 1. Project discovery realtime – debounce/cancel/cache
File: `src/lib/firebase.ts`

- `subscribeCurrentUserProjectsRealtime()` được viết lại theo hướng nhẹ hơn.
- Gom các nguồn discovery của account: user index, invitation mới/cũ, projectAccess, ownerUid, ownerEmail và candidate local.
- Mọi snapshot không còn gọi quét server ngay lập tức; dùng debounce khoảng 160 ms.
- Mỗi vòng `emit()` có sequence token. Vòng cũ bị hủy giữa loop khi listener mới đến, nên không tiếp tục đốt network reads rồi chỉ bỏ kết quả ở cuối.
- Thêm cache metadata project theo user/project với TTL ngắn; không `getDocFromServer()` lại toàn bộ project sau mỗi snapshot nếu dữ liệu còn mới.
- Candidate chỉ có từ local vẫn phải qua server/rules xác minh; localStorage không được dùng làm bằng chứng cấp quyền.
- Có log đo: `[discovery emit] source, ids, result, duration`.

## 2. `users/{uid}.projects` trở thành idempotent
File: `src/lib/firebase.ts`

- `registerProjectForCurrentUser()` không còn luôn `setDoc(... updatedAt: Date.now())` dù project/name/role không đổi.
- Thêm signature cache `projectId|name|role`.
- User document realtime snapshot dùng để prime cache hiện tại.
- Nếu nội dung không đổi: bỏ qua write và log `[user index write] <projectId> skipped`.
- Chỉ khi project index thực sự đổi mới ghi và log `written`.
- Cắt vòng lặp quan trọng: user write → user listener → discovery emit → user write lại.

## 3. Owner query chỉ xử lý thay đổi
File: `src/lib/firebase.ts`

- `ownerUidQ` và `ownerEmailQ` dùng `snap.docChanges()` thay vì loop toàn bộ `snap.docs` sau mỗi root project update.
- Cache owner project chỉ cập nhật doc added/modified/removed.
- Auto repair discovery chỉ gọi ở sự kiện `added`, không repair mọi project khi chỉ một metadata root thay đổi.
- Có log `[owner query] ... changes=` để đo thực tế.

## 4. Repair quyền/index không chạy lặp vô hạn
Files: `src/lib/firebase.ts`, `src/components/SecurityModal.tsx`

- `repairProjectAccessIndexForProject(projectId, force=false)` thêm completed-set theo phiên.
- Auto repair mặc định chỉ chạy một lần/project/page-session.
- Nút/luồng Security ADMIN được phép gọi `force=true` để sửa thủ công khi thật sự cần.
- Giữ invitation compatibility trước projectAccess; projectAccess mới vẫn best-effort nếu Rules production chưa hỗ trợ đầy đủ.

## 5. Autosave Cloud không touch root project mỗi 2 giây
Files: `src/App.tsx`, `src/lib/firebase.ts`

- Debounce autosave chính tăng từ 2 giây lên khoảng 6 giây để gom thao tác nhập liên tục.
- `saveProjectDiffsToCloud()` nhận option `touchProjectMetadata`, `rootTouchIntervalMs`, `auditDetailLimit`.
- Root `projects/{projectId}` chỉ touch ngay khi metadata project thật sự đổi; nếu chỉ subcollection đổi thì root touch được throttle, mặc định khoảng 60 giây và không thấp hơn 30 giây.
- Việc sửa một Defect/phòng/vật tư không còn bắt buộc làm owner query + role listener + discovery query nhảy liên tục vì `updatedAt` root.
- Có log `[cloud save]` và `[cloud save] root metadata touched`.

## 6. Role realtime không reread vì `updatedAt`
File: `src/lib/firebase.ts`

- `subscribeProjectUserRoleRealtime()` debounce refresh khoảng 140 ms.
- Root project listener so signature quyền: tồn tại/deleted/ownerUid/ownerEmail.
- Thay đổi name/contractor/updatedAt không còn tự gọi lại chuỗi `fetchProjectUserRoleFromCloud()`.
- Member listener chỉ refresh khi các field liên quan quyền thay đổi: exists/active/role/uid/email.
- Có log `[role refresh] projectId reason`.

## 7. Audit autosave giảm read/write
File: `src/lib/firebase.ts`

- Không còn bắt buộc đọc before-data cho mọi record khi một batch rất lớn thay đổi.
- Audit chi tiết được cap mặc định 20 record/batch, tối đa 30.
- Nếu nhiều hơn giới hạn, thêm một audit summary `BATCH_UPDATE` thay vì hàng trăm entry chi tiết.
- Role actor được fetch một lần cho cả batch rồi truyền vào các audit write; không fetch role lại cho từng entry.
- Các audit write được gom `Promise.all` trong giới hạn.

## 8. Photo realtime/sync chạy nền nhẹ hơn
File: `src/lib/photoCloudSync.ts`

- Snapshot đầu đọc full metadata một lần.
- Sau snapshot đầu chỉ merge `docChanges()`, không map lại toàn bộ photo documents mỗi lần.
- Initial photo upload/migration không chạy ngay lúc mở/chuyển project: delay khoảng 8 giây và ưu tiên `requestIdleCallback`.
- Nếu tab đang hidden lúc tới thời điểm sync, bỏ lượt đó thay vì chiếm CPU/mạng nền.
- Mỗi project có min repeat interval khoảng 5 phút/page-session cho initial sync.
- `syncProjectPhotosToCloud()` lấy cloud metadata bằng một query collection rồi dùng map, thay vì `getDoc()` từng ảnh.
- Có log `[photo snapshot] projectId docs changes initial`.

## 9. Listener ảnh chỉ bật ở tab cần ảnh
File: `src/App.tsx`

- Photo metadata realtime listener chỉ attach khi active tab thuộc `floorplan`, `crew` hoặc `chat`.
- Ở các tab không dùng ảnh, không giữ listener ảnh nền không cần thiết.
- Dữ liệu nghiệp vụ khác vẫn projectId-scoped và local-first.

## 10. Defect list: chỉ hiện số ảnh, không decode thumbnail hàng loạt
Files: `src/components/FloorPlanDefectTab.tsx`, `src/utils/photoStorage.ts`

- Mỗi Defect card không còn tự tải 1–3 thumbnail ngay khi render danh sách.
- Hiển thị dạng `N ảnh · Bấm để xem`.
- Chỉ khi người dùng mở ảnh mới đọc/decode full image và mở gallery.
- Vẫn tính ảnh legacy trước/sau sửa để không mất tương thích dữ liệu cũ.
- `getProjectPhotos()` có memory cache metadata theo project để nhiều card hỏi số ảnh không liên tục đọc lại một list IndexedDB lớn.

## 11. Báo quân số: chỉ hiện số lượng ảnh ở card
File: `src/components/CrewTab.tsx`

- Card danh sách không render `PhotoAttachmentPicker` và thumbnail ngay từ đầu.
- Hiển thị `N ảnh hiện trường · Xem` hoặc `Chưa có ảnh hiện trường`.
- Click `Xem` mới mở picker/gallery read-only và lazy-load thumbnail.
- Form thêm/sửa quân số vẫn giữ PhotoAttachmentPicker để chụp/chọn/quản lý ảnh bình thường.

## 12. Chat badge vẫn realtime khi app đang dùng
File: `src/App.tsx`

- Không tắt chat badge.
- Summary/read listener của badge chỉ chạy khi `document.visibilityState === 'visible'`.
- Khi tab ra nền: unsubscribe badge listener để giảm read/render.
- Khi quay lại app: subscribe lại và refresh unread.
- Update badge debounce khoảng 180 ms.
- Listener của phòng chat đang mở là luồng riêng, không bị tắt bởi tối ưu badge.
- Unread state vẫn dựa trên dữ liệu Firestore, không mất khi listener tạm nghỉ ở nền.

## 13. Chuyển project không reload trong luồng bình thường
Files: `src/App.tsx`, `src/utils/dataNormalizer.ts`, `src/components/FloorPlanDefectTab.tsx`

- `switchProject()` không chờ save project cũ hoàn tất trước khi mở project mới.
- Snapshot project cũ được lưu nền; UI chuyển `activeProjectId` ngay và hydrate local project mới trước.
- Canonical redirect/auto-switch trong App dùng state switch, không `window.location.reload()`.
- `active_project_id` ưu tiên `sessionStorage` cho tab hiện tại; localStorage chỉ giữ last-used fallback cho tab/phiên mới.
- Giảm tình trạng hai tab cùng origin đè active project của nhau.
- Các reload phục vụ restore/Drive/recovery đặc biệt vẫn được giữ; bản này không xóa reload một cách mù quáng ở các workflow cần reset toàn app.

## 14. Project cùng tên nhưng khác ID – canonical identity an toàn
Files: `src/lib/firebase.ts`, `src/components/ProjectManagerModal.tsx`, `src/App.tsx`

- Bổ sung `canonicalProjectId`/`aliases` cho lớp discovery/display, tương thích dữ liệu cũ.
- Chặn tạo mới project trùng tên rõ ràng khi đã có candidate hợp lệ.
- “So sánh & hợp nhất vào ID này” nâng cấp theo hướng canonical:
  - dữ liệu nghiệp vụ được hợp nhất vào ID đích do Admin chọn;
  - member active có thể được transfer sang project canonical khi tài khoản hiện tại có quyền ADMIN phù hợp;
  - source project được đánh dấu `canonicalProjectId/mergedIntoProjectId`;
  - source KHÔNG bị xóa tự động, tránh mất dữ liệu/chat cũ;
  - danh sách chỉ collapse alias khi tài khoản hiện tại thực sự đọc được canonical target.
- Không tự gộp chỉ dựa vào tên giống nhau; thao tác destructive/identity merge vẫn cần Admin chủ động chọn.

## 15. Service Worker/version
- `package.json`: 6.2.11.
- `package-lock.json`: 6.2.11.
- `src/config/appVersion.ts`: `V6.2.11 – Realtime Performance & Project Identity Hardening`.
- Firebase Hosting workflows: `VITE_APP_VERSION=V6.2.11`.
- PWA cache name tăng từ v5 lên v6 để tránh client tiếp tục dùng bundle cũ sau update.

## Kiểm tra đã chạy
- Static TypeScript/TSX transpile: **84 files, 0 syntax errors**.
- Kiểm tra relative imports local: **0 import bị thiếu**.
- `package.json` ↔ `package-lock.json`: **0 dependency declaration mismatch**.
- Version package/lock/root lock: **6.2.11 đồng nhất**.
- YAML parse: `build.yml`, Firebase merge workflow, Firebase PR workflow: **PASS**.
- Firestore Rules: không chỉnh rules trong nhóm performance này; cấu trúc source hiện tại được giữ.
- `npm run lint`: **chưa xác nhận PASS trong container** vì `node_modules` local không cài hoàn chỉnh; lỗi hiện ra là thiếu package/type (`react`, `firebase`, `localforage`, Node types...), không phải lỗi source riêng đã xác nhận.
- `npm run build`: **chưa xác nhận PASS trong container** vì local `vite` chưa được cài (`vite: not found`).
- Không ghi Build PASS giả. Khi người dùng chủ động push, GitHub Actions sạch là bước xác nhận production cuối cùng.

## Những phần cố ý chưa đưa vào V6.2.11
Để tránh một release performance biến thành rewrite UI quá lớn:
- Chưa thêm thư viện virtual-scrolling mới cho mọi danh sách 500 dòng; đây nên là phase riêng sau khi đo lại lag Firestore.
- Chưa thêm công tắc UI “Chế độ nhẹ” riêng. Những tối ưu nhẹ quan trọng (badge active-only, ảnh lazy, photo sync delay, root throttle) hiện được áp dụng mặc định.
- Chưa tắt 9 listener business subcollection của active project theo từng tab. Chúng vẫn **chỉ scoped theo active projectId**, sử dụng incremental changes/local-first; component UI nặng đã lazy/conditional render. Nếu sau đo vẫn còn lag, phase tiếp theo mới gate từng business listener theo tab để tránh regression dữ liệu offline.

## Acceptance test sau khi người dùng quyết định push
1. GitHub Actions: Install dependencies → Typecheck → Build xanh.
2. Account A mở Project A; Account B mở Project B.
3. Sửa A: console B không nhận business realtime của A nếu B không authorized A.
4. Không còn `[user index write] ... written` lặp vô hạn với cùng project/name/role.
5. `[discovery emit]` không chạy nhiều lần/giây khi app idle.
6. Root metadata không update mỗi autosave 6 giây khi chỉ sửa subcollection.
7. Chuyển project mở local trước, không full-page reload.
8. Defect/Quân số list chỉ hiện số ảnh; thumbnail chỉ tải khi bấm xem.
9. Tab hidden không giữ chat badge listener; quay lại app unread refresh đúng.
10. Với duplicate same-name project, Admin chọn canonical ID rõ ràng; source không bị xóa; member khác sau refresh phải đi vào canonical target khi transfer/permission hoàn tất.

## Commit đề xuất
`V6.2.11 - Optimize realtime sync and harden project identity`

## Rà soát lại sau khi đóng ZIP lần đầu
Sau khi mở lại chính FULL SOURCE/PATCH V6.2.11 và rà thêm các race-condition, đã sửa thêm 3 điểm trước khi chốt lại ZIP:

1. **Photo sync không bị mất lượt khi app chuyển nền đúng lúc delay 8 giây**
   - Trước rà soát: nếu timer initial photo sync tới hạn trong lúc tab hidden, lượt sync bị bỏ và không chắc được lên lịch lại trong cùng phiên.
   - Sau sửa: giữ cờ `initialUploadNeeded`; khi app visible lại sẽ schedule lại idle sync. Nếu sync lỗi tạm thời, có retry nền sau khoảng 30 giây. Cleanup timer/listener đầy đủ khi đổi tab/project.

2. **Repair invitation không bị đánh dấu hoàn tất khi có member ghi lỗi**
   - Trước rà soát: một hoặc nhiều `projectInvitations` lỗi vẫn có thể khiến project bị đưa vào completed-set, làm mất cơ hội auto retry trong phiên.
   - Sau sửa: chỉ đưa project vào `projectAccessRepairCompleted` khi toàn bộ invitation bắt buộc đã ghi thành công. `projectAccess` vẫn là optional/best-effort.
   - Owner `docChanges()` có thể gọi repair lại trên thay đổi tiếp theo; completed-set sẽ chặn ngay khi repair đã thành công, nên không quay lại vòng lặp nặng.

3. **Chat badge hidden-state cleanup chặt hơn**
   - Khi app/tab chuyển nền, ngoài unsubscribe summary/read listener còn hủy timer debounce đang chờ và bỏ pending UI state cũ.
   - Khi quay lại foreground, listener được tạo lại và đọc unread state mới từ Firestore; không render một update badge trễ sau khi tab đã hidden.

### Kết quả recheck cuối
- FULL/PATCH được tái tạo từ source đã sửa lại, không dùng ZIP cũ.
- TypeScript/TSX static parse: **84 files, 0 syntax errors**.
- Relative local imports: **0 missing**.
- `package.json` ↔ root `package-lock.json`: **0 mismatch**.
- Version: package/lock/root lock = **6.2.11**.
- YAML parse: 3 workflows **PASS**.
- `firestore.rules`: **không thay đổi** so với V6.2.10 trong nhóm performance này.
- `npm ci --offline`: không thể hoàn tất vì npm cache của container thiếu package `yargs-parser`; vì vậy vẫn không ghi `npm run lint/build PASS` giả. GitHub Actions là xác nhận production cuối cùng sau khi người dùng quyết định push.
