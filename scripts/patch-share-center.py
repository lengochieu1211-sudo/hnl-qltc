from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Marker not found in {path}: {old[:100]!r}')
    text = text.replace(old, new, 1)
    p.write_text(text, encoding='utf-8')


def wrap_diagnostics():
    p = Path('src/components/GoogleConfigTab.tsx')
    text = p.read_text(encoding='utf-8')
    marker = '{syncDiagnostics && ('
    start = text.find(marker)
    if start < 0:
        raise SystemExit('syncDiagnostics render marker missing')
    if 'Nhấn để mở trạng thái đồng bộ, ảnh và công cụ chẩn đoán' in text:
        return

    open_paren = text.find('(', start + len('{syncDiagnostics &&'))
    depth = 0
    quote = None
    escape = False
    line_comment = False
    block_comment = False
    match = -1
    i = open_paren
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if line_comment:
            if ch == '\n': line_comment = False
            i += 1; continue
        if block_comment:
            if ch == '*' and nxt == '/': block_comment = False; i += 2; continue
            i += 1; continue
        if quote:
            if escape: escape = False
            elif ch == '\\': escape = True
            elif ch == quote: quote = None
            i += 1; continue
        if ch == '/' and nxt == '/': line_comment = True; i += 2; continue
        if ch == '/' and nxt == '*': block_comment = True; i += 2; continue
        if ch in ('\'', '"', '`'): quote = ch; i += 1; continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                match = i
                break
        i += 1
    if match < 0:
        raise SystemExit('Could not find diagnostics closing parenthesis')

    condition = "syncDiagnostics.cloudInitialReady && syncDiagnostics.roleResolved && syncDiagnostics.pendingData === 0 && displayedPendingDriveUploads === 0 && displayedPhotoPending === 0"
    prefix = f'''\n        <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">\n          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3.5 select-none">\n            <div className="min-w-0">\n              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">\n                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Hệ thống & Chẩn đoán\n              </div>\n              <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Nhấn để mở trạng thái đồng bộ, ảnh và công cụ chẩn đoán.</div>\n            </div>\n            <span className={{`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold ${{{condition} ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}}`}}>\n              {{{condition} ? 'Cloud sẵn sàng' : 'Đang kiểm tra'}}\n            </span>\n          </summary>\n          <div className="px-2 pb-2 sm:px-3 sm:pb-3">'''
    suffix = '''\n          </div>\n        </details>\n      '''
    text = text[:open_paren + 1] + prefix + text[open_paren + 1:match] + suffix + text[match:]
    p.write_text(text, encoding='utf-8')


def patch_defect():
    path = 'src/components/FloorPlanDefectTab.tsx'
    replace_once(path, "import { ContactMenu } from './ContactMenu';", "import { ContactMenu } from './ContactMenu';\nimport { ShareEntityMenu } from './ShareEntityMenu';")
    p = Path(path)
    text = p.read_text(encoding='utf-8')

    old1 = '''                            <ContactMenu\n                              target={{ name: defect.assignedTo || 'Đội phụ trách', phone: contactTeam?.phone }}\n                              context={{ type: 'defect', projectId: currentProjectId, entityId: defect.id, shareText: defectShareText }}\n                              triggerLabel={contactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}\n                            />'''
    new1 = '''                            {contactTeam?.phone && (\n                              <ContactMenu\n                                target={{ name: defect.assignedTo || 'Đội phụ trách', phone: contactTeam.phone }}\n                                context={{ type: 'defect', projectId: currentProjectId, entityId: defect.id, shareText: defectShareText }}\n                                triggerLabel="Liên hệ"\n                              />\n                            )}\n                            <ShareEntityMenu\n                              projectId={currentProjectId}\n                              entityType="defect"\n                              entityId={defect.id}\n                              title={`Defect ${getDefectShortCode(defect)} · ${defect.floorName || 'Chưa rõ tầng'}`}\n                              text={defectShareText}\n                              legacyImageUrls={[defect.imageUrl || '', defect.afterImageUrl || '']}\n                            />'''
    if old1 not in text:
        raise SystemExit('Defect card ContactMenu marker missing')
    text = text.replace(old1, new1, 1)

    old2 = '''                      <ContactMenu\n                        target={{ name: activeDefectDetail.assignedTo || 'Đội phụ trách', phone: activeContactTeam?.phone }}\n                        context={{ type: 'defect', projectId: currentProjectId, entityId: activeDefectDetail.id, shareText: activeDefectShareText }}\n                        triggerLabel={activeContactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}\n                      />'''
    new2 = '''                      <div className="flex flex-wrap items-center justify-end gap-1.5">\n                        {activeContactTeam?.phone && (\n                          <ContactMenu\n                            target={{ name: activeDefectDetail.assignedTo || 'Đội phụ trách', phone: activeContactTeam.phone }}\n                            context={{ type: 'defect', projectId: currentProjectId, entityId: activeDefectDetail.id, shareText: activeDefectShareText }}\n                            triggerLabel="Liên hệ"\n                          />\n                        )}\n                        <ShareEntityMenu\n                          projectId={currentProjectId}\n                          entityType="defect"\n                          entityId={activeDefectDetail.id}\n                          title={`Defect ${getDefectShortCode(activeDefectDetail)} · ${activeDefectDetail.floorName || 'Chưa rõ tầng'}`}\n                          text={activeDefectShareText}\n                          legacyImageUrls={[activeDefectDetail.imageUrl || '', activeDefectDetail.afterImageUrl || '']}\n                        />\n                      </div>'''
    if old2 not in text:
        raise SystemExit('Defect detail ContactMenu marker missing')
    text = text.replace(old2, new2, 1)
    p.write_text(text, encoding='utf-8')


