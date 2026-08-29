# HNL MASTER DEVELOPMENT GUIDELINE

> **Tên file bắt buộc:** `HNL-MASTER-DEVELOPMENT-GUIDELINE.md`  
> **Vị trí:** root của mỗi repository HNL  
> **Mục đích:** quy định chung cho toàn bộ vòng đời phát triển, kiểm thử, sao lưu, GitHub, phát hành và tiếp tục công việc bằng AI/người phát triển.

---

## 0. PHẠM VI VÀ THỨ TỰ ƯU TIÊN

Tài liệu này là **quy tắc chung** áp dụng cho mọi dự án HNL. Mỗi repository chỉ bổ sung các quy tắc riêng ở mục **PROJECT-SPECIFIC RULES** cuối tài liệu.

Khi có xung đột, áp dụng thứ tự:

1. Yêu cầu trực tiếp mới nhất của chủ dự án.
2. `PROJECT-SPECIFIC RULES` của repository hiện tại.
3. Tài liệu Master này.
4. README/tài liệu kỹ thuật khác.
5. Giả định của AI hoặc người phát triển.

Không được tự suy diễn để vượt qua quy tắc nguồn, dữ liệu, bảo mật hoặc phát hành.

---

# 1. SOURCE OF TRUTH – NGUỒN CHÍNH DUY NHẤT

Mỗi vòng làm việc phải xác định rõ **FULL SOURCE/Baseline mới nhất**.

Bắt buộc:

- File ZIP/FULL SOURCE hoặc commit được chỉ định mới nhất là **nguồn chính duy nhất**.
- Không tự lấy code từ version cũ chép ngược vào source mới.
- Không rollback toàn bộ source chỉ để sửa một lỗi.
- Không xóa tính năng hiện có nếu chưa xác định rõ lý do và tác động.
- Khi có nhiều ZIP/branch/commit, phải kiểm tra version, timestamp, commit, changelog, package version và nội dung thực tế.
- Nếu GitHub và ZIP khác nhau, phải xác định bản nào mới hơn trước khi sửa.
- Không được báo “đã cập nhật/đã sửa/đã VERIFIED” nếu chưa kiểm chứng trên đúng source.

Mọi phiên làm việc nên ghi rõ:

```text
PROJECT:
BASELINE:
VERSION:
BRANCH:
COMMIT:
WORK STATUS:
NEXT STEP:
```

---

# 2. QUẢN LÝ VERSION

Mỗi release/candidate phải có version rõ ràng.

Ví dụ:

```text
v2.8.1 -> v2.8.2
RC2.2.5 -> RC2.2.6
```

Không nên tạo liên tục các bản vá vụn như `RC2.2.5.1`, `.2`, `.3` nếu có thể gom thành một Release Gate.

Version phải được đồng bộ ở các nơi phù hợp:

- `package.json` / app metadata;
- giao diện About/Version;
- PWA/service worker/cache key;
- Android wrapper;
- Desktop/EXE wrapper;
- build metadata;
- GitHub Release;
- tên ZIP/artifact;
- changelog/report.

Khuyến nghị ứng dụng hiển thị:

```text
Version + Build date/time + Commit SHA
```

để tránh nhầm bản cũ và bản mới.

---

# 3. KHÔNG SỬA LỖI KIỂU LẮT NHẮT

Khi phát hiện lỗi, không chỉ vá biểu hiện.

Phải đi theo chuỗi:

```text
SYMPTOM
-> ROOT CAUSE
-> SHARED MODULES
-> RELATED FLOWS
-> FIX
-> REGRESSION TEST
-> RUNTIME VERIFY
```

Ví dụ lỗi đồng bộ ảnh phải kiểm tra toàn luồng:

```text
Upload -> Storage/Drive -> Metadata -> Database -> Sync -> Cache
-> Offline -> Reconnect -> Other Users -> Other Devices
```

Mục tiêu là **sửa nguyên nhân gốc**, không tạo vòng lặp “sửa một lỗi – phát sinh lỗi khác”.

---

# 4. PHÂN LOẠI LỖI

## P0 – Critical

- mất/hỏng dữ liệu;
- sai kết quả tính toán;
- sai phân quyền nghiêm trọng;
- app crash hoặc chức năng chính không chạy;
- không build/không đăng nhập/không đồng bộ;
- lỗi bảo mật nghiêm trọng.

