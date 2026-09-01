from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'{label}: anchor not found')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    print('patched', label)

# App imports + shared type/default/sanitizer.
replace_once(
    'src/App.tsx',
    "import { SuperAdminCenter } from './components/SuperAdminCenter';",
    "import { SuperAdminCenter, SuperAdminUiSettings } from './components/SuperAdminCenter';",
    'App SuperAdmin type import',
)

replace_once(
    'src/App.tsx',
    "export const saveProjectsList = (list: ProjectInfo[]) => {\n  const next = JSON.stringify(list);\n  try {\n    if (localStorage.getItem('construction_projects_list') === next) return;\n  } catch (_) {}\n  safeSetLocalStorageItem('construction_projects_list', next);\n};\n\nexport default function App() {",
    "export const saveProjectsList = (list: ProjectInfo[]) => {\n  const next = JSON.stringify(list);\n  try {\n    if (localStorage.getItem('construction_projects_list') === next) return;\n  } catch (_) {}\n  safeSetLocalStorageItem('construction_projects_list', next);\n};\n\nconst DEFAULT_SUPER_ADMIN_UI_SETTINGS: SuperAdminUiSettings = {\n  scalePercent: 100,\n  checklistVisibility: 'auto',\n  theme: 'system',\n  primaryColor: '#4f46e5',\n  secondaryColor: '#059669',\n  buttonSize: 'standard',\n  iconSize: 'standard',\n  density: 'standard',\n  borderRadius: 'soft',\n  appDisplayName: 'HNL QLTC',\n  logoUrl: '',\n};\n\nconst normalizeHexColor = (value: unknown, fallback: string): string => {\n  const text = String(value || '').trim();\n  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;\n};\n\nconst normalizeSuperAdminUiSettings = (raw: any): SuperAdminUiSettings => {\n  const logoCandidate = String(raw?.logoUrl || '').trim();\n  const safeLogoUrl = !logoCandidate || logoCandidate.startsWith('/') || /^https:\\/\\//i.test(logoCandidate) ? logoCandidate : '';\n  return {\n    scalePercent: [90, 100, 110, 120].includes(Number(raw?.scalePercent)) ? Number(raw.scalePercent) : 100,\n    checklistVisibility: raw?.checklistVisibility === 'always' ? 'always' : 'auto',\n    theme: ['light', 'dark', 'system'].includes(String(raw?.theme)) ? raw.theme : 'system',\n    primaryColor: normalizeHexColor(raw?.primaryColor, DEFAULT_SUPER_ADMIN_UI_SETTINGS.primaryColor),\n    secondaryColor: normalizeHexColor(raw?.secondaryColor, DEFAULT_SUPER_ADMIN_UI_SETTINGS.secondaryColor),\n    buttonSize: ['compact', 'standard', 'large'].includes(String(raw?.buttonSize)) ? raw.buttonSize : 'standard',\n    iconSize: ['small', 'standard', 'large'].includes(String(raw?.iconSize)) ? raw.iconSize : 'standard',\n    density: ['compact', 'standard', 'comfortable'].includes(String(raw?.density)) ? raw.density : 'standard',\n    borderRadius: ['square', 'soft', 'round'].includes(String(raw?.borderRadius)) ? raw.borderRadius : 'soft',\n    appDisplayName: String(raw?.appDisplayName || 'HNL QLTC').trim().slice(0, 40) || 'HNL QLTC',\n    logoUrl: safeLogoUrl.slice(0, 1000),\n  };\n};\n\nexport default function App() {",
    'App UI defaults and sanitizer',
)

replace_once(
    'src/App.tsx',
    "  const [superAdminUiSettings, setSuperAdminUiSettings] = useState<{ scalePercent: number; checklistVisibility: 'auto' | 'always' }>({ scalePercent: 100, checklistVisibility: 'auto' });",
    "  const [superAdminUiSettings, setSuperAdminUiSettings] = useState<SuperAdminUiSettings>(DEFAULT_SUPER_ADMIN_UI_SETTINGS);",
    'App UI settings state',
)