def patch_crew():
    path = 'src/components/CrewTab.tsx'
    replace_once(path, "import { ContactMenu } from './ContactMenu';", "import { ContactMenu } from './ContactMenu';\nimport { ShareEntityMenu } from './ShareEntityMenu';")
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    helper_marker = "const COMMON_TASKS = ["
    helper = '''const buildCrewRecordShareText = (record: CrewRecord, projectName?: string) => {\n  const counts = getCrewShiftCounts(record);\n  const floors = Array.from(new Set([\n    record.floorName,\n    ...(record.floorWorks || []).map((work) => work.floorName),\n  ].map((value) => String(value || '').trim()).filter(Boolean)));\n  const tasks = Array.from(new Set([\n    record.taskDescription,\n    ...(record.floorWorks || []).flatMap((work) => (work.categories || []).flatMap((category) => [\n      category.categoryName,\n      ...(category.subItems || []),\n    ])),\n  ].map((value) => String(value || '').trim()).filter(Boolean)));\n  return [\n    'HNL QLTC – Báo cáo quân số theo ngày',\n    projectName ? `Dự án: ${projectName}` : '',\n    `Ngày: ${formatDateDDMMYYYY(record.date)}`,\n    `Đội: ${record.teamName || 'Chưa cập nhật'}`,\n    record.leaderName ? `Đội trưởng: ${record.leaderName}` : '',\n    floors.length ? `Tầng / khu vực: ${floors.join(', ')}` : '',\n    `Sáng: ${counts.morning} người`,\n    `Chiều: ${counts.afternoon} người`,\n    `Tối: ${counts.evening} người`,\n    `Quân số tham chiếu: ${Number(record.workerCount || 0)} người`,\n    tasks.length ? `Công việc: ${tasks.join(' · ')}` : '',\n    record.notes ? `Ghi chú: ${record.notes}` : '',\n    'Lưu ý: Sáng/Chiều/Tối là quân số theo ca, không cộng thành số người duy nhất trong ngày.',\n  ].filter(Boolean).join('\\n');\n};\n\n'''
    if helper_marker not in text:
        raise SystemExit('Crew helper marker missing')
    text = text.replace(helper_marker, helper + helper_marker, 1)

    marker = '''                      {/* Lightweight list mode: count only; thumbnails load on demand. */}\n                      <CrewPhotoCount projectId={projectId} recordId={record.id} />\n\n                      {/* Actions buttons */}'''
    replacement = '''                      {/* Lightweight list mode: count only; thumbnails load on demand. */}\n                      <CrewPhotoCount projectId={projectId} recordId={record.id} />\n\n                      <div className="mt-2 flex justify-end">\n                        <ShareEntityMenu\n                          projectId={projectId}\n                          entityType="crewRecord"\n                          entityId={record.id}\n                          title={`Quân số ${record.teamName || 'Đội thi công'} · ${formatDateDDMMYYYY(record.date)}`}\n                          text={buildCrewRecordShareText(record, projectName)}\n                          triggerLabel="Chia sẻ báo cáo"\n                        />\n                      </div>\n\n                      {/* Actions buttons */}'''
    if marker not in text:
        raise SystemExit('Crew record insertion marker missing')
    text = text.replace(marker, replacement, 1)
    p.write_text(text, encoding='utf-8')


