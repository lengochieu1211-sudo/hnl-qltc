from pathlib import Path

p = Path('src/components/FloorPlanDefectTab.tsx')
text = p.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        print(f'{label}: already patched')
        return
    if old not in text:
        raise SystemExit(f'{label}: anchor not found')
    text = text.replace(old, new, 1)
    print(f'{label}: patched')

replace_once(
    "import { appendRuntimeDiagnostic } from '../lib/runtimeDiagnostics';\n",
    "import { appendRuntimeDiagnostic } from '../lib/runtimeDiagnostics';\nimport { ContactMenu } from './ContactMenu';\nimport { buildDefectShareText, resolveDefectTeam } from '../utils/defectContactUtils';\n",
    'imports',
)

replace_once(
    "            filteredDefects.map((defect) => {\n              const overdueInfo = getDefectOverdueInfo(defect);\n              return (",
    "            filteredDefects.map((defect) => {\n              const overdueInfo = getDefectOverdueInfo(defect);\n              const contactTeam = resolveDefectTeam(defect, teams);\n              const defectShareText = buildDefectShareText(defect);\n              return (",
    'card resolver',
)

replace_once(
    '''                        <div>\n                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Phụ trách</span>\n                          <span className="font-bold text-slate-800">{defect.assignedTo}</span>\n                        </div>''',
    '''                        <div>\n                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Phụ trách</span>\n                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>\n                            <span className="font-bold text-slate-800">{defect.assignedTo}</span>\n                            <ContactMenu\n                              target={{ name: defect.assignedTo || 'Đội phụ trách', phone: contactTeam?.phone }}\n                              context={{ type: 'defect', projectId: currentProjectId, entityId: defect.id, shareText: defectShareText }}\n                              triggerLabel={contactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}\n                            />\n                          </div>\n                        </div>''',
    'card contact menu',
)

replace_once(
    "      {activeDefectDetail && (() => {\n        const overdueInfo = getDefectOverdueInfo(activeDefectDetail);\n",
    "      {activeDefectDetail && (() => {\n        const overdueInfo = getDefectOverdueInfo(activeDefectDetail);\n        const activeContactTeam = resolveDefectTeam(activeDefectDetail, teams);\n        const activeDefectShareText = buildDefectShareText(activeDefectDetail);\n",
    'detail resolver',
)

old_detail = '''                  <div className="sm:col-span-2">\n                    {canEditDefects ? (\n                      <TeamSelectorInput\n                        value={activeDefectDetail.assignedTo || ''}\n                        onChange={(val) => handleDetailFieldChange('assignedTo', val)}\n                        pinPos={{ x: activeDefectDetail.x, y: activeDefectDetail.y }}\n                        activeFloorRooms={floorRooms}\n                        allRooms={roomProgressList}\n                        declaredTeams={teams}\n                        listId="defect-team-datalist-detail"\n                      />\n                    ) : (\n                      <div className="rounded-xl border border-slate-200 bg-white p-2 text-[11px] text-slate-700">\n                        <span className="font-bold">Đội phụ trách:</span> {activeDefectDetail.assignedTo || 'Chưa gán'}\n                      </div>\n                    )}\n                  </div>'''
new_detail = '''                  <div className="sm:col-span-2 space-y-2">\n                    {canEditDefects ? (\n                      <TeamSelectorInput\n                        value={activeDefectDetail.assignedTo || ''}\n                        onChange={(val) => handleDetailFieldChange('assignedTo', val)}\n                        pinPos={{ x: activeDefectDetail.x, y: activeDefectDetail.y }}\n                        activeFloorRooms={floorRooms}\n                        allRooms={roomProgressList}\n                        declaredTeams={teams}\n                        listId="defect-team-datalist-detail"\n                      />\n                    ) : (\n                      <div className="rounded-xl border border-slate-200 bg-white p-2 text-[11px] text-slate-700">\n                        <span className="font-bold">Đội phụ trách:</span> {activeDefectDetail.assignedTo || 'Chưa gán'}\n                      </div>\n                    )}\n                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-2.5">\n                      <div className="min-w-0 flex-1">\n                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700">Liên hệ người phụ trách / Chia sẻ Defect</div>\n                        <div className="mt-0.5 text-[10px] font-semibold text-slate-600">\n                          {activeContactTeam?.phone ? `${activeDefectDetail.assignedTo} · ${activeContactTeam.phone}` : 'Chưa có số điện thoại khớp với đội phụ trách. Vẫn có thể sao chép/chia sẻ nội dung Defect.'}\n                        </div>\n                      </div>\n                      <ContactMenu\n                        target={{ name: activeDefectDetail.assignedTo || 'Đội phụ trách', phone: activeContactTeam?.phone }}\n                        context={{ type: 'defect', projectId: currentProjectId, entityId: activeDefectDetail.id, shareText: activeDefectShareText }}\n                        triggerLabel={activeContactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}\n                      />\n                    </div>\n                  </div>'''
replace_once(old_detail, new_detail, 'detail contact menu')

p.write_text(text, encoding='utf-8')
print('Defect Contact Phase 2 patch complete')