replace_once(
    'src/App.tsx',
    "      if (settings.superAdminUi && typeof settings.superAdminUi === 'object') {\n        const raw = settings.superAdminUi as any;\n        const nextUi = {\n          scalePercent: [90, 100, 110, 120].includes(Number(raw.scalePercent)) ? Number(raw.scalePercent) : 100,\n          checklistVisibility: raw.checklistVisibility === 'always' ? 'always' as const : 'auto' as const,\n        };\n        setSuperAdminUiSettings(nextUi);\n        localStorage.setItem(getKey('construction_superadmin_ui', activeProjectId), JSON.stringify(nextUi));\n      }",
    "      if (settings.superAdminUi && typeof settings.superAdminUi === 'object') {\n        const nextUi = normalizeSuperAdminUiSettings(settings.superAdminUi);\n        setSuperAdminUiSettings(nextUi);\n        localStorage.setItem(getKey('construction_superadmin_ui', activeProjectId), JSON.stringify(nextUi));\n      }",
    'App shared UI hydration',
)

replace_once(
    'src/App.tsx',
    "  useEffect(() => {\n    const pct = Math.min(120, Math.max(90, Number(superAdminUiSettings.scalePercent) || 100));\n    document.documentElement.style.fontSize = `${pct}%`;\n    return () => { document.documentElement.style.fontSize = ''; };\n  }, [superAdminUiSettings.scalePercent]);",
    "  useEffect(() => {\n    const root = document.documentElement;\n    const pct = Math.min(120, Math.max(90, Number(superAdminUiSettings.scalePercent) || 100));\n    root.style.fontSize = `${pct}%`;\n    root.style.setProperty('--hnl-primary', superAdminUiSettings.primaryColor);\n    root.style.setProperty('--hnl-secondary', superAdminUiSettings.secondaryColor);\n    root.dataset.hnlButtonSize = superAdminUiSettings.buttonSize;\n    root.dataset.hnlIconSize = superAdminUiSettings.iconSize;\n    root.dataset.hnlDensity = superAdminUiSettings.density;\n    root.dataset.hnlRadius = superAdminUiSettings.borderRadius;\n\n    const media = window.matchMedia('(prefers-color-scheme: dark)');\n    const applyTheme = () => {\n      root.dataset.hnlTheme = superAdminUiSettings.theme === 'system'\n        ? (media.matches ? 'dark' : 'light')\n        : superAdminUiSettings.theme;\n    };\n    applyTheme();\n    if (superAdminUiSettings.theme === 'system') media.addEventListener?.('change', applyTheme);\n\n    return () => {\n      if (superAdminUiSettings.theme === 'system') media.removeEventListener?.('change', applyTheme);\n    };\n  }, [superAdminUiSettings]);",
    'App live UI application',
)

replace_once(
    'src/App.tsx',
    "  const previewSuperAdminUiSettings = (next: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => {\n    if (!isCurrentSuperAdmin) return;\n    setSuperAdminUiSettings(next);\n  };\n\n  const saveSuperAdminUiSettings = async (next: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => {\n    if (!isCurrentSuperAdmin || !getCurrentRealFirebaseUser()) throw new Error('Chỉ SUPER ADMIN đã xác thực được lưu cấu hình giao diện.');\n    const sanitized = {\n      scalePercent: [90, 100, 110, 120].includes(Number(next.scalePercent)) ? Number(next.scalePercent) : 100,\n      checklistVisibility: next.checklistVisibility === 'always' ? 'always' as const : 'auto' as const,\n    };\n    setSuperAdminUiSettings(sanitized);\n    localStorage.setItem(getKey('construction_superadmin_ui', activeProjectIdRef.current), JSON.stringify(sanitized));\n    await saveProjectSharedSettings(activeProjectIdRef.current, { superAdminUi: sanitized });\n    await saveProjectAuditLog(activeProjectIdRef.current, { action: 'SECURITY_CONFIG_CHANGE', description: `SUPER ADMIN cập nhật giao diện: scale ${sanitized.scalePercent}%, checklist ${sanitized.checklistVisibility}`, module: 'system-ui', syncStatus: 'PENDING' }).catch(() => {});\n  };\n\n  const resetSuperAdminUiSettings = async () => {\n    await saveSuperAdminUiSettings({ scalePercent: 100, checklistVisibility: 'auto' });\n  };",
    "  const previewSuperAdminUiSettings = (next: SuperAdminUiSettings) => {\n    if (!isCurrentSuperAdmin) return;\n    setSuperAdminUiSettings(normalizeSuperAdminUiSettings(next));\n  };\n\n  const saveSuperAdminUiSettings = async (next: SuperAdminUiSettings) => {\n    if (!isCurrentSuperAdmin || !getCurrentRealFirebaseUser()) throw new Error('Chỉ SUPER ADMIN đã xác thực được lưu cấu hình giao diện.');\n    const sanitized = normalizeSuperAdminUiSettings(next);\n    setSuperAdminUiSettings(sanitized);\n    localStorage.setItem(getKey('construction_superadmin_ui', activeProjectIdRef.current), JSON.stringify(sanitized));\n    await saveProjectSharedSettings(activeProjectIdRef.current, { superAdminUi: sanitized });\n    await saveProjectAuditLog(activeProjectIdRef.current, { action: 'SECURITY_CONFIG_CHANGE', description: `SUPER ADMIN cập nhật giao diện V2: theme ${sanitized.theme}, scale ${sanitized.scalePercent}%, checklist ${sanitized.checklistVisibility}`, module: 'system-ui', syncStatus: 'PENDING' }).catch(() => {});\n  };\n\n  const resetSuperAdminUiSettings = async () => {\n    await saveSuperAdminUiSettings(DEFAULT_SUPER_ADMIN_UI_SETTINGS);\n  };",
    'App UI preview/save/reset handlers',
)

