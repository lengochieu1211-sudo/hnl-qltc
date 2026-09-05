# HNL QLTC AI Assistant — Phase 1A

## Mục tiêu

Phase 1A tạo nền deterministic cho HNL AI Assistant. Chưa có AI Provider, chưa có chatbot UI, chưa có write action và không thay đổi schema Firestore hiện tại.

Nguyên tắc bắt buộc:

- Code tính trước, AI giải thích sau.
- Rule Engine kiểm tra trước, AI giải thích sau.
- Tool chỉ nhận project context đã xác minh quyền.
- Không cho model tự tạo Firestore query.
- Không cộng các đơn vị khác nhau.
- Không tự resolve team bằng fuzzy match.
- Audit Defect chỉ đọc, không tự sửa roomId/teamId/floorId.
- VIEWER/EDITOR không được đưa dữ liệu tài chính vào AI payload.
- Offline/cache vẫn chạy được deterministic calculation/audit.

## Source base

- Base branch: `dev`
- Base commit: `1dd7376549927d59ff79edf04426f184e93415a9`
- Feature branch: `feature/hnl-ai-assistant`
- `dataSchemaVersion` giữ nguyên V5.
- Firebase/R2/Hosting Production không thay đổi.

## Thành phần Phase 1A

### Core contracts

`src/ai/core/contracts.ts`

Chuẩn hóa:

- `AiQueryContext`
- `AiToolResult<T>`
- `AiFact`
- `AiEvidenceRef`
- `AiToolMetadata`
- `AiQuantityObservation`
- `AiTeamSummaryData`
- `AiAuditIssue`

Kết quả deterministic phân biệt rõ `FACT` / `CALCULATED`. `INFERENCE` / `RECOMMENDATION` dành cho lớp AI sau này.

### Canonical date range

`src/ai/core/dateRange.ts`

Phase 1A chỉ chấp nhận date range canonical `YYYY-MM-DD`. Natural-language date resolver (`hôm nay`, `tuần này`, ...) sẽ làm ở Phase 1B sau khi timezone policy được chốt.

### Team resolver

`src/ai/core/entityResolver.ts`

- ID thật được ưu tiên.
- Exact normalized name được phép resolve.
- Prefix/near match chỉ trả candidates và trạng thái `ambiguous`.
- Không tự chọn `Nguyên` giữa `Nguyên 1` và `Nguyên 2`.

### Permission + sanitization

`src/ai/security/aiPermissionGuard.ts`

- Context phải có `accessVerified=true` và đúng `projectId`.
- Tái sử dụng RBAC hiện có.
- Financial fields bị loại khỏi payload nếu role không có quyền xem financial data.
- Sanitizer chạy recursive để tránh dữ liệu tài chính nằm trong nested object lọt sang provider/cache.

### Team summary engine

`src/ai/calculations/teamSummary.ts`

- Quân số group theo `team/date/shift` và lấy max mỗi ca để tránh record nhiều tầng làm nhân đôi số người.
- Business rule hiện hành: sáng/chiều/tối mỗi ca = 0,5 công.
- Quantity group theo `workItem + normalized unit`.
- Productivity group theo unit: `same-unit quantity / team-period man-day`.
- Không tồn tại một field `totalQuantity` chung khi có nhiều đơn vị.
- Thiếu dữ liệu trả `partial`/`insufficient-data`, không tạo số ước đoán.

`AiQuantityObservation` là canonical adapter contract, KHÔNG phải Firestore schema mới. Phase 1B sẽ xác định nguồn lịch sử nào có đủ timestamp để build observation thực tế. Current room/work-volume snapshot không được dùng để giả lập lịch sử ngày nếu source không có evidence.

### Defect linkage audit

`src/ai/audit/defectAudit.ts`

Các rule đầu tiên:

- `DEFECT_FLOOR_NOT_FOUND`
- `DEFECT_ROOM_ID_MISSING`
- `DEFECT_ROOM_AMBIGUOUS`
- `DEFECT_ROOM_NOT_FOUND`
- `DEFECT_ROOM_FLOOR_MISMATCH`
- `DEFECT_PIN_OUTSIDE_LINKED_ROOM`
- `DEFECT_TEAM_NOT_FOUND`
- `DEFECT_TEAM_ID_NAME_MISMATCH`
- `DEFECT_TEAM_DIFFERS_FROM_ROOM_TEAM`
- `DEFECT_TEAM_ID_MISSING`
- `DEFECT_TEAM_AMBIGUOUS`

`Defect.teamId != Room.teamId` chỉ là `REVIEW`, không phải lỗi tuyệt đối, vì Defect có thể được phân công riêng.

## Golden regression

`scripts/ai-core-golden.ts`

Kiểm tra tối thiểu:

1. Team Summary đúng date range, man-day và quantity by unit.
2. Duplicate crew rows theo tầng không double count workforce.
3. Team near-name không tự chọn sai.
4. Defect pin/room mismatch được phát hiện.
5. Defect orphan teamId được phát hiện.
6. Defect room/floor mismatch được phát hiện.
7. VIEWER không nhận financial fields.
8. ADMIN giữ financial fields.
9. Offline/cache deterministic calculation vẫn chạy.
10. Thiếu quantity không hallucinate productivity.

Chạy:

```bash
npm run test:ai-core
```

## Không làm trong Phase 1A

- Không AI Provider.
- Không API key.
- Không AI Gateway.
- Không sửa Firestore Rules.
- Không thêm collection AI.
- Không UI HNL AI.
- Không action ghi dữ liệu.
- Không Internet Search.
- Không File AI/RAG.
- Không deploy Production.

## Bước sau khi Phase 1A gate xanh

Phase 1B sẽ xây read-only Data Adapter/Tool Registry trên source hiện tại, ưu tiên:

- `resolveTeam`
- `getTeamSummary`
- `getCrewAttendance`
- `getDefectSummary`
- `auditDefectLinks`

Đặc biệt phải audit nguồn historical quantity trước khi hỗ trợ chính thức câu hỏi khối lượng theo khoảng ngày. Nếu source hiện tại chỉ có snapshot, engine phải trả `Không đủ dữ liệu lịch sử` thay vì suy diễn từ snapshot hiện tại.
