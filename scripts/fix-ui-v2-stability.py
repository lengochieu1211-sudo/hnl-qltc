from pathlib import Path
p = Path('scripts/stability-gate.mjs')
s = p.read_text(encoding='utf-8')
old = "if (!authHeader.includes('src={`/icon.png?v=${APP_VERSION}`}')) fail('header asset cache-bust does not use canonical APP_VERSION');"
new = "if (!authHeader.includes('logoUrl || `/icon.png?v=${APP_VERSION}`') || !authHeader.includes('e.currentTarget.src = `/icon.png?v=${APP_VERSION}`')) fail('header custom logo must retain canonical APP_VERSION fallback');"
if old not in s:
    raise SystemExit('stability logo guard anchor missing')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('patched Stability logo guard for configurable branding')
