# HNL QLTC P20.3.7 — HEALTH PASS / APP PREVIEW CANDIDATE READY
Ngày 27/10/2026 Việt Nam.

## Đã xác minh
Ảnh người dùng gửi lúc8:54 cho thấy endpoint /health: ok=true, service hnl-qltc-r2-gateway, version6.3.0-p20.3.6-backup, firebaseProjectId hnl-qltc-dev-backup, canonical-email-first, immutable-deleted-project-v2, token-only, quotaUserPartitioning disabled, firestoreAuthRetryAttempts4.
Đây là health PASS từ điện thoại; chưa phải authenticated R2 upload/download PASS. Terminal trước đó403/1010 không bị lách.

GitHub đọc lại ngày27/10: repo lengochieu1211-sudo/hnl-qltc; dev HEAD d6effaf03a08a9879fa172a345992922916036d2; main HEAD57eea2b878e17da64d7a6191fda178eaff3b8488. Khớp baseline lịch sử. Không ghi GitHub. Nguồn tiếp tục là FULL SOURCE P20.3.3 có các sửa P20.3.1 và PDF worker P20.3.3, không chép ngược GitHub làm mất WIP.

## Thay đổi source tối thiểu
- scripts/dev-backup-hosting.mjs: chỉ chấp nhận URL rỗng (media disabled) hoặc đúng chuỗi https://hnl-qltc-r2-gateway-dev-backup.lengochieu1211.workers.dev; chặn path/query/fragment/credentials/port/trailing slash và host khác qua kiểm tra kết hợp validator.
- Build staging bắt buộc bundle chứa đúng gateway khi env bật; env tắt không được stage bundle vẫn chứa gateway.
- Manifest ghi mediaGateway, kiểm đối chiếu khi verify; giữ checksum/danh sách file/PDF worker/loại trừ secrets và server.
- scripts/dev-backup-hosting-golden.mjs thêm6 nhóm kiểm thử.
- .env.dev-backup.local và .env.local cục bộ bật URL backup; không đưa env local vào FULL SOURCE. Có backup-env.txt cấu hình web public để tái tạo trong PATCH.
Không thay logic nghiệp vụ app, Rules, Firebase metadata, Worker, DEV chính, PROD, dữ liệu thật hoặc GitHub main ở mốc này.

## Kiểm thử / build
Hosting guard25/25 PASS. Target switch16/16 PASS. Source lint PASS. Vite+esbuild PASS (cảnh báo chunk lớn/dynamic import hiện hữu).
Typecheck lần đầu hết heap2GiB; chạy lại tsc --noEmit với heap4GiB: PASS.
Staging100 webfiles+release manifest; verify checksum và exact gateway PASS.
Một lần kiểm tra sau build phát hiện thêm file asset cũ trong staging: fail-closed STAGING_FILE_SET_CHANGED. Đã stage sạch lại và verify PASS; gói preview chỉ lấy đúng các file có trong manifest và kiểm riêng bằng runner PASS.
Gateway local24/24 đã PASS ở P20.3.6, không chạy lại không cần thiết.
Không tuyên bố full stability/Rules regression được chạy lại ở mốc này. Rules owner gate và kết quả18/18 giữ theo checkpoint trước.

## Gói
PREVIEW-READY.zip: chỉ100webfiles+manifest, config Hosting backup, runner preview cố định, README; không cần build lại. Chỉ candidate để deploy preview kiểm thử, không LIVE release.
PATCH.zip:2script thay đổi + public backup-env.txt + WORK_STATE; không chứa token/secrets.
FULL-SOURCE.zip: baselineP20.3.3 chồng đúng2script vàWORK_STATE, không node_modules/dist/envlocal.
WIP – NOT RUNTIME VERIFIED – DO NOT DEPLOY AS LIVE.
App version6.3.0 giữ nguyên, checkpointcandidateP20.3.7 định danh bằng release manifest/checksum.

## Blocker / next
Chưa deploy bản preview mới: không có Firebase connector tools trong phiên và không có CLI Firebase authenticated trong môi trường này. Cloudflare plugin quyền Cloudflare không cấp quyền Firebase. Phiên CLI người dùng đã đăng nhập trên Windows không chuyển sang đây. Người dùng hiện dùng điện thoại.
Không lấy token/cookie browser, không proxy qua Worker để vượt chặn, không thêm domain/provider khác.
Khi có máy tính authenticated, giải nén PREVIEW-READY vào thư mục mới, chạy node deploy-preview.mjs --check rồi node deploy-preview.mjs --deploy-backup-preview. Cố định channel p2031-check và projectbackup, không authorized domains update.
Preview hiện vẫn version687dd049f6623e7a, URL https://hnl-qltc-dev-backup--p2031-check-3qq5e4f0.web.app với gateway rỗng. Cần deploy rồi kiểm authenticated image upload→R2→Firestore pointer→reload→thiết bịkhác.
Dữ liệu giả giữ nguyên: proj_f8cc6fed-a2eb-4456-bebd-6ab07e573610; crew_1793058144418 (sáng4/chiều2/revision2); tầng QA PDF metadata có nhưng ảnh chưa lưu cloud ở bảnpreviewcũ.
Chưa RuntimeGolden/CERTIFIED. Multiuser, multidevice, offline/reconnect, EXE/APK còn pending.
