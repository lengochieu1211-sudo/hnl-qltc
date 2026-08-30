from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH ASSERTION FAILED: {path}: expected 1 occurrence, found {count}\n--- needle ---\n{old[:500]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'PATCHED {path}')


# 1) Notification -> exact Defect deep-link handoff.
replace_once(
    'src/App.tsx',
    """  const handleNavigateFromAlert = (alertItem: DueDateAlertItem) => {\n    if (alertItem.type === 'workVolume') {\n      setActiveTab('volume');\n    } else if (alertItem.type === 'checklist') {\n      setActiveTab('checklist');\n    } else if (alertItem.type === 'defect') {\n      setActiveTab('floorplan');\n    }\n  };""",
    """  const handleNavigateFromAlert = (alertItem: DueDateAlertItem) => {\n    if (alertItem.type === 'workVolume') {\n      setActiveTab('volume');\n    } else if (alertItem.type === 'checklist') {\n      setActiveTab('checklist');\n    } else if (alertItem.type === 'defect') {\n      const defect = alertItem.originalItem as DefectItem;\n      try {\n        sessionStorage.setItem('qlct_pending_defect_navigation', JSON.stringify({\n          projectId: activeProjectId,\n          defectId: defect.id,\n          floorId: defect.floorId,\n          x: defect.x,\n          y: defect.y,\n          requestedAt: Date.now(),\n        }));\n      } catch (_) {}\n      setActiveTab('floorplan');\n    }\n  };"""
)

replace_once(
    'src/components/FloorPlanDefectTab.tsx',
    """  const [activeDefectDetail, setActiveDefectDetail] = useState<DefectItem | null>(null);\n\n  useEffect(() => {\n    if (!canEditDefects) {""",
    """  const [activeDefectDetail, setActiveDefectDetail] = useState<DefectItem | null>(null);\n\n  // RC2.2.8: notification deep-link is identity-based, never just a tab switch.\n  // It selects the exact floor, clears a stale status filter, exposes the Defect layer,\n  // focuses the map pin and opens the same detail modal used by a direct card tap.\n  useEffect(() => {\n    let raw = '';\n    try { raw = sessionStorage.getItem('qlct_pending_defect_navigation') || ''; } catch (_) {}\n    if (!raw) return;\n\n    try {\n      const pending = JSON.parse(raw);\n      if (pending?.projectId && String(pending.projectId) !== currentProjectId) return;\n      const defect = defects.find((item) =>\n        item?.id === pending?.defectId\n        && !item?.archivedAt\n        && !(item as any)?.deleted\n        && !item?.deletedAt\n      );\n      if (!defect) {\n        sessionStorage.removeItem('qlct_pending_defect_navigation');\n        console.warn('[Defect navigation] Target no longer exists or is archived:', pending?.defectId);\n        return;\n      }\n      if (!floorPlans.some((floor) => floor.id === defect.floorId)) {\n        sessionStorage.removeItem('qlct_pending_defect_navigation');\n        console.warn('[Defect navigation] Target floor no longer exists:', defect.floorId);\n        return;\n      }\n\n      sessionStorage.removeItem('qlct_pending_defect_navigation');\n      localStorage.setItem(getDraftKey('construction_selected_floor_id'), defect.floorId);\n      localStorage.setItem(getDraftKey('construction_selected_view_mode'), 'defect');\n      pendingFocusRef.current = { floorId: defect.floorId, x: defect.x, y: defect.y };\n      setStatusFilter('all');\n      setViewMode('defect');\n      setMapLayers((prev) => ({ ...prev, defects: true }));\n      setSelectedDefectIds([defect.id]);\n      setActiveDefectDetail(defect);\n\n      if (selectedFloorId !== defect.floorId) {\n        setSelectedFloorId(defect.floorId);\n      } else {\n        requestAnimationFrame(() => requestAnimationFrame(() => focusPlanPoint(defect.x, defect.y)));\n      }\n    } catch (err) {\n      try { sessionStorage.removeItem('qlct_pending_defect_navigation'); } catch (_) {}\n      console.warn('[Defect navigation] Invalid pending target:', err);\n    }\n  }, [defects, currentProjectId, floorPlans, selectedFloorId]);\n\n  useEffect(() => {\n    if (!canEditDefects) {"""
)