## P1 – High

- chức năng chính hoạt động sai;
- dữ liệu hiển thị sai;
- offline/reconnect lỗi;
- xuất Excel/PDF sai;
- UI che khuất thao tác quan trọng;
- asset/model quan trọng không hoạt động.

## P2 – Medium

- bố cục;
- UX;
- sắp xếp;
- thao tác chưa thuận tiện;
- tối ưu hiệu năng mức vừa.

## P3 – Improvement

- hiệu ứng;
- cải thiện hình thức;
- tính năng nâng cao;
- tối ưu bổ sung.

Thứ tự xử lý mặc định:

```text
P0 -> P1 -> P2 -> P3
```

---

# 5. RELEASE GATE BẮT BUỘC

Không được coi “build thành công” là “ứng dụng đã ổn”.

Trước release phải kiểm tra tối thiểu:

## 5.1 Source Audit

- dead code;
- duplicate code;
- TODO/FIXME quan trọng;
- mock/placeholder;
- hard-code nguy hiểm;
- API URL/version cũ;
- dependency thừa;
- import lỗi;
- secret/key/token trong source.

## 5.2 Static Gates

- TypeScript/type check;
- lint;
- compile;
- dependency/security audit phù hợp.

## 5.3 Tests

- unit test;
- integration test;
- regression test;
- Golden Test nếu có tính toán/logic chuẩn.

## 5.4 Builds

Theo phạm vi dự án:

- Web;
- PWA;
- Windows;
- Android;
- package/plugin.

## 5.5 Runtime Verification

Phải mở ứng dụng thật và thao tác luồng chính.

---

# 6. TRẠNG THÁI KIỂM CHỨNG

Phân biệt rõ:

- **IMPLEMENTED:** đã viết code.
- **BUILD PASS:** build thành công.
- **TEST PASS:** test tự động đạt.
- **RUNTIME VERIFIED:** đã thao tác thật.
- **GOLDEN VERIFIED:** đã đối chiếu với kết quả chuẩn.
- **RELEASE VERIFIED:** toàn bộ Release Gate cần thiết đã đạt.

Không được dùng các trạng thái trên thay thế cho nhau.

---

# 7. GOLDEN TEST

Mọi logic quan trọng nên có bộ dữ liệu chuẩn:

```text
INPUT -> EXPECTED OUTPUT -> TOLERANCE -> PASS/FAIL
```

Golden fixtures nên nằm trong source, ví dụ:

```text
tests/golden/
fixtures/golden/
```

Mỗi thay đổi engine/logic phải chạy lại Golden Test liên quan.

---

# 8. PHẦN MỀM KỸ THUẬT / XÂY DỰNG

Đối với phần mềm tính toán tiêu chuẩn, phải kiểm tra chuỗi đầy đủ:

```text
Tiêu chuẩn
-> Điều
-> Bảng
-> Công thức
-> Điều kiện áp dụng
-> Đơn vị
-> Engine
-> Excel/Report
-> Kết quả
```

Mỗi công thức/bảng tra quan trọng cần provenance:

- tên tiêu chuẩn;
- năm;
- điều/khoản;
- bảng/công thức;
- trang nếu xác định được;
- điều kiện áp dụng;
- giới hạn/phạm vi.

Không tự nội suy hoặc ngoại suy khi tiêu chuẩn không cho phép.

---

# 9. TABLE / INTERPOLATION AUDIT

Mỗi bảng phải xác định rõ kiểu xử lý:

1. Exact lookup.
2. 1D interpolation.
3. 2D interpolation.
4. Step function.
5. Clamp tại biên.
6. Không được nội suy.
7. Ngoài phạm vi -> cảnh báo/lỗi.

Benchmark phải có:

- đúng mốc;
- giữa mốc;
- sát biên;
- đúng biên;
- ngoài biên;
- input không hợp lệ.

---

# 10. EXCEL TÍNH TOÁN

Excel xuất ra, khi mục tiêu là bảng tính, không nên là báo cáo tĩnh.

Nên có:

- **INPUT:** người dùng thay đổi được.
- **CALCULATION:** công thức Excel thật.
- **RESULT:** tự cập nhật.
- **REFERENCE:** nguồn tiêu chuẩn.
- **CHECK:** PASS/WARNING/FAIL.

Phải phân biệt trực quan ô nhập, ô công thức, kết quả, cảnh báo và nguồn.

