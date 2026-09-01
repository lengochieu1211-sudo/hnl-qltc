from pathlib import Path
p = Path('src/lib/firebase.ts')
s = p.read_text(encoding='utf-8')
old = "export interface ProjectSharedSettings {\n"
new = "export interface ProjectSharedSettings {\n  superAdminUi?: {\n    scalePercent?: number;\n    checklistVisibility?: 'auto' | 'always';\n  };\n"
if old not in s:
    raise SystemExit('ProjectSharedSettings interface anchor not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('patched ProjectSharedSettings.superAdminUi type')