# 2) Canonical RBAC client: normalized email is authoritative when present; UID is fallback only.
replace_once(
    'src/lib/firebase.ts',
    """function getMemberDocIdsForUser(user: { uid?: string | null; email?: string | null }): string[] {\n  const ids = new Set<string>();\n  if (user.uid) ids.add(user.uid);\n  const email = normalizeEmail(user.email);\n  if (email) ids.add(email);\n  return Array.from(ids);\n}""",
    """function getMemberDocIdsForUser(user: { uid?: string | null; email?: string | null }): string[] {\n  // Canonical email MUST be checked first. A UID document is legacy compatibility only\n  // and may never override an existing email role (including an inactive/revoked email row).\n  const ids = new Set<string>();\n  const email = normalizeEmail(user.email);\n  if (email) ids.add(email);\n  if (user.uid) ids.add(user.uid);\n  return Array.from(ids);\n}"""
)

replace_once(
    'src/lib/firebase.ts',
    """export async function fetchProjectMembersFromCloud(projectId: string): Promise<any[]> {\n  if (!projectId) return [];\n  try {\n    const colRef = collection(db, 'projects', projectId, 'members');\n    const snapshot = await getDocs(colRef);\n    const list: any[] = [];\n    snapshot.forEach(docSnap => {\n      list.push(docSnap.data());\n    });\n    return list;\n  } catch (err) {\n    console.warn('Error fetching cloud project members:', err);\n    return [];\n  }\n}""",
    """export async function fetchProjectMembersFromCloud(projectId: string): Promise<any[]> {\n  if (!projectId) return [];\n  try {\n    const colRef = collection(db, 'projects', projectId, 'members');\n    const snapshot = await getDocs(colRef);\n    const byEmail = new Map<string, any>();\n    snapshot.forEach((docSnap) => {\n      const data = docSnap.data();\n      const email = normalizeEmail(data?.email || (docSnap.id.includes('@') ? docSnap.id : ''));\n      if (!email) return;\n      const candidate = { id: docSnap.id, ...data, email };\n      const existing = byEmail.get(email);\n      const candidateCanonical = docSnap.id.toLowerCase() === email;\n      const existingCanonical = String(existing?.id || '').toLowerCase() === email;\n      if (!existing || candidateCanonical || (!existingCanonical && Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0))) {\n        byEmail.set(email, candidate);\n      }\n    });\n    return Array.from(byEmail.values());\n  } catch (err) {\n    console.warn('Error fetching cloud project members:', err);\n    return [];\n  }\n}"""
)

replace_once(
    'src/lib/firebase.ts',
    """      snap.docs.forEach((d) => {\n        const data = d.data();\n        const email = normalizeEmail(data?.email || (d.id.includes('@') ? d.id : ''));\n        if (!email) return;\n        const existing = byEmail.get(email);\n        if (!existing || Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0)) byEmail.set(email, { id: d.id, ...data, email });\n      });""",
    """      snap.docs.forEach((d) => {\n        const data = d.data();\n        const email = normalizeEmail(data?.email || (d.id.includes('@') ? d.id : ''));\n        if (!email) return;\n        const candidate = { id: d.id, ...data, email };\n        const existing = byEmail.get(email);\n        const candidateCanonical = d.id.toLowerCase() === email;\n        const existingCanonical = String(existing?.id || '').toLowerCase() === email;\n        if (!existing || candidateCanonical || (!existingCanonical && Number(data?.updatedAt || 0) >= Number(existing?.updatedAt || 0))) {\n          byEmail.set(email, candidate);\n        }\n      });"""
)

