from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        print(f'{label}: already patched')
        return
    if old not in text:
        raise SystemExit(f'{label}: anchor not found in {path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'{label}: patched')

# Firestore privacy boundary: memberContacts are intentionally separate from members.
replace_once(
    'firestore.rules',
    '''      // Append-only, identity-bound audit stream. This path is intentionally\n      // excluded from the generic project-data rule below.\n      match /activityLogs/{logId} {''',
    '''      // Private contact directory. VIEWER may read member role/email documents but\n      // must never receive phone/contact details. EDITOR may read contacts for field\n      // coordination; only ADMIN/Owner/Super Admin may write them.\n      match /memberContacts/{memberId} {\n        allow read: if canEdit(projectId);\n        allow create, update: if isAdmin(projectId)\n          && request.resource.data.projectId == projectId\n          && request.resource.data.email is string\n          && request.resource.data.email.lower() == memberId.lower()\n          && request.resource.data.phone is string\n          && request.resource.data.displayName is string\n          && request.resource.data.updatedByUid == request.auth.uid;\n        allow delete: if false;\n      }\n\n      // Append-only, identity-bound audit stream. This path is intentionally\n      // excluded from the generic project-data rule below.\n      match /activityLogs/{logId} {''',
    'firestore memberContacts rules',
)

# Emulator regression: ADMIN write/read, EDITOR read only, VIEWER denied.
replace_once(
    'scripts/firebase-rules-behavior.mjs',
    '''  await expectDenied('admin cannot write arbitrary member role', () => setDoc(doc(db, 'projects', pid, 'members', `bad-${nonce}@example.test`), {\n    email: `bad-${nonce}@example.test`, role: 'SUPERROOT', active: true,\n  }));\n\n  const sharedSettingsRef = doc(db, 'projects', pid, 'settings', 'shared');''',
    '''  await expectDenied('admin cannot write arbitrary member role', () => setDoc(doc(db, 'projects', pid, 'members', `bad-${nonce}@example.test`), {\n    email: `bad-${nonce}@example.test`, role: 'SUPERROOT', active: true,\n  }));\n\n  const memberContactRef = doc(db, 'projects', pid, 'memberContacts', editorEmail);\n  await expectAllowed('ADMIN writes private member contact', () => setDoc(memberContactRef, {\n    projectId: pid, email: editorEmail, phone: '0901234567', displayName: 'Editor Test',\n    updatedAt: Date.now(), updatedByUid: ownerUid,\n  }));\n  await expectAllowed('ADMIN reads private member contact', () => getDoc(memberContactRef));\n\n  const sharedSettingsRef = doc(db, 'projects', pid, 'settings', 'shared');''',
    'rules admin member contact test',
)

replace_once(
    'scripts/firebase-rules-behavior.mjs',
    '''  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));''',
    '''  await expectAllowed('EDITOR reads private member contact', () => getDoc(memberContactRef));\n  await expectDenied('EDITOR cannot write private member contact', () => setDoc(memberContactRef, {\n    projectId: pid, email: editorEmail, phone: '0999999999', displayName: 'Editor Escalation',\n    updatedAt: Date.now(), updatedByUid: editorUid,\n  }, { merge: true }));\n\n  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));''',
    'rules editor member contact test',
)

# Insert viewer denial before owner re-login after the initial unlisted-user probe section.
replace_once(
    'scripts/firebase-rules-behavior.mjs',
    '''  await createUserWithEmailAndPassword(auth, editorEmail, password);\n  const viewerCred = await createUserWithEmailAndPassword(auth, viewerEmail, password);\n  const viewerUid = viewerCred.user.uid;\n  await expectDenied('unlisted authenticated user cannot read an existing project root', () => getDoc(doc(db, 'projects', pid)));\n  await signIn(ownerEmail);''',
    '''  await createUserWithEmailAndPassword(auth, editorEmail, password);\n  const viewerCred = await createUserWithEmailAndPassword(auth, viewerEmail, password);\n  const viewerUid = viewerCred.user.uid;\n  await expectDenied('unlisted authenticated user cannot read an existing project root', () => getDoc(doc(db, 'projects', pid)));\n  await signIn(ownerEmail);''',
    'viewer setup marker',
)

# SecurityModal imports.
replace_once(
    'src/components/SecurityModal.tsx',
    '''import { signInWithGoogle, getCurrentFirebaseUser, fetchProjectUserRoleFromCloud, claimProjectOwnership, fetchProjectMembersFromCloud, fetchProjectAuditLogsFromCloud, subscribeProjectMembersRealtime, subscribeProjectAuditLogsRealtime, repairProjectAccessIndexForProject } from '../lib/firebase';''',
    '''import { signInWithGoogle, getCurrentFirebaseUser, fetchProjectUserRoleFromCloud, claimProjectOwnership, fetchProjectMembersFromCloud, fetchProjectAuditLogsFromCloud, subscribeProjectMembersRealtime, subscribeProjectAuditLogsRealtime, repairProjectAccessIndexForProject, subscribeProjectMemberContactsRealtime, saveProjectMemberContactToCloud, ProjectMemberContact } from '../lib/firebase';''',
    'SecurityModal firebase imports',
)
replace_once(
    'src/components/SecurityModal.tsx',
    '''import { isSuperAdminEmail } from '../config/superAdmin';''',
    '''import { isSuperAdminEmail } from '../config/superAdmin';\nimport { ContactMenu } from './ContactMenu';''',
    'SecurityModal ContactMenu import',
)

# State and privacy capability.
replace_once(
    'src/components/SecurityModal.tsx',
    '''  const [projectMembers, setProjectMembers] = useState<any[]>([]);\n  const [newMemberEmail, setNewMemberEmail] = useState('');''',
    '''  const [projectMembers, setProjectMembers] = useState<any[]>([]);\n  const [memberContacts, setMemberContacts] = useState<Record<string, ProjectMemberContact>>({});\n  const [contactDrafts, setContactDrafts] = useState<Record<string, string>>({});\n  const [savingContactEmail, setSavingContactEmail] = useState<string>('');\n  const [newMemberEmail, setNewMemberEmail] = useState('');''',
    'SecurityModal contact state',
)
replace_once(
    'src/components/SecurityModal.tsx',
    '''  const canManageProjectMembers = canManageMembers(currentRole);\n  const isCompanySuperAdmin = isSuperAdminEmail(cloudUser?.email);''',
    '''  const canManageProjectMembers = canManageMembers(currentRole);\n  const canReadMemberContacts = currentRole === 'ADMIN' || currentRole === 'EDITOR';\n  const isCompanySuperAdmin = isSuperAdminEmail(cloudUser?.email);''',
    'SecurityModal contact capability',
)

# Separate subscription keeps Viewer fail-closed and prevents stale phone data after role/project changes.
replace_once(
    'src/components/SecurityModal.tsx',
    '''    return () => { cancelled = true; unsubMembers(); unsubAudit(); };\n  }, [selectedPid]);\n\n  if (!isOpen) return null;''',
    '''    return () => { cancelled = true; unsubMembers(); unsubAudit(); };\n  }, [selectedPid]);\n\n  useEffect(() => {\n    setMemberContacts({});\n    setContactDrafts({});\n    if (!selectedPid || !canReadMemberContacts) return;\n    return subscribeProjectMemberContactsRealtime(selectedPid, (contacts) => {\n      if (selectedPidRef.current !== selectedPid) return;\n      const next: Record<string, ProjectMemberContact> = {};\n      contacts.forEach((contact) => {\n        const email = String(contact.email || '').trim().toLowerCase();\n        if (email) next[email] = contact;\n      });\n      setMemberContacts(next);\n    }, (error: any) => {\n      if (String(error?.code || '').toLowerCase().includes('permission')) return;\n      console.warn('Member contact realtime warning:', error);\n    });\n  }, [selectedPid, canReadMemberContacts]);\n\n  if (!isOpen) return null;''',
    'SecurityModal contact subscription',
)

# Admin-only save handler.
replace_once(
    'src/components/SecurityModal.tsx',
    '''  const handleExportLogsSafe = async () => {''',
    '''  const handleSaveMemberContact = async (email: string) => {\n    if (!canManageProjectMembers) {\n      setMemberMsg({ type: 'error', text: 'Chỉ ADMIN/Owner được cập nhật số điện thoại thành viên.' });\n      return;\n    }\n    const normalizedEmail = String(email || '').trim().toLowerCase();\n    if (!normalizedEmail) return;\n    setSavingContactEmail(normalizedEmail);\n    setMemberMsg(null);\n    try {\n      await ensureCloudAdminForMemberWrite(selectedPid);\n      const current = memberContacts[normalizedEmail];\n      const member = projectMembers.find((item: any) => String(item?.email || '').trim().toLowerCase() === normalizedEmail);\n      const phone = String(contactDrafts[normalizedEmail] ?? current?.phone ?? '').trim();\n      await saveProjectMemberContactToCloud(selectedPid, {\n        email: normalizedEmail,\n        phone,\n        displayName: String(member?.displayName || current?.displayName || '').trim(),\n      });\n      setMemberContacts((prev) => ({\n        ...prev,\n        [normalizedEmail]: {\n          email: normalizedEmail, projectId: selectedPid, phone: phone || undefined,\n          displayName: String(member?.displayName || current?.displayName || '').trim() || undefined,\n        },\n      }));\n      setContactDrafts((prev) => ({ ...prev, [normalizedEmail]: phone }));\n      setMemberMsg({ type: 'success', text: phone ? `Đã lưu số liên hệ cho ${normalizedEmail}.` : `Đã xóa số liên hệ của ${normalizedEmail}.` });\n      logAuditAction('SECURITY_CONFIG_CHANGE', `Cập nhật danh bạ liên hệ thành viên ${normalizedEmail} ở dự án ${selectedPid}`, selectedPid);\n    } catch (err: any) {\n      setMemberMsg({ type: 'error', text: `Không lưu được số liên hệ: ${err?.message || err}` });\n    } finally {\n      setSavingContactEmail('');\n    }\n  };\n\n  const handleExportLogsSafe = async () => {''',
    'SecurityModal save contact handler',
)

# Replace member row with responsive contact-aware row.
old_row = '''                    sortedProjectMembers.map(m => (\n                      <div\n                        key={m.email}\n                        className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100 text-xs"\n                      >\n                        <div className="flex items-center gap-2 min-w-0">\n                          <div className="min-w-0">\n                            {m.displayName && <div className="font-bold text-slate-800 truncate">{m.displayName}</div>}\n                            <div className="font-semibold text-slate-600 truncate">{m.email}</div>\n                          </div>\n                          <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${\n                            m.role === 'ADMIN'\n                              ? 'bg-rose-100 text-rose-700'\n                              : m.role === 'EDITOR'\n                              ? 'bg-blue-100 text-blue-700'\n                              : 'bg-slate-200 text-slate-700'\n                          }`}>\n                            {m.role === 'ADMIN' ? 'Admin' : m.role === 'EDITOR' ? 'Kỹ sư' : 'Chỉ xem'}\n                          </span>\n                        </div>\n                        {isCompanySuperAdmin && <button type="button" onClick={() => void handleRemotePinReset(m.email)} className="mr-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-[9px] font-extrabold whitespace-nowrap" title="Vô hiệu hóa PIN local của user khi thiết bị online">Reset PIN</button>}\n                        {canManageProjectMembers && <button\n                          type="button"\n                          onClick={() => handleRemoveMemberSafe(m.email)}\n                          disabled={isSavingMember}\n                          className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"\n                        >\n                          <Trash2 className="w-3.5 h-3.5" />\n                        </button>}\n                      </div>\n                    ))'''
new_row = '''                    sortedProjectMembers.map(m => {\n                      const email = String(m.email || '').trim().toLowerCase();\n                      const contact = memberContacts[email];\n                      const phoneValue = contactDrafts[email] ?? contact?.phone ?? '';\n                      return (\n                      <div\n                        key={m.email}\n                        className="p-2 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-2"\n                      >\n                        <div className="flex items-center justify-between gap-2">\n                          <div className="flex items-center gap-2 min-w-0">\n                            <div className="min-w-0">\n                              {m.displayName && <div className="font-bold text-slate-800 truncate">{m.displayName}</div>}\n                              <div className="font-semibold text-slate-600 truncate">{m.email}</div>\n                              {canReadMemberContacts && contact?.phone && <div className="text-[10px] font-bold text-emerald-700 mt-0.5">☎ {contact.phone}</div>}\n                            </div>\n                            <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase ${\n                              m.role === 'ADMIN'\n                                ? 'bg-rose-100 text-rose-700'\n                                : m.role === 'EDITOR'\n                                ? 'bg-blue-100 text-blue-700'\n                                : 'bg-slate-200 text-slate-700'\n                            }`}>\n                              {m.role === 'ADMIN' ? 'Admin' : m.role === 'EDITOR' ? 'Kỹ sư' : 'Chỉ xem'}\n                            </span>\n                          </div>\n                          <div className="flex items-center gap-1 shrink-0">\n                            {canReadMemberContacts && <ContactMenu\n                              target={{ name: m.displayName || m.email, phone: contact?.phone }}\n                              context={{ type: 'member', projectId: selectedPid, entityId: email }}\n                              triggerLabel={contact?.phone ? 'Liên hệ' : 'Chia sẻ'}\n                            />}\n                            {isCompanySuperAdmin && <button type="button" onClick={() => void handleRemotePinReset(m.email)} className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-[9px] font-extrabold whitespace-nowrap" title="Vô hiệu hóa PIN local của user khi thiết bị online">Reset PIN</button>}\n                            {canManageProjectMembers && <button\n                              type="button"\n                              onClick={() => handleRemoveMemberSafe(m.email)}\n                              disabled={isSavingMember}\n                              className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"\n                              title="Thu hồi quyền thành viên"\n                            >\n                              <Trash2 className="w-3.5 h-3.5" />\n                            </button>}\n                          </div>\n                        </div>\n                        {canManageProjectMembers && (\n                          <div className="flex flex-col min-[420px]:flex-row gap-1.5 items-stretch">\n                            <input\n                              type="tel"\n                              value={phoneValue}\n                              onChange={(e) => setContactDrafts((prev) => ({ ...prev, [email]: e.target.value }))}\n                              placeholder="Số điện thoại / Zalo"\n                              className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[10.5px] font-semibold focus:ring-2 focus:ring-indigo-500"\n                            />\n                            <button\n                              type="button"\n                              onClick={() => void handleSaveMemberContact(email)}\n                              disabled={savingContactEmail === email}\n                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-extrabold disabled:opacity-50"\n                            >\n                              {savingContactEmail === email ? 'Đang lưu...' : 'Lưu liên hệ'}\n                            </button>\n                          </div>\n                        )}\n                        {!canReadMemberContacts && (\n                          <div className="text-[9.5px] text-slate-400">Thông tin liên hệ được ẩn với vai trò Chỉ xem.</div>\n                        )}\n                      </div>\n                    );\n                    })'''
replace_once('src/components/SecurityModal.tsx', old_row, new_row, 'SecurityModal member contact row')

print('Member Contact Phase 3 patch complete')
