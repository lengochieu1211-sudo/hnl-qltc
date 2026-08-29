# HNL QLTC Windows EXE — RC2.2.7

## Mục tiêu

Tạo một file portable `HNL-QLTC-Windows.exe` cho Windows 10/11 PC/laptop. EXE mở ứng dụng production tại `https://hnlqltc.web.app/?app=desktop` trong chế độ app-window của Microsoft Edge. Nếu Edge không có, launcher thử Google Chrome; cuối cùng mới mở trình duyệt mặc định.

## Dữ liệu và offline

Launcher giữ nguyên thư mục profile Edge legacy `%LOCALAPPDATA%\QLTCAnPhu\EdgeProfile` để không làm mất dữ liệu local/offline đã có từ các bản desktop trước. RC2.2.7 không còn xóa Service Worker CacheStorage mỗi lần khởi động, vì thao tác đó có thể phá khả năng mở app khi mất mạng.

## Build local trên Windows

```powershell
npm ci
npm run verify
npm run build:exe:windows
```

File đầu ra: `HNL-QLTC-Windows.exe`.

## Build bằng GitHub Actions

Workflow `.github/workflows/windows-exe.yml` chạy trên `windows-latest`, kiểm Stability Gate, TypeScript, Lint và Vite build trước khi tạo EXE, sau đó upload artifact `HNL-QLTC-Windows-EXE-*`.

## Lưu ý Windows SmartScreen

EXE hiện chưa có chứng thư Authenticode thương mại. Windows có thể hiện cảnh báo "Unknown publisher"/SmartScreen ở lần chạy đầu. Không nên dùng self-signed certificate làm release signing vì nó không tạo được chuỗi tin cậy cho máy người dùng. Khi có code-signing certificate chính thức, có thể bổ sung bước ký vào workflow mà không đổi dữ liệu ứng dụng.