replace_once(
    'src/lib/firebase.ts',
    """    const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));\n    const seen = new Set<string>();\n    const members: Array<{ email: string; role: string }> = [];\n    membersSnap.forEach((memberSnap) => {\n      const data = memberSnap.data();\n      const memberEmail = normalizeEmail(data?.email || (memberSnap.id.includes('@') ? memberSnap.id : ''));\n      if (!memberEmail || seen.has(memberEmail) || data?.active === false) return;\n      seen.add(memberEmail);\n      members.push({ email: memberEmail, role: String(data?.role || 'VIEWER').toUpperCase() });\n    });""",
    """    const members: Array<{ email: string; role: string }> = (await fetchProjectMembersFromCloud(projectId))\n      .filter((member) => member?.email && member?.active !== false)\n      .map((member) => ({\n        email: normalizeEmail(member.email),\n        role: String(member?.role || 'VIEWER').toUpperCase(),\n      }));"""
)

replace_once(
    'src/lib/firebase.ts',
    """    await writeProjectMemberDocs(projectId, {\n      uid: targetUid,\n      email: normalizedEmail,\n      role: member.role,\n      active: true,\n      assignedAt: member.assignedAt\n    });\n\n    const projectSnap = await getDoc(doc(db, 'projects', projectId));""",
    """    await writeProjectMemberDocs(projectId, {\n      uid: targetUid,\n      email: normalizedEmail,\n      role: member.role,\n      active: true,\n      assignedAt: member.assignedAt\n    });\n\n    // Converge every legacy UID alias for this email to the canonical role. This is\n    // idempotent and prevents a stale physical row from resurfacing on older clients.\n    const memberRows = await getDocs(collection(db, 'projects', projectId, 'members'));\n    for (const memberRow of memberRows.docs) {\n      const rowData = memberRow.data();\n      const rowEmail = normalizeEmail(rowData?.email || (memberRow.id.includes('@') ? memberRow.id : ''));\n      if (!rowEmail || rowEmail !== normalizedEmail || memberRow.id.toLowerCase() === normalizedEmail) continue;\n      await setDoc(doc(db, 'projects', projectId, 'members', memberRow.id), {\n        email: normalizedEmail,\n        role: member.role,\n        active: true,\n        updatedAt: Date.now(),\n      }, { merge: true });\n    }\n\n    const projectSnap = await getDoc(doc(db, 'projects', projectId));"""
)

replace_once(
    'src/lib/firebase.ts',
    """    let targetUid = uid;\n\n    if (!targetUid) {\n      const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));\n      membersSnap.forEach((mDoc) => {\n        const mData = mDoc.data();\n        if (mData && mData.email === normalizedEmail) {\n          targetUid = mDoc.id;\n        }\n      });\n    }\n\n    if (targetUid) {\n      await deleteDoc(doc(db, 'projects', projectId, 'members', targetUid));\n    }\n    await deleteDoc(doc(db, 'projects', projectId, 'members', normalizedEmail)).catch(() => {});""",
    """    const aliasIds = new Set<string>([normalizedEmail]);\n    if (uid) aliasIds.add(uid);\n    const membersSnap = await getDocs(collection(db, 'projects', projectId, 'members'));\n    membersSnap.forEach((mDoc) => {\n      const mData = mDoc.data();\n      const rowEmail = normalizeEmail(mData?.email || (mDoc.id.includes('@') ? mDoc.id : ''));\n      if (rowEmail === normalizedEmail) aliasIds.add(mDoc.id);\n    });\n\n    for (const memberDocId of aliasIds) {\n      await deleteDoc(doc(db, 'projects', projectId, 'members', memberDocId)).catch(() => {});\n    }"""
)

# 3) UI last-admin guard counts logical emails, never physical rows.
replace_once(
    'src/components/SecurityModal.tsx',
    """  const countAdmins = (members: ProjectMember[]) => members.filter(m => m.role === 'ADMIN').length;""",
    """  const countAdmins = (members: ProjectMember[]) => new Set(\n    members\n      .filter((m) => m?.active !== false && m?.role === 'ADMIN')\n      .map((m) => String(m?.email || '').trim().toLowerCase())\n      .filter(Boolean)\n  ).size;"""
)