Không dùng số chết thay cho công thức nếu giá trị phụ thuộc input.

---

# 11. ĐƠN VỊ

Đặc biệt kiểm soát:

- mm <-> m;
- N <-> kN;
- Pa <-> kPa <-> MPa;
- mm² <-> m²;
- kN/m² <-> kPa.

Engine nên có hệ đơn vị nội bộ thống nhất và hàm chuyển đổi tập trung.

---

# 12. DỮ LIỆU VÀ ĐỒNG BỘ

Không coi “máy A nhập và máy A thấy” là đồng bộ thành công.

Cần test:

```text
Device A -> Cloud -> Device B -> Device C
-> Offline -> Reconnect -> Conflict/Retry
```

Tùy dự án cần kiểm tra:

- PC;
- mobile;
- nhiều user;
- Viewer/Editor/Admin;
- offline;
- reconnect;
- multi-device;
- conflict.

---

# 13. LOCAL STORAGE KHÔNG PHẢI NGUỒN DỮ LIỆU CHÍNH

LocalStorage/IndexedDB chỉ nên dùng cho:

- cache;
- offline queue;
- temporary state.

Nguồn dữ liệu chính phải được xác định rõ ở backend/database trung tâm nếu dự án yêu cầu đồng bộ.

---

# 14. OFFLINE-FIRST

Phân biệt:

- **Server State** – đã đồng bộ.
- **Local State** – đang chỉnh.
- **Pending Queue** – chưa đồng bộ.

Khi có mạng lại:

```text
Pending -> Upload/Write -> Server Confirm -> Verify -> Clear Pending
```

Không xóa pending trước khi server xác nhận thành công.

---

# 15. PHÂN QUYỀN

Không chỉ khóa nút trên UI.

Tối thiểu bảo vệ tại:

1. UI;
2. application/service logic;
3. backend/rules/API.

Viewer không được sửa thì backend cũng phải từ chối request sửa.

---

# 16. SOFT DELETE / THÙNG RÁC

Dữ liệu quan trọng nên dùng soft delete khi phù hợp:

```text
deletedAt
deletedBy
deleteReason
retention
restore
```

Chỉ hard delete khi đã đáp ứng quy tắc retention/backup.

---

# 17. ASSET / MODEL / MEDIA

Đối với FBX/GLB/video/audio/image, kiểm tra:

- orientation;
- scale;
- origin/pivot;
- hierarchy;
- animation;
- material/texture;
- polygon/size;
- object rác/ẩn;
- naming.

Ưu tiên chuẩn hóa asset thay vì vá từng model bằng runtime transform.

Nếu cần, dùng metadata như:

```text
forwardAxis
upAxis
scale
type
wheelNodes
driverAnchor
```

---

# 18. HIỆU NĂNG

Ưu tiên:

1. lazy loading;
2. dynamic import;
3. compression;
4. LOD;
5. caching;
6. preload tài nguyên quan trọng;
7. dispose tài nguyên không dùng.

Theo dõi bundle size, asset size, memory, FPS và load time khi phù hợp.

---

# 19. RESPONSIVE / UI

Chức năng chính phải kiểm tra trên các kích thước phù hợp:

- desktop;
- laptop;
- tablet;
- mobile portrait;
- mobile landscape.

Nút chính phải nhìn thấy, bấm được và không bị che.

---

# 20. GITHUB WORKFLOW

Mặc định khuyến nghị:

```text
feature/fix branch
-> Pull Request
-> CI
-> Review
-> Merge
-> Deploy
```

Không tự push/merge/deploy Production nếu chưa được yêu cầu hoặc chưa đạt Release Gate.

Đối với tài liệu/chính sách không ảnh hưởng runtime, có thể commit trực tiếp khi chủ dự án yêu cầu rõ ràng.

---

# 21. GITHUB ACTIONS / CI

Pipeline nên bao gồm các gate phù hợp:

```text
npm ci
-> Lint
-> Type Check
-> Unit/Integration Test
-> Golden Test
-> Build
-> Security/Dependency Audit
-> Artifact
```

Chỉ merge/deploy khi các gate bắt buộc xanh hoặc blocker đã được ghi nhận rõ.

---

# 22. BACKUP TRƯỚC THAY ĐỔI LỚN

Trước các thao tác nguy hiểm phải có backup/checkpoint:

