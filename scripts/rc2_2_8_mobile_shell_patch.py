from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH ASSERTION FAILED: {path}: expected 1 occurrence, found {count}\n--- needle ---\n{old[:700]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('PATCHED', path)


# Type model must describe Cloud member lifecycle so last-admin guard can fail closed.
replace_once(
    'src/utils/securityUtils.ts',
    """export interface ProjectMember {\n  email: string;\n  role: UserRole;\n  assignedAt: number;\n  uid?: string;\n  displayName?: string;\n}""",
    """export interface ProjectMember {\n  email: string;\n  role: UserRole;\n  assignedAt: number;\n  uid?: string;\n  displayName?: string;\n  active?: boolean;\n  updatedAt?: number;\n}"""
)

# App owns one keyboard/visual-viewport signal. Floating UI may not independently guess it.
replace_once(
    'src/App.tsx',
    """  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' ? true : navigator.onLine);\n  const [cloudDefectIndex, setCloudDefectIndex] = useState<{ projectId: string; ids: Set<string> } | null>(null);""",
    """  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' ? true : navigator.onLine);\n  const [isSoftKeyboardOpen, setIsSoftKeyboardOpen] = useState(false);\n  const [cloudDefectIndex, setCloudDefectIndex] = useState<{ projectId: string; ids: Set<string> } | null>(null);"""
)

replace_once(
    'src/App.tsx',
    """  useEffect(() => {\n    const handleOnline = () => setIsOnline(true);\n    const handleOffline = () => setIsOnline(false);\n    window.addEventListener('online', handleOnline);\n    window.addEventListener('offline', handleOffline);\n    return () => {\n      window.removeEventListener('online', handleOnline);\n      window.removeEventListener('offline', handleOffline);\n    };\n  }, []);\n\n  useEffect(() => {\n    let isMounted = true;""",
    """  useEffect(() => {\n    const handleOnline = () => setIsOnline(true);\n    const handleOffline = () => setIsOnline(false);\n    window.addEventListener('online', handleOnline);\n    window.addEventListener('offline', handleOffline);\n    return () => {\n      window.removeEventListener('online', handleOnline);\n      window.removeEventListener('offline', handleOffline);\n    };\n  }, []);\n\n  useEffect(() => {\n    const viewport = window.visualViewport;\n    if (!viewport) return;\n    const updateKeyboardState = () => {\n      // Android/iOS keyboard normally reduces VisualViewport by >140px. Small browser\n      // chrome changes must not hide the navigation bar.\n      const obscured = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);\n      setIsSoftKeyboardOpen(obscured > 140);\n    };\n    updateKeyboardState();\n    viewport.addEventListener('resize', updateKeyboardState);\n    viewport.addEventListener('scroll', updateKeyboardState);\n    return () => {\n      viewport.removeEventListener('resize', updateKeyboardState);\n      viewport.removeEventListener('scroll', updateKeyboardState);\n    };\n  }, []);\n\n  useEffect(() => {\n    let isMounted = true;"""
)

replace_once(
    'src/App.tsx',
    """        style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}""",
    """        style={{ paddingBottom: isSoftKeyboardOpen ? '0px' : 'calc(5rem + env(safe-area-inset-bottom))' }}"""
)

replace_once(
    'src/App.tsx',
    """        {/* Floating Due Date Toast Notification */}\n        <DueDateToastNotifier\n          workVolumes={workVolumes}\n          checklist={activeChecklist}\n          defects={activeDefects}\n          onNavigateToItem={handleNavigateFromAlert}\n          onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}\n        />""",
    """        {/* Floating alerts never compete with the chat composer / soft keyboard. */}\n        {activeTab !== 'chat' && !isSoftKeyboardOpen && (\n          <DueDateToastNotifier\n            workVolumes={workVolumes}\n            checklist={activeChecklist}\n            defects={activeDefects}\n            onNavigateToItem={handleNavigateFromAlert}\n            onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}\n          />\n        )}"""
)

replace_once(
    'src/App.tsx',
    """        {chatToast && activeTab !== 'chat' && (""",
    """        {chatToast && activeTab !== 'chat' && !isSoftKeyboardOpen && ("""
)

replace_once(
    'src/App.tsx',
    """        {/* Fixed Mobile Bottom Navigation Bar */}\n        <BottomNav\n          activeTab={activeTab}\n          setActiveTab={setActiveTab}\n          defectBadgeCount={unhandledDefectsCount}\n          chatBadgeCount={chatUnreadCount}\n        />""",
    """        {/* Fixed navigation is hidden while the OS keyboard owns the visual viewport. */}\n        {!isSoftKeyboardOpen && (\n          <BottomNav\n            activeTab={activeTab}\n            setActiveTab={setActiveTab}\n            defectBadgeCount={unhandledDefectsCount}\n            chatBadgeCount={chatUnreadCount}\n          />\n        )}"""
)

# Mobile notification badge goes straight to the center instead of expanding a large overlay.
replace_once(
    'src/components/DueDateToastNotifier.tsx',
    """      <div className=\"fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200\">\n        <button\n          onClick={() => setIsMinimized(false)}""",
    """      <div\n        className=\"fixed right-2 sm:right-6 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200\"\n        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}\n      >\n        <button\n          onClick={() => {\n            const compact = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;\n            if (compact && onOpenNotificationCenter) onOpenNotificationCenter();\n            else setIsMinimized(false);\n          }}"""
)

replace_once(
    'src/components/DueDateToastNotifier.tsx',
    """          <span>Thông báo tiến độ/defect ({visibleAlerts.length})</span>""",
    """          <span className=\"sm:hidden\">Thông báo ({visibleAlerts.length})</span>\n          <span className=\"hidden sm:inline\">Thông báo tiến độ/defect ({visibleAlerts.length})</span>"""
)

replace_once(
    'src/components/DueDateToastNotifier.tsx',
    """    <div className=\"fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-40 w-[calc(100vw-1rem)] max-w-[25rem] animate-in fade-in slide-in-from-bottom-5 duration-300\">""",
    """    <div\n      className=\"fixed right-2 sm:right-6 z-40 w-[calc(100vw-1rem)] max-w-[25rem] animate-in fade-in slide-in-from-bottom-5 duration-300\"\n      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}\n    >"""
)

# Chat room follows the real VisualViewport so the composer remains above Android/iOS keyboard.
replace_once(
    'src/features/chat/ChatTab.tsx',
    """import { ArrowLeft, CheckCheck, ImagePlus, Loader2, MessageCircle, MoreVertical, Reply, Send, Trash2, Pencil, WifiOff, X } from 'lucide-react';""",
    """import { ArrowLeft, CheckCheck, ImagePlus, Loader2, MessageCircle, MoreVertical, Reply, Send, Trash2, Pencil, X } from 'lucide-react';"""
)

replace_once(
    'src/features/chat/ChatTab.tsx',
    """  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);\n  const user = getCurrentRealFirebaseUser();""",
    """  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);\n  const [visualViewportHeight, setVisualViewportHeight] = useState(() =>\n    typeof window !== 'undefined' ? (window.visualViewport?.height || window.innerHeight) : 720\n  );\n  const user = getCurrentRealFirebaseUser();"""
)

replace_once(
    'src/features/chat/ChatTab.tsx',
    """  useEffect(() => startPresence(), []);\n\n  useEffect(() => {\n    if (!activeProjectId) return;""",
    """  useEffect(() => startPresence(), []);\n\n  useEffect(() => {\n    const viewport = window.visualViewport;\n    const update = () => setVisualViewportHeight(viewport?.height || window.innerHeight);\n    update();\n    viewport?.addEventListener('resize', update);\n    viewport?.addEventListener('scroll', update);\n    window.addEventListener('resize', update);\n    return () => {\n      viewport?.removeEventListener('resize', update);\n      viewport?.removeEventListener('scroll', update);\n      window.removeEventListener('resize', update);\n    };\n  }, []);\n\n  useEffect(() => {\n    if (!activeProjectId) return;"""
)

replace_once(
    'src/features/chat/ChatTab.tsx',
    """        {!isPresenceConfigured && (\n          <div className=\"rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2\">\n            <WifiOff className=\"w-4 h-4 shrink-0 mt-0.5\" />\n            <span>Trạng thái Online và “đang nhập…” hiện chưa được bật. Tin nhắn dự án vẫn hoạt động bình thường.</span>\n          </div>\n        )}\n\n""",
    """"""
)

replace_once(
    'src/features/chat/ChatTab.tsx',
    """    <div className=\"max-w-3xl mx-auto h-[calc(100dvh-8rem)] pb-20 flex flex-col bg-white sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden\">""",
    """    <div\n      className=\"max-w-3xl mx-auto flex flex-col bg-white sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden\"\n      style={{ height: `${Math.max(320, visualViewportHeight - 112)}px` }}\n    >"""
)

replace_once(
    'src/features/chat/ChatTab.tsx',
    """            <div className=\"text-[10px] text-slate-500\">Phòng dự án · {isPresenceConfigured ? 'Presence đã cấu hình' : 'Presence chưa bật'}</div>""",
    """            <div className=\"text-[10px] text-slate-500\">Phòng dự án · {isPresenceConfigured ? 'Trạng thái online hoạt động' : 'Tin nhắn realtime'}</div>"""
)

# Static regression checks for mobile shell invariants.
replace_once(
    'scripts/rbac-matrix.mjs',
    """  photos: read('src/components/PhotoAttachmentPicker.tsx'),\n  firebase: read('src/lib/firebase.ts'),""",
    """  photos: read('src/components/PhotoAttachmentPicker.tsx'),\n  toast: read('src/components/DueDateToastNotifier.tsx'),\n  chat: read('src/features/chat/ChatTab.tsx'),\n  firebase: read('src/lib/firebase.ts'),"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Notification Defect navigation carries exact identity and floor', has(src.app, 'qlct_pending_defect_navigation', 'defectId: defect.id', 'floorId: defect.floorId'));\ncheck('FloorPlan consumes Defect deep-link and opens exact detail', has(src.floor, 'qlct_pending_defect_navigation', \"setStatusFilter('all')\", \"setViewMode('defect')\", 'setActiveDefectDetail(defect)', 'pendingFocusRef.current'));""",
    """check('Notification Defect navigation carries exact identity and floor', has(src.app, 'qlct_pending_defect_navigation', 'defectId: defect.id', 'floorId: defect.floorId'));\ncheck('FloorPlan consumes Defect deep-link and opens exact detail', has(src.floor, 'qlct_pending_defect_navigation', \"setStatusFilter('all')\", \"setViewMode('defect')\", 'setActiveDefectDetail(defect)', 'pendingFocusRef.current'));\ncheck('Mobile shell owns one soft-keyboard visualViewport gate', has(src.app, 'isSoftKeyboardOpen', 'window.visualViewport', 'obscured > 140', \"activeTab !== 'chat' && !isSoftKeyboardOpen\", '{!isSoftKeyboardOpen && ('));\ncheck('Mobile alert badge opens notification center without large overlay', has(src.toast, \"window.matchMedia('(max-width: 639px)')\", 'if (compact && onOpenNotificationCenter) onOpenNotificationCenter()', 'env(safe-area-inset-bottom)'));\ncheck('Chat composer follows VisualViewport and no longer reserves BottomNav space', has(src.chat, 'visualViewportHeight', 'window.visualViewport', 'visualViewportHeight - 112') && !src.chat.includes('pb-20 flex flex-col'));"""
)

print('RC2.2.8 MOBILE SHELL PATCH COMPLETE')