# 4) Firestore canonical member precedence.
replace_once(
    'firestore.rules',
    """    function isMember(projectId) {\n      return isGoogleAuthed() && (isSuperAdmin() || isOwner(projectId) || uidMemberActive(projectId) || emailMemberActive(projectId));\n    }\n\n    function isAdmin(projectId) {\n      return isGoogleAuthed() && (\n        isSuperAdmin() ||\n        isOwner(projectId) ||\n        (uidMemberActive(projectId) && uidRole(projectId) == 'ADMIN') ||\n        (emailMemberActive(projectId) && emailRole(projectId) == 'ADMIN')\n      );\n    }\n\n    function isEditor(projectId) {\n      return isGoogleAuthed() && (\n        (uidMemberActive(projectId) && (uidRole(projectId) == 'EDITOR' || uidRole(projectId) == 'ENGINEER')) ||\n        (emailMemberActive(projectId) && (emailRole(projectId) == 'EDITOR' || emailRole(projectId) == 'ENGINEER'))\n      );\n    }""",
    """    // Canonical membership invariant: if an email document exists it is the single\n    // authoritative role, including active=false revocation. UID is fallback only for\n    // legacy projects that have not materialized a canonical email document yet.\n    function canonicalMemberActive(projectId) {\n      return hasEmailMember(projectId) ? emailMemberActive(projectId) : uidMemberActive(projectId);\n    }\n\n    function canonicalMemberRole(projectId) {\n      return hasEmailMember(projectId) ? emailRole(projectId) : uidRole(projectId);\n    }\n\n    function isMember(projectId) {\n      return isGoogleAuthed() && (isSuperAdmin() || isOwner(projectId) || canonicalMemberActive(projectId));\n    }\n\n    function isAdmin(projectId) {\n      return isGoogleAuthed() && (\n        isSuperAdmin() ||\n        isOwner(projectId) ||\n        (canonicalMemberActive(projectId) && canonicalMemberRole(projectId) == 'ADMIN')\n      );\n    }\n\n    function isEditor(projectId) {\n      return isGoogleAuthed()\n        && canonicalMemberActive(projectId)\n        && (canonicalMemberRole(projectId) == 'EDITOR' || canonicalMemberRole(projectId) == 'ENGINEER');\n    }"""
)

# 5) Firebase Storage uses the same canonical precedence.
replace_once(
    'storage.rules',
    """    function isMember(projectId) {\n      return signedIn() && (isSuperAdmin() || isOwner(projectId) || uidMemberActive(projectId) || emailMemberActive(projectId));\n    }\n\n    function roleCanEdit(role) {\n      return role == 'ADMIN' || role == 'EDITOR' || role == 'ENGINEER';\n    }\n\n    function isAdmin(projectId) {\n      return signedIn() && (\n        isSuperAdmin() ||\n        isOwner(projectId) ||\n        (uidMemberActive(projectId) && uidMember(projectId).data.role == 'ADMIN') ||\n        (emailMemberActive(projectId) && emailMember(projectId).data.role == 'ADMIN')\n      );\n    }\n\n    function canEdit(projectId) {\n      return signedIn() && (\n        isAdmin(projectId) ||\n        (uidMemberActive(projectId) && roleCanEdit(uidMember(projectId).data.role)) ||\n        (emailMemberActive(projectId) && roleCanEdit(emailMember(projectId).data.role))\n      );\n    }""",
    """    function canonicalMemberActive(projectId) {\n      return emailMemberExists(projectId) ? emailMemberActive(projectId) : uidMemberActive(projectId);\n    }\n\n    function canonicalMemberRole(projectId) {\n      return emailMemberExists(projectId) ? emailMember(projectId).data.role : uidMember(projectId).data.role;\n    }\n\n    function isMember(projectId) {\n      return signedIn() && (isSuperAdmin() || isOwner(projectId) || canonicalMemberActive(projectId));\n    }\n\n    function roleCanEdit(role) {\n      return role == 'ADMIN' || role == 'EDITOR' || role == 'ENGINEER';\n    }\n\n    function isAdmin(projectId) {\n      return signedIn() && (\n        isSuperAdmin() ||\n        isOwner(projectId) ||\n        (canonicalMemberActive(projectId) && canonicalMemberRole(projectId) == 'ADMIN')\n      );\n    }\n\n    function canEdit(projectId) {\n      return signedIn() && (\n        isAdmin(projectId) ||\n        (canonicalMemberActive(projectId) && roleCanEdit(canonicalMemberRole(projectId)))\n      );\n    }"""
)

