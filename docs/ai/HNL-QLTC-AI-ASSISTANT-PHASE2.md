# HNL QLTC AI Assistant — Phase 2 Deterministic Audit Engine

Branch: `feature/hnl-ai-assistant`

## Mục tiêu

Phase 2 bổ sung Rule/Audit Engine read-only. Không có model AI, không có provider, không có Firestore write, không thay đổi schema dữ liệu.

Nguyên tắc:

- Rule Engine kết luận trước; AI chỉ được giải thích sau.
- Audit chạy trên `HnlAiProjectSnapshot` đã giới hạn đúng `projectId`.
- Không tự sửa `roomId`, `floorId`, `teamId`, khối lượng hoặc quân số.
- `ERROR`, `WARNING`, `REVIEW` được tách rõ để tránh biến giả định nghiệp vụ thành lỗi cứng.
- Mọi issue có `ruleId`, entity, evidence và details truy ngược được.

## Quantity Audit

File: `src/ai/audit/quantityAudit.ts`

Rule hiện có:

- `QUANTITY_PLANNED_INVALID`
- `QUANTITY_PLANNED_NEGATIVE`
- `QUANTITY_ACTUAL_INVALID`
- `QUANTITY_ACTUAL_NEGATIVE`
- `QUANTITY_ACTUAL_WITH_ZERO_PLAN`
- `ACTUAL_GT_CONTRACT`
- `PROGRESS_GT_100`
- `DUPLICATE_WORK_VOLUME_SCOPE`
- `ROOM_QUANTITY_INVALID`
- `ROOM_QUANTITY_NEGATIVE`
- `ROOM_CATEGORY_QUANTITY_INVALID`
- `ROOM_CATEGORY_QUANTITY_NEGATIVE`
- `SUBITEM_QUANTITY_INVALID`
- `SUBITEM_QUANTITY_NEGATIVE`
- `INSPECTED_WITH_UNFINISHED_WORK`
- `ROOM_DONE_WITH_UNFINISHED_SUBITEM`
- `MIXED_UNIT_SAME_WORK_ITEM`
- `FLOOR_ROOM_SUM_MISMATCH`
- `ROOM_ASSIGNED_GT_CONTRACT`

### Guard chống double counting

`RoomSubItem.workVolume` không được cộng trực tiếp thành tổng hạng mục. Các công đoạn tuần tự như Khung/Tấm có thể cùng tham chiếu một diện tích; cộng các dòng này sẽ nhân đôi khối lượng.

So sánh tổng Căn/Phòng với WorkVolume chỉ chạy khi engine tìm được đúng một record cùng:

- floorId;
- hạng mục;
- đơn vị.

Nếu không đủ điều kiện thì không tự kết luận.

## Crew Audit

File: `src/ai/audit/crewAudit.ts`

Rule hiện có:

- `CREW_DATE_INVALID`
- `CREW_COUNT_INVALID`
- `CREW_COUNT_NOT_INTEGER`
- `CREW_TEAM_NOT_FOUND`
- `CREW_TEAM_ID_MISSING`
- `CREW_TEAM_AMBIGUOUS`
- `CREW_TEAM_ID_NAME_MISMATCH`
- `CREW_FLOOR_NOT_FOUND`
- `CREW_FLOOR_ID_NAME_MISMATCH`
- `CREW_WORKERCOUNT_SHIFT_MISMATCH`
- `CREW_INSIDE_OUTSIDE_TOTAL_MISMATCH`
- `CREW_EXACT_DUPLICATE`
- `CREW_TEAM_DAY_SHIFT_CONFLICT`

### Business rule quan trọng

Không tính `sáng + chiều + tối` thành unique headcount.

Audit sử dụng `getCrewShiftCounts()` để chuẩn hóa từng ca và chỉ đưa các trường hợp xung đột thành `REVIEW` khi có khả năng dữ liệu thực tế là phân bổ theo khu vực/tầng.

Không suy diễn unique worker khi schema không lưu danh tính từng công nhân.

## Project Integrity Audit

File: `src/ai/audit/projectAudit.ts`

Audit tổng hợp:

- Defect Audit;
- Quantity Audit;
- Crew Audit;
- cross-reference toàn project.

Cross-reference hiện kiểm tra:

- Room → Floor;
- Room → Team;
- RoomSubItem → Team;
- WorkVolume → Floor;
- MaterialNorm → WorkCategory;
- Checklist → Floor/Room/Team;
- Inventory provenance → Room/Floor/MaterialNorm;
- duplicate active ID trong từng collection.

Các reference tới record đã soft-delete được coi là không còn active để audit phát hiện liên kết treo.

## Whitelist Tool Registry

Phase 2 chỉ thêm ba tool read-only vào whitelist:

- `auditQuantityData`
- `auditCrewData`
- `auditProjectIntegrity`

Cùng các tool trước:

- `resolveTeam`
- `getTeamSummary`
- `getCurrentTeamProgress`
- `auditDefectLinks`

Model tương lai không được truyền JavaScript, Firestore path hoặc query tùy ý để chạy.

## Regression

Golden mới:

`npm run test:ai-audit`

Fixture bắt buộc xác nhận:

- actual > planned;
- progress > 100%;
- nghiệm thu đạt trong khi hạng mục chưa hoàn thành;
- mixed units;
- room sum vượt contract;
- crew duplicate;
- crew shift conflict;
- orphan team/floor;
- invalid crew date/count;
- Room/Checklist/Inventory/MaterialNorm broken references;
- audit không mutate source.

`HNL AI Core Gate` chạy tuần tự:

1. `npm ci`
2. `test:ai-core`
3. `test:ai-tools`
4. `test:ai-audit`
5. toàn bộ Stability regression HNL QLTC hiện tại
6. TypeScript
7. Lint + secret scan
8. Firebase Rules regression
9. production dependency critical security audit
10. Build

## Không thay đổi trong Phase 2

- `dataSchemaVersion` vẫn V5.
- Không thêm Firestore collection.
- Không thay Firebase Project.
- Không thay R2 Gateway.
- Không thêm AI API key.
- Không deploy DEV/PROD từ branch này.
- Không chỉnh `App.tsx` hay UI nghiệp vụ.
- Không merge `dev`/`main`.

## Bước kế tiếp đề xuất

Phase 2B/3A chỉ nên bắt đầu sau khi gate Phase 2 xanh hoàn toàn:

1. Query Planner deterministic cho các intent whitelist.
2. Tool-call schema validator.
3. Evidence/Fact renderer contract để UI không lấy số từ prose model.
4. Sau đó mới tạo AI Provider interface + DEV AI Gateway riêng.

AI Provider vẫn chưa được phép ghi dữ liệu.