# Add header branding props inside the first GoogleAuthHeader tag.
p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
pattern = r'(<GoogleAuthHeader\s*\n\s*projectName=\{projectName\})'
m = re.search(pattern, s)
if not m:
    raise SystemExit('App GoogleAuthHeader anchor not found')
s = s[:m.end()] + "\n              appDisplayName={superAdminUiSettings.appDisplayName}\n              logoUrl={superAdminUiSettings.logoUrl}" + s[m.end():]
p.write_text(s, encoding='utf-8')
print('patched App header branding props')

# GoogleAuthHeader accepts branding and uses it visibly.
replace_once(
    'src/components/GoogleAuthHeader.tsx',
    "  projectName: string;\n  projectId?: string;",
    "  projectName: string;\n  appDisplayName?: string;\n  logoUrl?: string;\n  projectId?: string;",
    'Header branding props interface',
)
replace_once(
    'src/components/GoogleAuthHeader.tsx',
    "  projectName,\n  projectId,",
    "  projectName,\n  appDisplayName = 'HNL QLTC',\n  logoUrl = '',\n  projectId,",
    'Header branding props destructure',
)
replace_once(
    'src/components/GoogleAuthHeader.tsx',
    "                  src={`/icon.png?v=${APP_VERSION}`}\n                  alt=\"HNL Quản Lý Thi Công\"",
    "                  src={logoUrl || `/icon.png?v=${APP_VERSION}`}\n                  alt={appDisplayName || 'HNL Quản Lý Thi Công'}\n                  onError={(e) => { if (!e.currentTarget.src.includes('/icon.png')) e.currentTarget.src = `/icon.png?v=${APP_VERSION}`; }}",
    'Header custom logo',
)
replace_once(
    'src/components/GoogleAuthHeader.tsx',
    "              <div className=\"min-w-0 flex-1\">\n                <div className=\"flex items-center gap-1.5 flex-wrap\">",
    "              <div className=\"min-w-0 flex-1\">\n                <div className=\"text-[8px] sm:text-[9px] font-extrabold uppercase tracking-widest text-indigo-300 truncate\">{appDisplayName}</div>\n                <div className=\"flex items-center gap-1.5 flex-wrap\">",
    'Header visible app name',
)