# 6) R2 gateway: canonical email first; a present canonical row fails closed and never falls through to UID.
replace_once(
    'cloudflare/r2-gateway/worker.js',
    """  for (const memberId of [uid, email]) {\n    const response = await firestoreGet(env, token, `projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`);\n    if (!response.ok) continue;\n    const member = await response.json();\n    if (!fieldBool(member, 'active', true)) continue;\n    const role = fieldString(member, 'role').toUpperCase();\n    if (['ADMIN', 'EDITOR', 'ENGINEER', 'VIEWER'].includes(role)) return { ok: true, role };\n  }""",
    """  // Canonical email is authoritative whenever present. UID is legacy fallback only.\n  for (const memberId of [email, uid]) {\n    if (!memberId) continue;\n    const response = await firestoreGet(env, token, `projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`);\n    if (!response.ok) continue;\n    const member = await response.json();\n    if (!fieldBool(member, 'active', true)) return { ok: false, role: '' };\n    const role = fieldString(member, 'role').toUpperCase();\n    return ['ADMIN', 'EDITOR', 'ENGINEER', 'VIEWER'].includes(role)\n      ? { ok: true, role }\n      : { ok: false, role: '' };\n  }"""
)

# 7) Regression: stale UID ADMIN must not elevate a canonical VIEWER in Firestore or Storage.
replace_once(
    'scripts/firebase-rules-behavior.mjs',
    """  await createUserWithEmailAndPassword(auth, editorEmail, password);\n  await createUserWithEmailAndPassword(auth, viewerEmail, password);""",
    """  await createUserWithEmailAndPassword(auth, editorEmail, password);\n  const viewerCred = await createUserWithEmailAndPassword(auth, viewerEmail, password);\n  const viewerUid = viewerCred.user.uid;"""
)

replace_once(
    'scripts/firebase-rules-behavior.mjs',
    """  await signIn(viewerEmail);\n  await expectAllowed('VIEWER reads project/core record', () => getDoc(recordRef));""",
    """  // Regression: a stale UID ADMIN alias must never override canonical email VIEWER.\n  await signIn(ownerEmail);\n  await expectAllowed('ADMIN may create stale UID alias for canonical-precedence regression', () => setDoc(doc(db, 'projects', pid, 'members', viewerUid), {\n    uid: viewerUid, email: viewerEmail, role: 'ADMIN', active: true, assignedAt: Date.now(), updatedAt: Date.now(),\n  }));\n\n  await signIn(viewerEmail);\n  await expectAllowed('VIEWER reads project/core record', () => getDoc(recordRef));"""
)

# 8) R2 regression: canonical VIEWER beats stale UID ADMIN.
replace_once(
    'scripts/r2-gateway-golden.mjs',
    """response = await call(identities.viewer, 'PUT', mediaKey, new Uint8Array([6]));\nassert(response.status === 403, 'VIEWER may not upload media');""",
    """response = await call(identities.viewer, 'PUT', mediaKey, new Uint8Array([6]));\nassert(response.status === 403, 'VIEWER may not upload media');\nroles.set('uid-editor', 'ADMIN');\nroles.set('editor@example.com', 'VIEWER');\nresponse = await call(identities.editor, 'PUT', mediaKey, new Uint8Array([6, 7]));\nassert(response.status === 403, 'canonical email VIEWER overrides stale UID ADMIN');\nroles.set('uid-editor', 'EDITOR');\nroles.set('editor@example.com', 'EDITOR');"""
)

