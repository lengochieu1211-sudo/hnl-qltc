# HNL QLTC V6.3.0 RC2.2.7 — Windows EXE Addendum

## Phạm vi

Bổ sung bản Windows portable `.exe` cho PC/laptop trên đúng baseline RC2.2.7 hiện tại. Không đổi Firebase Project, projectId, Hosting site, repo GitHub hoặc dữ liệu ứng dụng.

## Đã sửa / bổ sung

- Desktop launcher chuyển URL từ Hosting legacy sang `https://hnlqltc.web.app/?app=desktop`.
- Giữ nguyên `%LOCALAPPDATA%\QLTCAnPhu\EdgeProfile` để bảo toàn local/offline data của desktop wrapper cũ.
- Bỏ cơ chế xóa Service Worker CacheStorage khi mở app; đây là nguyên nhân có thể làm mất cache offline ở desktop.
- Thêm Chrome fallback và default-browser fallback khi Edge không tồn tại.
- Thêm release tag `6.3.0-rc2.2.7` vào URL để tách cache/version rõ ràng.
- Chuẩn hóa file portable đầu ra: `HNL-QLTC-Windows.exe`.
- Giữ icon desktop hiện có để không làm thay đổi nhận diện trong lần chốt RC2.2.7 này.
- Thêm `desktop-wrapper/BUILD-EXE.cmd` để có thể double-click build trên Windows 10/11.
- Thêm GitHub Actions Windows EXE gate và artifact.
- Thêm Desktop Launcher Golden regression test.
- Đồng bộ R2 gateway thật `https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev` vào cấu hình PROD/APK hiện tại.
- Sửa Stability Gate để chấp nhận gateway PROD được cấu hình bằng repository variable hoặc URL Worker HTTPS đã pin. GitHub Build #99/APK #6 trước đó fail tại gate này sau khi URL Worker được pin trực tiếp; source hiện đã sửa nguyên nhân gốc.

## File thay đổi/thêm

- `.github/workflows/windows-exe.yml` (mới)
- `desktop-wrapper/BUILD-EXE.cmd` (mới)
- `desktop-wrapper/QLTCAnPhuLauncher.cs`
- `desktop-wrapper/build-launcher.ps1`
- `desktop-wrapper/release-tag.txt` (mới)
- `docs/WINDOWS_EXE_BUILD.md` (mới)
- `package.json`
- `scripts/desktop-launcher-golden.mjs` (mới)
- `scripts/stability-gate.mjs`
- `HNL-QLTC-V6.3.0-RC2.2.7-WINDOWS-EXE-ADDENDUM.md`

## Release gate

Nhánh RC2.2.7 phải chạy lại Build + Android APK + Windows EXE trên GitHub Actions. Chỉ xem EXE là VERIFIED sau khi Windows runner tạo `HNL-QLTC-Windows.exe`, kiểm kích thước/hash và upload artifact thành công.

## Lưu ý SmartScreen

EXE hiện chưa có chứng thư Authenticode thương mại, nên Windows có thể hiển thị `Unknown publisher`/SmartScreen ở lần chạy đầu. Không dùng self-signed certificate làm release signing vì không tạo chuỗi tin cậy cho máy người dùng.
