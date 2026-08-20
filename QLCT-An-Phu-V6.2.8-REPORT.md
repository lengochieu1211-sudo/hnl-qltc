# QLCT An Phú V6.2.8 – Project Access Refresh & Build Fix

## Nền nâng cấp
- Nâng trực tiếp từ V6.2.7.
- Không đổi Firebase project, Hosting URL, repo, projectId hay dữ liệu nghiệp vụ.
- Không migration phá dữ liệu cũ.
- Giữ nguyên Defect marker scaling/readability đã chỉnh ở V6.2.7.

## 1. Sửa lỗi Build #51 của V6.2.7
- `src/components/FloorPlanDefectTab.tsx` gọi `getProjectPhotos()` nhưng hàm không được import trong scope.
- TypeScript báo: `Cannot find name 'getProjectPhotos'`.
- Đổi sang `getEntityPhotos(projectId, 'defect', defectId, 'defect_after')`, là API đã được import và đúng mục đích kiểm tra ảnh sau sửa.
- Không đổi schema ảnh/Defect.

## 2. Chủ động phục hồi Danh sách dự án theo tài khoản Google
Thêm `refreshCurrentUserProjectDiscovery()` trong `src/lib/firebase.ts`:
- Mỗi lần chạy sẽ query cả invitation mới (`invitedEmail`) và invitation legacy (`email`).
- Mỗi invitation phải khớp đúng email Google đang đăng nhập.
- Không tin invitation một cách mù quáng: trước khi ghi index, app kiểm tra quyền thật bằng `fetchProjectUserRoleFromCloud(projectId, user)`.
- Chỉ khi Firestore xác nhận tài khoản còn là member/owner mới ghi `users/{uid}.projects`.
- Dữ liệu được ghi chỉ vào document của chính UID đang đăng nhập.

## 3. Project Manager tự resubscribe khi Auth thay đổi
- Trước V6.2.8, listener danh sách project chủ yếu phụ thuộc `isOpen`.
- Nếu modal mở đúng lúc Firebase đang restore/switch Google Auth, listener có thể được tạo với trạng thái auth chưa sẵn sàng và giữ cache cũ.
- V6.2.8 đưa Google user state lên trước project subscription.
- Subscription phụ thuộc `isOpen + googleUser.uid + googleUser.email`.
- Đổi tài khoản hoặc Firebase restore xong sẽ tự cleanup listener cũ và subscribe lại.
- Trước khi subscribe, modal chủ động gọi `refreshCurrentUserProjectDiscovery()`.

## 4. Global project/chat discovery cũng tự refresh
- `App.tsx` gọi `refreshCurrentUserProjectDiscovery()` khi `cloudUserKey` thay đổi.
- Nhờ vậy Chat/danh sách project không phụ thuộc việc người dùng phải mở Project Manager trước.
- Khi invitation được materialize vào `users/{uid}.projects`, realtime listener tự nhận cập nhật.

## 5. Tăng độ chắc chắn khi Admin repair member cũ
- `repairProjectAccessIndexForProject()` không còn chạy invitation và `projectAccess` lẫn lộn trong một nhóm Promise.
- Mỗi active member được tạo `projectInvitations` tương thích Rules cũ trước.
- `projectAccess` chỉ chạy sau đó và vẫn là best-effort.
- Nếu production Firestore vẫn đang dùng Rules cũ, lỗi `projectAccess` không thể ngăn invitation discovery.

## 6. Security Modal
- Khi đã xác minh tài khoản là member, app vẫn thử chạy discovery repair.
- Backend Rules là lớp quyết định cuối: chỉ ADMIN/Owner thật mới có quyền tạo invitation.
- Không mở thêm quyền cho VIEWER/ENGINEER.

## 7. Firestore Rules / GitHub Actions
- Hosting V6.2.7 đã deploy xanh.
- Firestore Rules mới vẫn chưa deploy thật vì GitHub service account nhận HTTP 403 ở `firebaserules.rulesets.test`.
- V6.2.8 tiếp tục tương thích với Rules production cũ qua `projectInvitations`.
- Khuyến nghị lâu dài: cấp cho GitHub Firebase service account role `Firebase Rules Admin (roles/firebaserules.admin)` rồi deploy Rules lại.
- Không đưa credential/private key vào source.

## 8. Validation
- `package.json` và `package-lock.json`: dependency ranges đồng bộ, 0 mismatch.
- YAML parse:
  - `.github/workflows/build.yml`: PASS
  - `.github/workflows/firebase-hosting-merge.yml`: PASS
  - `.github/workflows/firebase-hosting-pull-request.yml`: PASS
- Global `tsc --noEmit` trong môi trường không có node_modules vẫn báo các module/type package bị thiếu như mong đợi.
- Sau khi lọc riêng các lỗi môi trường đó, **0 lỗi source TypeScript còn lại**.
- Lỗi source duy nhất của V6.2.7 (`getProjectPhotos`) đã được sửa.
- `npm ci` trong container vẫn không hoàn tất do môi trường/network, vì vậy Build production cuối cùng cần xác nhận bằng GitHub Actions.

## 9. Test sau deploy
1. Owner/Admin mở app.
2. Mở dự án LTIA hoặc Trung tâm bảo mật một lần để repair invitation member cũ.
3. Tài khoản VIEWER mở/refresh app.
4. `Danh sách dự án` phải hiển thị LTIA.
5. Mizuki vẫn hiển thị đúng role Kỹ sư.
6. Chuyển Google account khi Project Manager đang mở: danh sách phải đổi theo tài khoản, không giữ cache tài khoản cũ.
7. Chat chỉ hiển thị project mà realtime Cloud xác nhận.
8. Build GitHub Actions phải qua bước Typecheck sau khi `getProjectPhotos` được sửa.

## File thay đổi
- `.github/workflows/firebase-hosting-merge.yml`
- `.github/workflows/firebase-hosting-pull-request.yml`
- `package.json`
- `package-lock.json`
- `src/App.tsx`
- `src/components/FloorPlanDefectTab.tsx`
- `src/components/ProjectManagerModal.tsx`
- `src/components/SecurityModal.tsx`
- `src/config/appVersion.ts`
- `src/lib/firebase.ts`
