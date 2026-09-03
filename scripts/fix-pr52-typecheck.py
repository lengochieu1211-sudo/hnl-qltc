from pathlib import Path
p = Path('src/components/GoogleConfigTab.tsx')
text = p.read_text(encoding='utf-8')
old = """    const photoDiagnostics = activeProjectId
      ? await getProjectPhotoDiagnosticSnapshot(activeProjectId).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
      : null;
    return buildDiagnosticBundle({"""
new = """    const photoDiagnostics = activeProjectId
      ? await getProjectPhotoDiagnosticSnapshot(activeProjectId).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
      : null;
    const photoDiagnosticsClean = Boolean(
      photoDiagnostics &&
      !('error' in photoDiagnostics) &&
      Number(photoDiagnostics.pending || 0) === 0 &&
      Number(photoDiagnostics.active || 0) === Number(photoDiagnostics.ready || 0)
    );
    return buildDiagnosticBundle({"""
if text.count(old) != 1:
    raise SystemExit(f'anchor count {text.count(old)}')
text = text.replace(old, new, 1)
replacements = {
"pendingDriveUploads: photoDiagnostics && Number(photoDiagnostics?.pending || 0) === 0 && Number(photoDiagnostics?.active || 0) === Number(photoDiagnostics?.ready || 0) ? 0 : (syncDiagnostics?.pendingDriveUploads ?? 0),": "pendingDriveUploads: photoDiagnosticsClean ? 0 : (syncDiagnostics?.pendingDriveUploads ?? 0),",
"lastSyncError: photoDiagnostics && Number(photoDiagnostics?.pending || 0) === 0 && Number(photoDiagnostics?.active || 0) === Number(photoDiagnostics?.ready || 0) && /ảnh|photo|cloud\\/r2/i.test(syncDiagnostics?.lastSyncError || '') ? '' : (syncDiagnostics?.lastSyncError || ''),": "lastSyncError: photoDiagnosticsClean && /ảnh|photo|cloud\\/r2/i.test(syncDiagnostics?.lastSyncError || '') ? '' : (syncDiagnostics?.lastSyncError || ''),",
"photoPending: photoDiagnostics && Number(photoDiagnostics?.pending || 0) === 0 && Number(photoDiagnostics?.active || 0) === Number(photoDiagnostics?.ready || 0) ? 0 : (syncDiagnostics?.photoPending ?? 0),": "photoPending: photoDiagnosticsClean ? 0 : (syncDiagnostics?.photoPending ?? 0),",
"photoPhase: photoDiagnostics && Number(photoDiagnostics?.pending || 0) === 0 && Number(photoDiagnostics?.active || 0) === Number(photoDiagnostics?.ready || 0) ? 'idle' : (syncDiagnostics?.photoPhase || 'idle'),": "photoPhase: photoDiagnosticsClean ? 'idle' : (syncDiagnostics?.photoPhase || 'idle'),",
}
for old_s, new_s in replacements.items():
    if text.count(old_s) != 1:
        raise SystemExit(f'replacement anchor count {text.count(old_s)}: {old_s[:80]}')
    text = text.replace(old_s, new_s, 1)
p.write_text(text, encoding='utf-8')
print('PR52 typecheck patch applied')
