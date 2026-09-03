from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        print(f'{path}: already patched')
        return
    if old not in text:
        raise SystemExit(f'{path}: patch anchor not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'{path}: patched')


# 1) App: one generic listener switches to the module requested by diagnostics.
replace_once(
    'src/App.tsx',
    "  const [activeTab, setActiveTab] = useState<TabType>('floorplan');\n",
    "  const [activeTab, setActiveTab] = useState<TabType>('floorplan');\n"
    "\n"
    "  // Diagnostic navigation stays decoupled from individual screens. The source screen\n"
    "  // stores the entity request in sessionStorage, while App only switches modules.\n"
    "  useEffect(() => {\n"
    "    const handleDiagnosticOpenTab = (event: Event) => {\n"
    "      const detail = (event as CustomEvent<{ entityType?: string }>).detail || {};\n"
    "      const nextTab: TabType | null = detail.entityType === 'crewRecord'\n"
    "        ? 'crew'\n"
    "        : detail.entityType === 'defect'\n"
    "          ? 'floorplan'\n"
    "          : detail.entityType === 'chat'\n"
    "            ? 'chat'\n"
    "            : null;\n"
    "      if (nextTab) setActiveTab(nextTab);\n"
    "    };\n"
    "    window.addEventListener('qlct-diagnostic-open-entity', handleDiagnosticOpenTab);\n"
    "    return () => window.removeEventListener('qlct-diagnostic-open-entity', handleDiagnosticOpenTab);\n"
    "  }, []);\n"
)

# 2) GoogleConfigTab: keep a live lightweight photo diagnostic snapshot.
replace_once(
    'src/components/GoogleConfigTab.tsx',
    "  const [syncMsg, setSyncMsg] = useState<string | null>(null);\n",
    "  const [syncMsg, setSyncMsg] = useState<string | null>(null);\n"
    "  const [photoDiagnosticSnapshot, setPhotoDiagnosticSnapshot] = useState<any>(null);\n"
)

replace_once(
    'src/components/GoogleConfigTab.tsx',
    "  const handleDownloadDiagnostics = async () => {\n",
    "  const refreshPhotoDiagnosticSnapshot = async () => {\n"
    "    if (!activeProjectId) {\n"
    "      setPhotoDiagnosticSnapshot(null);\n"
    "      return;\n"
    "    }\n"
    "    const snapshot = await getProjectPhotoDiagnosticSnapshot(activeProjectId).catch(() => null);\n"
    "    setPhotoDiagnosticSnapshot(snapshot);\n"
    "  };\n"
    "\n"
    "  useEffect(() => {\n"
    "    if (!syncDiagnostics) return;\n"
    "    void refreshPhotoDiagnosticSnapshot();\n"
    "  }, [activeProjectId, syncDiagnostics?.photoPending, syncDiagnostics?.pendingDriveUploads]);\n"
    "\n"
    "  const diagnosticPhotoIssues = useMemo(() => {\n"
    "    const photos = Array.isArray(photoDiagnosticSnapshot?.photos) ? photoDiagnosticSnapshot.photos : [];\n"
    "    return photos.filter((photo: any) => !photo?.deleted && (\n"
    "      photo?.binaryUploadState !== 'ready' ||\n"
    "      photo?.cloudReady !== true ||\n"
    "      (photo?.storageProvider === 'firestore-fallback' && !photo?.localBinary)\n"
    "    )).slice(0, 20);\n"
    "  }, [photoDiagnosticSnapshot]);\n"
    "\n"
    "  const handleGoToDiagnosticEntity = (photo: any) => {\n"
    "    const entityType = String(photo?.entityType || '');\n"
    "    const entityId = String(photo?.entityId || '');\n"
    "    if (!entityType || !entityId || !activeProjectId) {\n"
    "      setSyncMsg('Không xác định được bản ghi liên quan đến ảnh này.');\n"
    "      return;\n"
    "    }\n"
    "    try {\n"
    "      sessionStorage.setItem('qlct_diagnostic_navigation_request', JSON.stringify({\n"
    "        projectId: activeProjectId,\n"
    "        entityType,\n"
    "        entityId,\n"
    "        photoId: String(photo?.id || ''),\n"
    "        createdAt: Date.now(),\n"
    "      }));\n"
    "    } catch (_) {}\n"
    "    window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: { entityType, entityId } }));\n"
    "    if (entityType !== 'crewRecord') {\n"
    "      setSyncMsg(entityType === 'defect'\n"
    "        ? 'Đã mở module Defect. Điều hướng chính xác tới Defect sẽ được bổ sung ở lượt kế tiếp.'\n"
    "        : entityType === 'chat'\n"
    "          ? 'Đã mở Trò chuyện. Điều hướng chính xác tới tin nhắn sẽ được bổ sung ở lượt kế tiếp.'\n"
    "          : 'Đã mở module liên quan.');\n"
    "    }\n"
    "  };\n"
    "\n"
    "  const handleDownloadDiagnostics = async () => {\n"
)

# Insert issue cards immediately before diagnostic action buttons.
replace_once(
    'src/components/GoogleConfigTab.tsx',
    "          <div className=\"flex flex-wrap gap-2\">\n            <button\n              type=\"button\"\n              onClick={async () => {\n                try {\n                  const bundle = await buildFullDiagnosticBundle();\n",
    "          <div className=\"rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2\">\n"
    "            <div className=\"flex items-center justify-between gap-2\">\n"
    "              <div>\n"
    "                <div className=\"text-[11px] font-extrabold text-slate-800\">Ảnh cần xử lý</div>\n"
    "                <div className=\"text-[10px] text-slate-500\">Chỉ hiện ảnh active chưa Cloud-ready hoặc legacy không còn binary local.</div>\n"
    "              </div>\n"
    "              <button type=\"button\" onClick={() => void refreshPhotoDiagnosticSnapshot()} className=\"px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-bold text-slate-600 flex items-center gap-1\">\n"
    "                <RefreshCw className=\"w-3.5 h-3.5\" /> Kiểm tra lại\n"
    "              </button>\n"
    "            </div>\n"
    "            {diagnosticPhotoIssues.length === 0 ? (\n"
    "              <div className=\"text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2\">Không có ảnh active cần xử lý.</div>\n"
    "            ) : (\n"
    "              <div className=\"space-y-1.5\">\n"
    "                {diagnosticPhotoIssues.map((photo: any) => (\n"
    "                  <div key={photo.id} className=\"rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 flex items-center justify-between gap-2\">\n"
    "                    <div className=\"min-w-0\">\n"
    "                      <div className=\"text-[10px] font-extrabold text-amber-900 truncate\">{photo.entityType}/{photo.entityId}</div>\n"
    "                      <div className=\"text-[9px] text-amber-700 truncate font-mono\">{photo.id} · {photo.storageProvider || 'legacy'} · {photo.binaryUploadState || 'unknown'}</div>\n"
    "                    </div>\n"
    "                    <button type=\"button\" onClick={() => handleGoToDiagnosticEntity(photo)} className=\"shrink-0 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1.5 text-[10px] font-extrabold flex items-center gap-1\">\n"
    "                      <ExternalLink className=\"w-3.5 h-3.5\" /> {photo.entityType === 'crewRecord' ? 'Đi tới bản ghi' : 'Mở module'}\n"
    "                    </button>\n"
    "                  </div>\n"
    "                ))}\n"
    "              </div>\n"
    "            )}\n"
    "          </div>\n"
    "\n"
    "          <div className=\"flex flex-wrap gap-2\">\n            <button\n              type=\"button\"\n              onClick={async () => {\n                try {\n                  const bundle = await buildFullDiagnosticBundle();\n"
)

# 3) Crew: consume pending diagnostic request after the tab mounts.
replace_once(
    'src/components/CrewTab.tsx',
    "  const [editingRecord, setEditingRecord] = useState<CrewRecord | null>(null);\n  const [editingTeam, setEditingTeam] = useState<TeamInfo | null>(null);\n",
    "  const [editingRecord, setEditingRecord] = useState<CrewRecord | null>(null);\n"
    "  const [editingTeam, setEditingTeam] = useState<TeamInfo | null>(null);\n"
    "\n"
    "  // A diagnostic request is stored before App switches tabs, so lazy mounting cannot\n"
    "  // lose the target. Editors open the exact record; read-only users land on its date\n"
    "  // and the matching card is scrolled into view.\n"
    "  useEffect(() => {\n"
    "    let raw = '';\n"
    "    try { raw = sessionStorage.getItem('qlct_diagnostic_navigation_request') || ''; } catch (_) {}\n"
    "    if (!raw) return;\n"
    "    try {\n"
    "      const request = JSON.parse(raw);\n"
    "      if (request?.entityType !== 'crewRecord') return;\n"
    "      if (request?.projectId && request.projectId !== projectId) return;\n"
    "      const target = crewRecords.find((record) => record.id === request.entityId);\n"
    "      if (!target) {\n"
    "        sessionStorage.removeItem('qlct_diagnostic_navigation_request');\n"
    "        alert('Bản ghi quân số liên quan không còn tồn tại hoặc đã bị xóa.');\n"
    "        return;\n"
    "      }\n"
    "      setActiveSubTab('logs');\n"
    "      setSelectedDate(target.date);\n"
    "      if (canOperate) {\n"
    "        setEditingRecord(target);\n"
    "        setShowAddLogModal(true);\n"
    "      }\n"
    "      sessionStorage.removeItem('qlct_diagnostic_navigation_request');\n"
    "      window.setTimeout(() => {\n"
    "        document.querySelector(`[data-crew-record-id=\"${target.id}\"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });\n"
    "      }, 120);\n"
    "    } catch (_) {\n"
    "      try { sessionStorage.removeItem('qlct_diagnostic_navigation_request'); } catch (_) {}\n"
    "    }\n"
    "  }, [projectId, crewRecords, canOperate]);\n"
)

replace_once(
    'src/components/CrewTab.tsx',
    "                <div \n                  key={record.id}\n                  className={`bg-white border rounded-xl p-4 transition-all duration-150 relative hover:border-slate-300 ${\n",
    "                <div \n                  key={record.id}\n                  data-crew-record-id={record.id}\n                  className={`bg-white border rounded-xl p-4 transition-all duration-150 relative hover:border-slate-300 ${\n"
)

print('diagnostic go-to-record patch complete')
