from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'REFUSING {path}: expected exact block once, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'updated {path}')

replace_once(
    'src/components/FloorPlanDefectTab.tsx',
    "import { getRememberedVerifiedAuthIdentity } from '../utils/offlineAccess';\nimport { ContactMenu } from './ContactMenu';",
    "import { getRememberedVerifiedAuthIdentity } from '../utils/offlineAccess';\nimport { resolveVerifiedIdentityLabel } from '../utils/authIdentityUtils';\nimport { ContactMenu } from './ContactMenu';",
)

replace_once(
    'src/components/FloorPlanDefectTab.tsx',
    """  const realDefectCreator = getCurrentRealFirebaseUser();
  const rememberedDefectCreator = getRememberedVerifiedAuthIdentity();
  const currentDefectCreatorLabel = String(
    realDefectCreator?.displayName ||
    realDefectCreator?.email ||
    rememberedDefectCreator?.displayName ||
    rememberedDefectCreator?.email || ''
  ).trim();""",
    """  const realDefectCreator = getCurrentRealFirebaseUser();
  const rememberedDefectCreator = getRememberedVerifiedAuthIdentity();
  const currentDefectCreatorLabel = resolveVerifiedIdentityLabel(
    realDefectCreator,
    rememberedDefectCreator,
  );""",
)

replace_once(
    'src/App.tsx',
    "import { cacheVerifiedProjectRole, getCachedVerifiedProjectRole, getRememberedVerifiedAuthIdentity, rememberVerifiedAuthIdentity } from './utils/offlineAccess';",
    "import { cacheVerifiedProjectRole, getCachedVerifiedProjectRole, getRememberedVerifiedAuthIdentity, rememberVerifiedAuthIdentity } from './utils/offlineAccess';\nimport { resolveVerifiedIdentityLabel } from './utils/authIdentityUtils';",
)

replace_once(
    'src/App.tsx',
    """      const actor = getCurrentRealFirebaseUser();
      const rememberedActor = getRememberedVerifiedAuthIdentity();
      const actorLabel = String(
        actor?.displayName || actor?.email ||
        rememberedActor?.displayName || rememberedActor?.email ||
        defect.createdBy || ''
      ).trim();
      const actorUid = actor?.uid || rememberedActor?.uid || '';""",
    """      const actor = getCurrentRealFirebaseUser();
      const rememberedActor = getRememberedVerifiedAuthIdentity();
      const actorLabel = resolveVerifiedIdentityLabel(actor, rememberedActor);
      const actorUid = actor?.uid || rememberedActor?.uid || '';""",
)

print('PR54 defect identity integration exact replacements: PASS')
