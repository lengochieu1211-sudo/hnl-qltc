# QLCT An Phú V6.2.19 – Build Fix & Floor Plan Navigation Stabilization

## Lỗi GitHub Actions
V6.2.18 bị TypeScript exit code 2 vì nhóm state/ref mới của Floor Plan được dùng trước khi khai báo:
- `lockedRoomIds` used before its declaration.
- `lockedDefectIds` used before its declaration.

## Sửa
- Chuyển toàn bộ cụm state/ref điều hướng lên trước các `useEffect` sử dụng nó:
  `zoomScale`, `showMiniMap`, `showLayerPanel`, `mapLayers`, `lockedRoomIds`,
  `lockedDefectIds`, `viewportInfo`, `floorViewRestoringRef`,
  `projectUiSettingsHydratingRef`, `miniMapDragRef`, `pendingFocusRef`.
- Không đổi logic Mini-map / Focus / Fit / Layers / Lock.
- Giữ zoom-to-cursor và giới hạn 1x..20x.
- Đồng bộ version JSON/TS/workflow thành V6.2.19.
- Firestore Rules giữ nguyên V6.2.18.

## Kiểm tra
- `lockedRoomIds`: khai báo dòng 684, persistence dùng từ dòng 771 → PASS.
- `lockedDefectIds`: khai báo dòng 685, persistence dùng từ dòng 776 → PASS.
- `projectUiSettingsHydratingRef`: khai báo dòng 688, dùng từ dòng 746 → PASS.
- TypeScript/TSX syntax parse: 85 file, 0 lỗi syntax.
- Relative imports: 0 thiếu.
- package.json/package-lock/appVersion: 6.2.19 đồng bộ.
- Firestore Rules: unchanged.

## Build production
Môi trường hiện tại không có đủ `node_modules`; lần `npm ci` trước bị timeout nên không ghi Build PASS giả.
Sau khi push V6.2.19, GitHub Actions là kiểm tra production cuối cùng.

## Không thực hiện
- Không push GitHub.
- Không deploy Firebase.
- Không thay projectId / Drive / dữ liệu.