- migration;
- database restructuring;
- rules/auth changes;
- bulk delete;
- import lớn;
- engine rewrite;
- asset cleanup hàng loạt;
- dependency upgrade lớn.

Backup chỉ có giá trị khi có khả năng restore.

---

# 23. BẢO MẬT

Không commit:

- API key;
- service account;
- private key;
- password;
- token;
- `.env` chứa secret.

Dùng GitHub Secrets/environment/backend proxy khi phù hợp.

Nếu secret đã commit công khai, phải xem như đã lộ và rotate.

---

# 24. LOG VÀ CHẨN ĐOÁN

Luồng quan trọng nên có log theo bước.

Ví dụ upload:

```text
SELECT
-> COMPRESS
-> UPLOAD
-> SERVER OK
-> METADATA WRITE
-> SYNC
-> RENDER
```

Thông báo người dùng cần dễ hiểu; diagnostic kỹ thuật giữ riêng.

---

# 25. CHANGELOG

Mỗi release nên có:

- Added;
- Fixed;
- Improved;
- Security;
- Known Issues.

Không ghi “đã sửa toàn bộ” nếu chưa có bằng chứng kiểm thử.

---

# 26. MASTER REPORT

Bản release/candidate quan trọng nên có:

- Release/version;
- Baseline;
- Changes;
- Tests;
- PASS;
- BLOCKED;
- Known Issues;
- Artifacts;
- Commit/branch;
- Build metadata.

---

# 27. CHECKSUM

ZIP/artifact quan trọng nên có SHA256.

Ví dụ:

```text
HNL_APP_v2.8.2_FULL_SOURCE.zip
HNL_APP_v2.8.2_FULL_SOURCE.zip.sha256
```

---

# 28. GOOGLE DRIVE – SAO LƯU CÔNG VIỆC ĐANG DỞ

GitHub và Google Drive có vai trò khác nhau.

## GitHub

- source control;
- commit/branch/PR;
- CI/CD;
- release đã kiểm chứng.

## Google Drive

- WIP checkpoint;
- ZIP source đang dở;
- reports;
- logs;
- evidence;
- Excel/PDF thử nghiệm;
- backup trước thay đổi lớn;
- asset/source tham chiếu chưa phù hợp đưa vào Git.

Google Drive **không thay thế Git version control**; GitHub **không phải nơi duy nhất giữ WIP chưa kiểm chứng**.

---

# 29. WIP CHECKPOINT

Tên file nên thể hiện rõ trạng thái:

```text
<Project>_<Version>_WIP-<Stage>_<YYYYMMDD-HHmm>.zip
```

Ví dụ:

```text
HNL-Pile-Standards-AI_v1.9.30_WIP-P0-Pass1_20260829-1345.zip
```

`WIP` có nghĩa **Work In Progress – NOT RELEASE**.

Không đặt WIP giống tên FINAL/RELEASE.

---

# 30. KHI NÀO PHẢI TẠO CHECKPOINT

Bắt buộc trước:

1. sửa cấu trúc lớn;
2. migration;
3. rules/auth/permission changes;
4. dependency upgrade lớn;
5. engine rewrite;
6. xóa/tối ưu asset hàng loạt;
7. merge lớn;
8. Release Candidate;
9. deploy Production.

Nên tạo thêm checkpoint:

- sau một P0/P1 pass quan trọng;
- sau Golden Test quan trọng;
- cuối phiên nếu công việc chưa hoàn tất.

Không tạo ZIP mỗi vài phút; checkpoint phải có ý nghĩa.

---

# 31. CẤU TRÚC DRIVE KHUYẾN NGHỊ

```text
HNL_PROJECTS/
  <PROJECT>/
    01_BASELINE/
    02_WIP/
    03_RELEASE_CANDIDATE/
    04_RELEASE/
    05_REPORTS/
    06_TEST_EVIDENCE/
    07_LOGS/
    08_ASSETS/
    09_BACKUP/
    99_ARCHIVE/
```

Ý nghĩa:

