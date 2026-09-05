from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text(encoding='utf-8')

lazy_anchor = "const ChatTab = React.lazy(() => import('./features/chat/ChatTab').then(m => ({ default: m.ChatTab })));\n"
if lazy_anchor not in text:
    raise SystemExit('ChatTab lazy anchor not found')
if "AiAssistantPage" not in text:
    text = text.replace(
        lazy_anchor,
        lazy_anchor
        + "const AiAssistantPage = React.lazy(() => import('./features/ai/AiAssistantPage').then(m => ({ default: m.AiAssistantPage })));\n"
        + "const HNL_AI_ENABLED = String(((import.meta as any).env || {}).VITE_HNL_AI_ENABLED || 'false').toLowerCase() === 'true';\n",
        1,
    )

config_anchor = "          {activeTab === 'config' && (\n            <GoogleConfigTab"
if config_anchor not in text:
    raise SystemExit('config render anchor not found')
if "activeTab === 'ai'" not in text:
    ai_block = """          {HNL_AI_ENABLED && activeTab === 'ai' && (\n            <AiAssistantPage\n              projectId={activeProjectId}\n              projectName={projectName}\n              role={currentUserRole}\n              accessVerified={isProjectRoleResolved && projectRoleAllowed}\n              online={isOnline}\n              rooms={roomProgressList}\n              defects={defects}\n              crewRecords={crewRecords}\n              teams={teams}\n              floors={floorPlans}\n              workVolumes={workVolumes}\n              inventory={inventory}\n              materialNorms={materialNorms}\n              checklist={checklist}\n            />\n          )}\n\n"""
    text = text.replace(config_anchor, ai_block + config_anchor, 1)

nav_anchor = "            showChecklist={showChecklistModule}\n            showSuperAdmin={isCurrentSuperAdmin}"
if nav_anchor not in text:
    raise SystemExit('BottomNav props anchor not found')
if "showAi={HNL_AI_ENABLED}" not in text:
    text = text.replace(
        nav_anchor,
        "            showChecklist={showChecklistModule}\n            showAi={HNL_AI_ENABLED}\n            showSuperAdmin={isCurrentSuperAdmin}",
        1,
    )

path.write_text(text, encoding='utf-8')
