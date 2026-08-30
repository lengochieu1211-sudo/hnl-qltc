from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH ASSERTION FAILED: {path}: expected 1 occurrence, found {count}\n{old[:700]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('PATCHED', path)

# Do not mutate another workflow from GITHUB_TOKEN: GitHub correctly blocks that.
# The build-step label is updated separately through the repository connector.
replace_once(
    'src/components/BottomNav.tsx',
    """    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount },""",
    """    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount, badgeLabel: 'Defect chưa xử lý' },"""
)

replace_once(
    'src/components/BottomNav.tsx',
    """              onClick={() => { setShowMore(false); setActiveTab(tab.id); }}\n              className={`relative flex flex-col items-center justify-center transition-all ${""",
    """              onClick={() => { setShowMore(false); setActiveTab(tab.id); }}\n              title={tab.badge !== undefined && tab.badge > 0 ? `${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}\n              aria-label={tab.badge !== undefined && tab.badge > 0 ? `${tab.label}: ${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}\n              className={`relative flex flex-col items-center justify-center transition-all ${"""
)

replace_once(
    'src/components/BottomNav.tsx',
    """                  <span className=\"absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-extrabold px-1 rounded-full\">\n                    {tab.badge}\n                  </span>""",
    """                  <span\n                    className=\"absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-extrabold px-1 rounded-full min-w-5 text-center\"\n                    title={`${tab.badge} ${tab.badgeLabel || 'thông báo'}`}\n                  >\n                    D{tab.badge}\n                  </span>"""
)

replace_once(
    'src/components/GoogleAuthHeader.tsx',
    """                  title=\"Trung tâm thông báo tiến độ, checklist & defect\"""",
    """                  title={dueDateAlertCount > 0 ? `${dueDateAlertCount} cảnh báo đến hạn/quá hạn · mở Trung tâm thông báo` : 'Trung tâm thông báo tiến độ, checklist & defect'}\n                  aria-label={dueDateAlertCount > 0 ? `Có ${dueDateAlertCount} cảnh báo đến hạn hoặc quá hạn` : 'Mở Trung tâm thông báo'}"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """  chat: read('src/features/chat/ChatTab.tsx'),\n  firebase: read('src/lib/firebase.ts'),""",
    """  chat: read('src/features/chat/ChatTab.tsx'),\n  bottomNav: read('src/components/BottomNav.tsx'),\n  authHeader: read('src/components/GoogleAuthHeader.tsx'),\n  firebase: read('src/lib/firebase.ts'),"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Mobile alert badge opens notification center without large overlay', has(src.toast, \"window.matchMedia('(max-width: 639px)')\", 'if (compact && onOpenNotificationCenter) onOpenNotificationCenter()', 'env(safe-area-inset-bottom)'));""",
    """check('Mobile alert badge opens notification center without large overlay', has(src.toast, \"window.matchMedia('(max-width: 639px)')\", 'if (compact && onOpenNotificationCenter) onOpenNotificationCenter()', 'env(safe-area-inset-bottom)'));\ncheck('Badge semantics distinguish Defect count from deadline alerts', has(src.bottomNav, \"badgeLabel: 'Defect chưa xử lý'\", 'D{tab.badge}') && has(src.authHeader, 'cảnh báo đến hạn/quá hạn', 'aria-label'));"""
)

print('RC2.2.8 DEPENDENCY/BADGE SOURCE PATCH COMPLETE')