- `01_BASELINE`: FULL SOURCE được xác nhận làm nguồn bắt đầu.
- `02_WIP`: checkpoint đang làm dở.
- `03_RELEASE_CANDIDATE`: bản chờ Release Gate.
- `04_RELEASE`: bản đã VERIFIED.
- `05_REPORTS`: audit/gap/regression/security/golden/master report.
- `06_TEST_EVIDENCE`: ảnh/video/CSV/JSON/Excel bằng chứng.
- `07_LOGS`: CI/build/runtime/crash logs.
- `08_ASSETS`: tài nguyên gốc/tham chiếu.
- `09_BACKUP`: backup trước thay đổi nguy hiểm.
- `99_ARCHIVE`: bản lịch sử.

---

# 32. WORK_STATE.md VÀ MANIFEST.md

Mỗi WIP quan trọng nên có `WORK_STATE.md`.

Mẫu:

```text
PROJECT:
CURRENT VERSION:
BASELINE:
BRANCH:
COMMIT:

DONE:
-

IN PROGRESS:
-

PENDING:
-

BLOCKERS:
-

TEST STATUS:
-

NEXT STEP:
-

DO NOT:
- merge main unless approved
- deploy production unless approved
- use an older baseline without verification
```

Checkpoint/Release quan trọng nên có `MANIFEST.md` ghi:

- Project;
- checkpoint/version;
- created time/timezone;
- baseline;
- branch/commit;
- completed;
- pending;
- test status;
- deploy status;
- checksum.

---

# 33. KHÔNG BACKUP FILE CÓ THỂ DỰNG LẠI

Thông thường không cần backup:

```text
node_modules/
dist/
build cache/
.next/cache/
```

Nên backup:

- source;
- config;
- lock file;
- tests;
- scripts;
- docs;
- asset không thể tải lại;
- database export;
- evidence;
- report.

---

# 34. SOURCE BACKUP KHÁC DATA BACKUP

Phân biệt:

1. **Source Backup** – code.
2. **Data Backup** – database/user data.
3. **Asset Backup** – ảnh/video/file.
4. **Configuration Backup** – rules/index/config.

ZIP source **không đồng nghĩa** đã backup toàn bộ hệ thống.

---

# 35. BACKUP TRƯỚC MIGRATION

Quy trình:

```text
EXPORT DATA
-> VERIFY EXPORT
-> SAVE BACKUP
-> RECORD MANIFEST/CHECKSUM
-> RUN MIGRATION
-> VERIFY
-> KEEP ROLLBACK PATH
```

---

# 36. NGUYÊN TẮC 3 BẢN SAO

Dữ liệu/source quan trọng nên có tối thiểu:

1. Working copy.
2. Google Drive backup/checkpoint.
3. GitHub commit/release.

Dữ liệu cực kỳ quan trọng có thể thêm ổ cứng ngoài/NAS/cloud backup khác.

---

# 37. CUỐI PHIÊN LÀM VIỆC

Nếu công việc chưa hoàn thành:

1. lưu source;
2. chạy test tối thiểu có thể chạy;
3. cập nhật `WORK_STATE.md`;
4. tạo WIP ZIP tại checkpoint có ý nghĩa;
5. tạo SHA256 nếu quan trọng;
6. sao lưu lên Drive;
7. ghi trạng thái rõ:

```text
WIP – NOT VERIFIED – DO NOT DEPLOY
```

---

# 38. TIẾP TỤC CÔNG VIỆC SAU ĐÓ

Khi mở lại dự án, kiểm tra:

```text
WORK_STATE.md
-> MANIFEST.md
-> Version
-> Timestamp
-> Branch/Commit
-> SHA256
-> Source contents
-> Confirm latest baseline
```

Không chọn bản chỉ vì tên file “có vẻ mới nhất”.

---

# 39. DỌN WIP SAU RELEASE

Sau khi release VERIFIED:

Giữ:

- baseline quan trọng;
- checkpoint trước thay đổi lớn;
- RC cuối;
- release;
- reports;
- evidence.

WIP trung gian có thể chuyển `99_ARCHIVE` hoặc xóa sau khi xác nhận release và backup an toàn.

---

# 40. QUY TẮC KHI AI THAM GIA PHÁT TRIỂN

AI phải luôn xác định/ghi nhận:

- source nào đang dùng;
- file nào đã thay đổi;
- việc đã xong;
- việc chưa xong;
- test đã chạy;
- test chưa chạy;
- blocker;
- bước tiếp theo;
- có được push hay chưa;
- có được merge/deploy hay chưa.

Nếu chưa đủ bằng chứng, dùng trạng thái:

```text
WIP / PARTIAL / NOT VERIFIED
```