def patch_android():
    p = Path('android-wrapper/src/com/qlct/app/MainActivity.java')
    text = p.read_text(encoding='utf-8')
    if 'public boolean shareFiles(String title, String text, String attachmentsJson)' in text:
        return
    text = text.replace('import org.json.JSONObject;', 'import org.json.JSONObject;\nimport org.json.JSONArray;', 1)
    marker = '''        @JavascriptInterface\n        public boolean openZalo() {'''
    method = '''        @JavascriptInterface\n        public boolean shareFiles(String title, String text, String attachmentsJson) {\n            try {\n                final String safeTitle = title == null || title.trim().isEmpty() ? "HNL QLTC" : title.trim();\n                final String safeText = text == null ? "" : text;\n                JSONArray items = new JSONArray(attachmentsJson == null ? "[]" : attachmentsJson);\n                if (items.length() == 0) return false;\n\n                final int maxFiles = Math.min(items.length(), 6);\n                final long maxTotalBytes = 12L * 1024L * 1024L;\n                long totalBytes = 0L;\n                final ArrayList<Uri> uris = new ArrayList<>();\n                final ArrayList<String> mimeTypes = new ArrayList<>();\n                File dir = new File(getCacheDir(), PickerCacheProvider.CACHE_DIR);\n                if (!dir.exists() && !dir.mkdirs()) return false;\n\n                long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;\n                File[] oldFiles = dir.listFiles();\n                if (oldFiles != null) for (File old : oldFiles) {\n                    if (old.isFile() && old.getName().startsWith("share_") && old.lastModified() < cutoff) old.delete();\n                }\n\n                for (int i = 0; i < maxFiles; i++) {\n                    JSONObject item = items.optJSONObject(i);\n                    if (item == null) continue;\n                    String encoded = item.optString("base64", "").replaceAll("\\\\s", "");\n                    if (encoded.length() == 0) continue;\n                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);\n                    if (bytes.length == 0 || totalBytes + bytes.length > maxTotalBytes) break;\n                    totalBytes += bytes.length;\n\n                    String originalName = sanitizeFileName(item.optString("fileName", "image_" + (i + 1) + ".jpg"));\n                    String fileName = "share_" + System.currentTimeMillis() + "_" + i + "_" + originalName;\n                    File target = new File(dir, fileName);\n                    FileOutputStream output = new FileOutputStream(target);\n                    try { output.write(bytes); output.flush(); } finally { output.close(); }\n                    Uri uri = new Uri.Builder().scheme("content").authority(PickerCacheProvider.AUTHORITY).appendPath(target.getName()).build();\n                    uris.add(uri);\n                    mimeTypes.add(item.optString("mimeType", "image/jpeg"));\n                }\n                if (uris.isEmpty()) return false;\n\n                runOnUiThread(() -> {\n                    try {\n                        Intent share = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);\n                        share.setType(uris.size() > 1 ? "image/*" : mimeTypes.get(0));\n                        share.putExtra(Intent.EXTRA_TEXT, safeText);\n                        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);\n                        if (uris.size() > 1) share.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);\n                        else share.putExtra(Intent.EXTRA_STREAM, uris.get(0));\n\n                        ClipData clip = ClipData.newUri(getContentResolver(), "HNL QLTC share", uris.get(0));\n                        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));\n                        share.setClipData(clip);\n                        startActivity(Intent.createChooser(share, safeTitle));\n                    } catch (Exception error) {\n                        showToast("Khong the chia se anh: " + error.getMessage());\n                    }\n                });\n                return true;\n            } catch (Exception error) {\n                showToast("Khong the chuan bi anh chia se: " + error.getMessage());\n                return false;\n            }\n        }\n\n'''
    if marker not in text:
        raise SystemExit('AndroidContact openZalo marker missing')
    text = text.replace(marker, method + marker, 1)
    p.write_text(text, encoding='utf-8')


wrap_diagnostics()
patch_defect()
patch_crew()
patch_android()
print('Share center + diagnostics patch applied.')
