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

# CrewTab: import reusable contact menu and remove direct Phone icon dependency.
replace_once(
    'src/components/CrewTab.tsx',
    "  Briefcase,\n  Phone,\n  FileText,",
    "  Briefcase,\n  FileText,"
)
replace_once(
    'src/components/CrewTab.tsx',
    "import { getCrewShiftCounts } from '../utils/crewUtils';\n",
    "import { getCrewShiftCounts } from '../utils/crewUtils';\nimport { ContactMenu } from './ContactMenu';\n"
)

replace_once(
    'src/components/CrewTab.tsx',
    '''                            <a\n                              href={`tel:${String(team.phone || '').replace(/\\s+/g, '')}`}\n                              className="font-extrabold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 px-2 py-0.5 rounded-md inline-flex items-center gap-1 active:scale-95 transition-all shadow-2xs"\n                              title="Bấm để gọi điện thoại trực tiếp cho đội thi công"\n                            >\n                              <Phone className="w-3 h-3 text-indigo-600 shrink-0" />\n                              <span>{team.phone}</span>\n                            </a>''',
    '''                            <span className="font-extrabold text-indigo-800">{team.phone}</span>\n                            <ContactMenu\n                              target={{ name: team.leader || team.name, phone: team.phone }}\n                              context={{\n                                type: 'crew',\n                                projectId,\n                                entityId: team.id,\n                                shareText: `HNL QLTC – Liên hệ đội thi công\\nĐội: ${team.name}\\nĐội trưởng: ${team.leader || 'Chưa cập nhật'}\\nSĐT: ${team.phone}`,\n                              }}\n                              triggerLabel="Liên hệ"\n                            />'''
)

replace_once(
    'src/components/CrewTab.tsx',
    '''                  {tPhone && (\n                    <a\n                      href={`tel:${String(tPhone || '').replace(/\\s+/g, '')}`}\n                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"\n                      title="Bấm để gọi điện thoại trực tiếp"\n                    >\n                      <Phone className="w-3.5 h-3.5" />\n                    </a>\n                  )}''',
    '''                  {tPhone && (\n                    <div className="absolute right-2 top-1/2 -translate-y-1/2">\n                      <ContactMenu\n                        target={{ name: tLeader || tName || 'Đội thi công', phone: tPhone }}\n                        context={{ type: 'crew', projectId, shareText: `HNL QLTC – Liên hệ đội thi công\\nĐội: ${tName || 'Chưa đặt tên'}\\nĐội trưởng: ${tLeader || 'Chưa cập nhật'}\\nSĐT: ${tPhone}` }}\n                        triggerLabel=""\n                        triggerClassName="inline-flex items-center justify-center rounded-md bg-emerald-50 p-1 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 active:scale-95 transition-all"\n                      />\n                    </div>\n                  )}'''
)

replace_once(
    'src/components/CrewTab.tsx',
    '''                        <a\n                          href={`tel:${String(team.phone || '').replace(/\\s+/g, '')}`}\n                          className="text-emerald-300 hover:text-white font-extrabold underline inline-flex items-center gap-1 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/80 active:scale-95 transition-all shadow-2xs"\n                          title="Bấm để gọi điện thoại trực tiếp"\n                        >\n                          <Phone className="w-3 h-3 text-emerald-400 shrink-0" />\n                          <span>{team.phone}</span>\n                        </a>''',
    '''                        <span className="font-extrabold text-emerald-300">{team.phone}</span>\n                        <ContactMenu\n                          target={{ name: team.leader || team.name, phone: team.phone }}\n                          context={{\n                            type: 'crew',\n                            projectId,\n                            entityId: team.id,\n                            shareText: `HNL QLTC – Liên hệ đội thi công\\nĐội: ${team.name}\\nĐội trưởng: ${team.leader || 'Chưa cập nhật'}\\nSĐT: ${team.phone}`,\n                          }}\n                          triggerLabel="Liên hệ"\n                          triggerClassName="inline-flex items-center gap-1 rounded-md border border-emerald-700/80 bg-emerald-950/80 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300 hover:text-white active:scale-95 transition-all"\n                        />'''
)