# Firebase shared settings type supports V2 fields.
replace_once(
    'src/lib/firebase.ts',
    "  superAdminUi?: {\n    scalePercent?: number;\n    checklistVisibility?: 'auto' | 'always';\n  };",
    "  superAdminUi?: {\n    scalePercent?: number;\n    checklistVisibility?: 'auto' | 'always';\n    theme?: 'light' | 'dark' | 'system';\n    primaryColor?: string;\n    secondaryColor?: string;\n    buttonSize?: 'compact' | 'standard' | 'large';\n    iconSize?: 'small' | 'standard' | 'large';\n    density?: 'compact' | 'standard' | 'comfortable';\n    borderRadius?: 'square' | 'soft' | 'round';\n    appDisplayName?: string;\n    logoUrl?: string;\n  };",
    'Firebase shared UI V2 type',
)

# Global functional theme/accent/control CSS.
p = Path('src/index.css')
s = p.read_text(encoding='utf-8')
marker = '/* HNL SUPER ADMIN UI V2 */'
if marker not in s:
    s += r'''

/* HNL SUPER ADMIN UI V2 */
:root {
  --hnl-primary: #4f46e5;
  --hnl-secondary: #059669;
}

/* Primary accent: map the app's existing indigo design tokens to the Super Admin color. */
.bg-indigo-600, .bg-indigo-700 { background-color: var(--hnl-primary) !important; }
.text-indigo-300, .text-indigo-400, .text-indigo-500, .text-indigo-600, .text-indigo-700 { color: var(--hnl-primary) !important; }
.border-indigo-200, .border-indigo-300, .border-indigo-500, .border-indigo-600, .border-indigo-700 { border-color: color-mix(in srgb, var(--hnl-primary) 55%, transparent) !important; }
.hnl-secondary-action { background-color: var(--hnl-secondary) !important; }

/* Dark mode intentionally targets the common neutral surfaces only; semantic status colors stay intact. */
html[data-hnl-theme="dark"] body,
html[data-hnl-theme="dark"] #root { background: #020617 !important; color: #e2e8f0; }
html[data-hnl-theme="dark"] .bg-white { background-color: #0f172a !important; }
html[data-hnl-theme="dark"] .bg-slate-50 { background-color: #111827 !important; }
html[data-hnl-theme="dark"] .bg-slate-100 { background-color: #1e293b !important; }
html[data-hnl-theme="dark"] .text-slate-900,
html[data-hnl-theme="dark"] .text-slate-800,
html[data-hnl-theme="dark"] .text-slate-700 { color: #f1f5f9 !important; }
html[data-hnl-theme="dark"] .text-slate-600,
html[data-hnl-theme="dark"] .text-slate-500 { color: #cbd5e1 !important; }
html[data-hnl-theme="dark"] .border-slate-200,
html[data-hnl-theme="dark"] .border-slate-300 { border-color: #334155 !important; }

/* Button/input touch targets. Compact never shrinks below accessibility-friendly defaults. */
html[data-hnl-button-size="large"] button,
html[data-hnl-button-size="large"] input,
html[data-hnl-button-size="large"] select { min-height: 2.75rem; }
html[data-hnl-button-size="compact"] button,
html[data-hnl-button-size="compact"] input,
html[data-hnl-button-size="compact"] select { min-height: 2rem; }

/* Lucide icons use one global size policy when Super Admin requests it. */
html[data-hnl-icon-size="small"] .lucide { width: .9rem !important; height: .9rem !important; }
html[data-hnl-icon-size="large"] .lucide { width: 1.3rem !important; height: 1.3rem !important; }

/* Density is deliberately conservative to avoid breaking responsive tables. */
html[data-hnl-density="compact"] body { line-height: 1.25; }
html[data-hnl-density="comfortable"] body { line-height: 1.6; }
html[data-hnl-density="comfortable"] button { padding-top: .55rem; padding-bottom: .55rem; }

/* Radius policy applies to controls/cards while preserving circular badges/avatars. */
html[data-hnl-radius="square"] button:not(.rounded-full),
html[data-hnl-radius="square"] input,
html[data-hnl-radius="square"] select,
html[data-hnl-radius="square"] textarea { border-radius: .2rem !important; }
html[data-hnl-radius="round"] button:not(.rounded-full),
html[data-hnl-radius="round"] input,
html[data-hnl-radius="round"] select,
html[data-hnl-radius="round"] textarea { border-radius: 1rem !important; }
'''
    p.write_text(s, encoding='utf-8')
    print('patched global UI V2 CSS')
else:
    print('UI V2 CSS already present')