Không dùng `DONE`, `GOLDEN`, `VERIFIED` một cách suy đoán.

---

# 41. QUY TRÌNH PHÁT TRIỂN CHUẨN

```text
1. Confirm latest baseline
2. Source audit
3. P0/P1/P2/P3 matrix
4. Root-cause analysis
5. WIP checkpoint if needed
6. Implement fixes by group
7. Add regression tests
8. Type/Lint/Test
9. Golden Test
10. Build
11. Runtime Test
12. Regression Matrix
13. Security/Data Audit
14. Version update
15. Changelog + Master Report
16. RC backup to Drive
17. Push branch / PR
18. GitHub Actions
19. Merge only when approved/gates pass
20. Deploy only when approved
21. Production smoke test
22. Final release backup + checksum
```

---

# 42. QUY TẮC KHI CHUYỂN CHAT / AI SESSION

Khi tiếp tục ở chat/session mới, phải cung cấp hoặc khôi phục:

- tên dự án;
- version;
- FULL SOURCE mới nhất;
- repository;
- branch/commit;
- việc đã hoàn thành;
- lỗi/pending;
- bước tiếp theo;
- các hành động bị cấm.

Prompt nên có các câu:

```text
FULL SOURCE mới nhất được xác định trong phiên này là nguồn chính duy nhất.
Không rollback source cũ.
Không chép code từ version cũ khi chưa kiểm tra.
Không tự merge/deploy Production khi chưa được yêu cầu.
Không tuyên bố VERIFIED nếu chưa có bằng chứng.
```

---

# 43. NGUYÊN TẮC ƯU TIÊN CUỐI CÙNG

Mục tiêu không phải chỉ “sửa được lỗi đang thấy”.

Mục tiêu là tạo một baseline:

- đúng;
- an toàn dữ liệu;
- ổn định;
- có thể kiểm chứng;
- không phá chức năng cũ;
- có khả năng rollback;
- đủ bằng chứng để phát hành.

Thứ tự ưu tiên mặc định:

```text
CORRECTNESS
-> DATA SAFETY
-> STABILITY
-> SECURITY
-> PERFORMANCE
-> UX
-> NEW FEATURES
```

---

# 44. PROJECT-SPECIFIC RULES – PHẦN RIÊNG CỦA TỪNG REPOSITORY

> **Chỉ chỉnh mục này cho từng dự án. Không sao chép quy tắc riêng của dự án A sang dự án B nếu không phù hợp.**

Mẫu:

```markdown
## PROJECT-SPECIFIC RULES

### Project Identity
- Project:
- Repository:
- Current version:
- Production URL:
- Main platform:

### Source of Truth
- Current baseline:
- Main branch:
- Active development branch:

### Critical P0 Areas
- ...

### Golden Tests
- ...

### Data / Sync Rules
- ...

### Build Targets
- Web:
- Windows:
- Android:
- Other:

### External Services
- Database:
- Storage:
- Drive:
- AI provider:

### Deployment Rules
- ...

### Project-Specific DO NOT
- ...

### Current Work State
- DONE:
- IN PROGRESS:
- PENDING:
- BLOCKERS:
- NEXT STEP:
```

---

# 45. TỆP ĐỒNG HÀNH KHUYẾN NGHỊ TRONG MỖI REPOSITORY

```text
/HNL-MASTER-DEVELOPMENT-GUIDELINE.md   # Quy tắc chung
/PROJECT-RULES.md                      # Quy tắc riêng nếu muốn tách file
/WORK_STATE.md                         # Trạng thái công việc hiện tại
/CHANGELOG.md                          # Lịch sử thay đổi
/docs/                                 # Reports/guides
/tests/golden/                         # Golden fixtures nếu có
```

Nếu repository dùng `PROJECT-RULES.md` riêng, mục 44 của Master chỉ cần dẫn link tới file đó để tránh trùng lặp.

---

## KẾT LUẬN

**Drive giữ an toàn quá trình làm việc. GitHub quản lý lịch sử source. Golden/Runtime verification xác nhận chất lượng. Release chỉ được tạo sau khi đủ bằng chứng.**

Tài liệu này phải được giữ đồng bộ trong các repository HNL; các thay đổi chính sách chung nên cập nhật cùng phiên bản nội dung trên tất cả repo thay vì sửa lệch từng nơi.
