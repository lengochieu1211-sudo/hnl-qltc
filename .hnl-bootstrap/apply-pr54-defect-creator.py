from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


floor = 'src/components/FloorPlanDefectTab.tsx'
app = 'src/App.tsx'

replace_once(
    floor,
    "import { appendRuntimeDiagnostic } from '../lib/runtimeDiagnostics';\nimport { ContactMenu } from './ContactMenu';",
    "import { appendRuntimeDiagnostic } from '../lib/runtimeDiagnostics';\nimport { getCurrentRealFirebaseUser } from '../lib/firebase';\nimport { getRememberedVerifiedAuthIdentity } from '../utils/offlineAccess';\nimport { ContactMenu } from './ContactMenu';",
    'FloorPlan identity imports',
)

replace_once(
    floor,
    "  const [createdBy, setCreatedBy] = useState(() => inspectorName || 'Kỹ sư QC');",
    "  const realDefectCreator = getCurrentRealFirebaseUser();\n  const rememberedDefectCreator = getRememberedVerifiedAuthIdentity();\n  const currentDefectCreatorLabel = String(\n    realDefectCreator?.displayName ||\n    realDefectCreator?.email ||\n    rememberedDefectCreator?.displayName ||\n    rememberedDefectCreator?.email || ''\n  ).trim();",
    'FloorPlan creator state',
)

replace_once(
    floor,
    "      createdBy: createdBy.trim() || inspectorName || 'Kỹ sư QC',",
    "      createdBy: currentDefectCreatorLabel,",
    'FloorPlan create payload creator',
)

replace_once(
    floor,
    "                    value={createdBy}\n                    readOnly\n                    placeholder=\"Tự ghi theo tài khoản đăng nhập\"",
    "                    value={currentDefectCreatorLabel}\n                    readOnly\n                    placeholder=\"Đang xác định tài khoản Firebase...\"",
    'FloorPlan creator input',
)

replace_once(
    app,
    "      const actor = getCurrentRealFirebaseUser();\n      const actorLabel = String(actor?.displayName || actor?.email || defect.createdBy || inspectorName || 'Kỹ sư QC').trim();\n      const newDefect: DefectItem = {\n        ...defect,\n        id: newId,\n        createdAt: new Date().toISOString(),\n        createdBy: actorLabel,\n        ...(actor?.uid ? { createdByUid: actor.uid } : {}),\n      };",
    "      const actor = getCurrentRealFirebaseUser();\n      const rememberedActor = getRememberedVerifiedAuthIdentity();\n      const actorLabel = String(\n        actor?.displayName || actor?.email ||\n        rememberedActor?.displayName || rememberedActor?.email ||\n        defect.createdBy || ''\n      ).trim();\n      const actorUid = actor?.uid || rememberedActor?.uid || '';\n      if (!actorLabel) {\n        console.warn('[Defect] Không xác định được tài khoản tạo Defect; bỏ qua thao tác để tránh ghi sai Người Tạo.');\n        return prev;\n      }\n      const newDefect: DefectItem = {\n        ...defect,\n        id: newId,\n        createdAt: new Date().toISOString(),\n        createdBy: actorLabel,\n        ...(actorUid ? { createdByUid: actorUid } : {}),\n      };",
    'App persisted creator identity',
)

print('PR54 Defect creator exact-replacement bootstrap: PASS')
