#!/usr/bin/env python3
"""Resolve audited three-way DEV/PROD conflicts on a disposable QA runner only.
No Git pushes, Firebase writes, rules changes, or schema migrations.
The DEV versions are preferred when they contain newer durability logic.
Selected independent PROD CAD shortcuts are retained.
"""
import re
from pathlib import Path

choices = {
    'scripts/dev-backup-four-issues-golden.mjs': 'o',
    'scripts/dev-backup-voucher-a3-a4-matrix-golden.ts': 'o',
    'scripts/floorplan-p0-golden.ts': 'o',
    'scripts/prod-readiness-golden.mjs': 'o',
    'scripts/stability-gate.mjs': 'o',
    'scripts/ui-entry-ux-golden.ts': 'ot',
    'scripts/warehouse-voucher-xlsx-style-golden.ts': 'o',
    'src/App.tsx': 'o',
    'src/components/FloorPlanDefectTab.tsx': 'iotototototootoooo',
    'src/lib/chatService.ts': 'oooooo',
    'src/utils/warehouseVoucherExcel.ts': 'o',
}
# Each character handles exactly one Git conflict hunk: o=DEV, t=PROD,
# i=union of DEV import declarations plus PROD-only keyboard helper import.
pattern = re.compile(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*', re.S)
for name, strategy in choices.items():
    path = Path(name)
    original = path.read_text()
    matches = list(pattern.finditer(original))
    if len(matches) != len(strategy):
        raise SystemExit(f'Conflict drift {name}: got {len(matches)}, expected {len(strategy)}')
    selections = iter(strategy)
    def resolve(m):
        o, t = m.group(1), m.group(2)
        choice = next(selections)
        if choice == 'o': return o
        if choice == 't': return t
        if choice == 'i':
            return "import { CAD_GRID_STEP, applyCadDrawingGuide, getCadDrawingHotkey } from '../utils/roomHighlightCadShortcuts';\n" + o
        raise SystemExit(f'Unsupported conflict choice {choice!r}')
    resolved = pattern.sub(resolve, original)
    if '<<<<<<< ' in resolved or '>>>>>>> ' in resolved:
        raise SystemExit(f'Unresolved markers in {name}')
    path.write_text(resolved)
    print(f'QA SAFE MERGE: {name}: {len(matches)} hunks resolved')
chat = Path('src/lib/chatService.ts')
source = chat.read_text()
anchor = "import { isCurrentChatSender, shouldAutoFlushChatEntry } from '../utils/chatOutboxRecovery';"
if source.count(anchor) != 1:
    raise SystemExit('Chat outbox guard import anchor changed')
source = source.replace(anchor, anchor + "\nimport { deterministicMessageId, isChatOutboxEntryOwnedByUid } from '../utils/chatOutboxOwnership';")
chat.write_text(source)
print('QA SAFE MERGE: preserve DEV chat atomic/offline safety and PROD deterministic message identity')