# RoomHighlightModal: reuse ContactMenu instead of direct tel href.
replace_once(
    'src/components/RoomHighlightModal.tsx',
    "  Check,\n  Phone,\n  Pencil",
    "  Check,\n  Pencil"
)
replace_once(
    'src/components/RoomHighlightModal.tsx',
    "import { MoveOrderControls } from './MoveOrderControls';\n",
    "import { MoveOrderControls } from './MoveOrderControls';\nimport { ContactMenu } from './ContactMenu';\n"
)
replace_once(
    'src/components/RoomHighlightModal.tsx',
    '''                                if (matchingTeam?.phone) {\n                                  const phoneClean = String(matchingTeam.phone || '').replace(/\\s+/g, '');\n                                  return (\n                                    <a\n                                      href={`tel:${phoneClean}`}\n                                      className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg font-bold text-[10px] flex items-center gap-1 shrink-0 active:scale-95 transition-all shadow-2xs"\n                                      title={`Gọi điện thoại cho ${matchingTeam.name} (${matchingTeam.phone})`}\n                                    >\n                                      <Phone className="w-3 h-3 text-emerald-600" />\n                                      <span>Gọi</span>\n                                    </a>\n                                  );\n                                }''',
    '''                                if (matchingTeam?.phone) {\n                                  return (\n                                    <ContactMenu\n                                      target={{ name: matchingTeam.leader || matchingTeam.name, phone: matchingTeam.phone }}\n                                      context={{ type: 'room', shareText: `HNL QLTC – Liên hệ đội thi công\\nĐội: ${matchingTeam.name}\\nĐội trưởng: ${matchingTeam.leader || 'Chưa cập nhật'}\\nSĐT: ${matchingTeam.phone}` }}\n                                      triggerLabel="Liên hệ"\n                                    />\n                                  );\n                                }'''
)

# Android: expose minimal system share + generic Zalo launcher bridge.
replace_once(
    'android-wrapper/src/com/qlct/app/MainActivity.java',
    '        webView.addJavascriptInterface(new AndroidExportBridge(), "AndroidExport");\n',
    '        webView.addJavascriptInterface(new AndroidExportBridge(), "AndroidExport");\n        webView.addJavascriptInterface(new AndroidContactBridge(), "AndroidContact");\n'
)
replace_once(
    'android-wrapper/src/com/qlct/app/MainActivity.java',
    '    public class AndroidExportBridge {\n',
    '''    public class AndroidContactBridge {\n        @JavascriptInterface\n        public boolean shareText(String title, String text) {\n            try {\n                final String safeTitle = title == null || title.trim().isEmpty() ? "HNL QLTC" : title.trim();\n                final String safeText = text == null ? "" : text;\n                if (safeText.trim().isEmpty()) return false;\n                runOnUiThread(() -> {\n                    try {\n                        Intent sendIntent = new Intent(Intent.ACTION_SEND);\n                        sendIntent.setType("text/plain");\n                        sendIntent.putExtra(Intent.EXTRA_SUBJECT, safeTitle);\n                        sendIntent.putExtra(Intent.EXTRA_TEXT, safeText);\n                        startActivity(Intent.createChooser(sendIntent, "Chia se tu HNL QLTC"));\n                    } catch (Exception error) {\n                        showToast("Khong the mo chia se he thong: " + error.getMessage());\n                    }\n                });\n                return true;\n            } catch (Exception error) {\n                return false;\n            }\n        }\n\n        @JavascriptInterface\n        public boolean openZalo() {\n            try {\n                runOnUiThread(() -> {\n                    try {\n                        Intent launchIntent = getPackageManager().getLaunchIntentForPackage("com.zing.zalo");\n                        if (launchIntent != null) {\n                            startActivity(launchIntent);\n                            return;\n                        }\n                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://zalo.me/")));\n                    } catch (Exception error) {\n                        showToast("Khong the mo Zalo. Hay mo Zalo thu cong.");\n                    }\n                });\n                return true;\n            } catch (Exception error) {\n                return false;\n            }\n        }\n    }\n\n    public class AndroidExportBridge {\n'''
)

print('contact core phase 1 patch complete')