# 9) Master RBAC matrix now protects canonical identity + defect deep-link invariants.
replace_once(
    'scripts/rbac-matrix.mjs',
    """  config: read('src/components/GoogleConfigTab.tsx'),\n  photos: read('src/components/PhotoAttachmentPicker.tsx'),\n  firestore: read('firestore.rules'),\n  storage: read('storage.rules'),""",
    """  config: read('src/components/GoogleConfigTab.tsx'),\n  photos: read('src/components/PhotoAttachmentPicker.tsx'),\n  firebase: read('src/lib/firebase.ts'),\n  r2: read('cloudflare/r2-gateway/worker.js'),\n  firestore: read('firestore.rules'),\n  storage: read('storage.rules'),"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Security member mutation is ADMIN-only', has(src.securityModal, 'canManageProjectMembers', 'canManageMembers(currentRole)'));""",
    """check('Security member mutation is ADMIN-only', has(src.securityModal, 'canManageProjectMembers', 'canManageMembers(currentRole)'));\ncheck('Last ADMIN guard counts unique logical emails', has(src.securityModal, 'new Set(', \"m?.role === 'ADMIN'\", \"String(m?.email || '').trim().toLowerCase()\"));\ncheck('Member list collapses physical aliases to canonical email', has(src.firebase, 'candidateCanonical', 'existingCanonical', 'byEmail.set(email, candidate)'));\ncheck('Client resolves canonical email before UID fallback', src.firebase.indexOf('if (email) ids.add(email);') < src.firebase.indexOf('if (user.uid) ids.add(user.uid);'));\ncheck('Notification Defect navigation carries exact identity and floor', has(src.app, 'qlct_pending_defect_navigation', 'defectId: defect.id', 'floorId: defect.floorId'));\ncheck('FloorPlan consumes Defect deep-link and opens exact detail', has(src.floor, 'qlct_pending_defect_navigation', \"setStatusFilter('all')\", \"setViewMode('defect')\", 'setActiveDefectDetail(defect)', 'pendingFocusRef.current'));"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Viewer project data remains read-only via isMember/canEdit split', has(src.firestore, 'allow read:', 'isMember(projectId)', 'function canEdit(projectId)'));""",
    """check('Viewer project data remains read-only via isMember/canEdit split', has(src.firestore, 'allow read:', 'isMember(projectId)', 'function canEdit(projectId)'));\ncheck('Firestore canonical email role overrides UID alias', has(src.firestore, 'function canonicalMemberActive', 'function canonicalMemberRole', 'hasEmailMember(projectId) ? emailMemberActive(projectId) : uidMemberActive(projectId)'));\ncheck('Storage canonical email role overrides UID alias', has(src.storage, 'function canonicalMemberActive', 'function canonicalMemberRole', 'emailMemberExists(projectId) ? emailMemberActive(projectId) : uidMemberActive(projectId)'));\ncheck('R2 canonical email role is checked before UID', has(src.r2, 'for (const memberId of [email, uid])', \"return { ok: false, role: '' }\"));"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Rules behavior test covers Viewer write denial', has(rulesTest, 'VIEWER cannot write core record'));""",
    """check('Rules behavior test covers Viewer write denial', has(rulesTest, 'VIEWER cannot write core record'));\ncheck('Rules behavior test covers stale UID ADMIN vs canonical VIEWER', has(rulesTest, 'stale UID alias for canonical-precedence regression', \"role: 'ADMIN'\", 'viewerUid'));"""
)

print('RC2.2.8 ASSERTED PATCH COMPLETE')
