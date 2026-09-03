from pathlib import Path

p = Path('scripts/firebase-rules-behavior.mjs')
text = p.read_text(encoding='utf-8')
old = """  await expectDenied('EDITOR cannot write private member contact', () => setDoc(memberContactRef, {\n    projectId: pid, email: editorEmail, phone: '0999999999', displayName: 'Editor Escalation',\n    updatedAt: Date.now(), updatedByUid: editorUid,\n  }, { merge: true }));\n\n  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));"""
new = """  await expectDenied('EDITOR cannot write private member contact', () => setDoc(memberContactRef, {\n    projectId: pid, email: editorEmail, phone: '0999999999', displayName: 'Editor Escalation',\n    updatedAt: Date.now(), updatedByUid: editorUid,\n  }, { merge: true }));\n\n  await signIn(viewerEmail);\n  await expectAllowed('VIEWER remains a valid project member', () => getDoc(doc(db, 'projects', pid)));\n  await expectDenied('VIEWER cannot read private member contact', () => getDoc(memberContactRef));\n  await expectDenied('VIEWER cannot write private member contact', () => setDoc(doc(db, 'projects', pid, 'memberContacts', viewerEmail), {\n    projectId: pid, email: viewerEmail, phone: '0888888888', displayName: 'Viewer Test',\n    updatedAt: Date.now(), updatedByUid: viewerUid,\n  }));\n  await signIn(editorEmail);\n\n  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));"""
if new in text:
    print('viewer privacy regression: already patched')
elif old not in text:
    raise SystemExit('viewer privacy regression: anchor not found')
else:
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('viewer privacy regression: patched')
