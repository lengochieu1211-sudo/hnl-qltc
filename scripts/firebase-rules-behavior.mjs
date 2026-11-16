import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  runTransaction,
  getDocsFromServer,
  collection,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
} from 'firebase/storage';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-hnl-qltc-rules';
const app = initializeApp({
  apiKey: 'demo-key',
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
}, `rules-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectStorageEmulator(storage, '127.0.0.1', 9199);

const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `owner-${nonce}@example.test`;
const editorEmail = `editor-${nonce}@example.test`;
const viewerEmail = `viewer-${nonce}@example.test`;
const password = 'RulesTest-123456!';
const pid = `proj-rules-${nonce}`;

async function expectAllowed(label, fn) {
  try {
    await fn();
    console.log(`PASS allow: ${label}`);
  } catch (err) {
    console.error(`FAIL expected allow: ${label}`, err?.code || err?.message || err);
    throw err;
  }
}

async function expectDenied(label, fn) {
  try {
    await fn();
  } catch (err) {
    const text = String(err?.code || err?.message || err).toLowerCase();
    if (text.includes('permission') || text.includes('unauthorized') || text.includes('storage/unauthorized')) {
      console.log(`PASS deny: ${label}`);
      return;
    }
    console.error(`FAIL unexpected error while expecting deny: ${label}`, err);
    throw err;
  }
  throw new Error(`FAIL expected deny: ${label}`);
}

async function signIn(email) {
  await signOut(auth).catch(() => {});
  return signInWithEmailAndPassword(auth, email, password);
}

try {
  const ownerCred = await createUserWithEmailAndPassword(auth, ownerEmail, password);
  const ownerUid = ownerCred.user.uid;

  // RC2.2.3 regression: a fresh/disposable Emulator has no project root yet.
  // The signed-in owner must be able to probe that missing root without Rules
  // evaluating projectDoc(...).data on null and throwing an evaluation error.
  await expectAllowed('authenticated owner can probe missing project root before first claim', async () => {
    const missing = await getDoc(doc(db, 'projects', pid));
    if (missing.exists()) throw new Error('fresh rules-test project unexpectedly already exists');
  });

  await expectAllowed('owner creates project after missing-root probe', () => setDoc(doc(db, 'projects', pid), {
    id: pid,
    name: 'Rules Project',
    ownerUid,
    ownerEmail,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  await createUserWithEmailAndPassword(auth, editorEmail, password);
  const viewerCred = await createUserWithEmailAndPassword(auth, viewerEmail, password);
  const viewerUid = viewerCred.user.uid;
  await expectDenied('unlisted authenticated user cannot read an existing project root', () => getDoc(doc(db, 'projects', pid)));
  await signIn(ownerEmail);

  await expectAllowed('admin/owner adds canonical EDITOR member', () => setDoc(doc(db, 'projects', pid, 'members', editorEmail), {
    email: editorEmail, role: 'EDITOR', active: true, assignedAt: Date.now(),
  }));
  await expectAllowed('admin/owner adds canonical VIEWER member', () => setDoc(doc(db, 'projects', pid, 'members', viewerEmail), {
    email: viewerEmail, role: 'VIEWER', active: true, assignedAt: Date.now(),
  }));
  await expectDenied('admin cannot write arbitrary member role', () => setDoc(doc(db, 'projects', pid, 'members', `bad-${nonce}@example.test`), {
    email: `bad-${nonce}@example.test`, role: 'SUPERROOT', active: true,
  }));

  const memberContactRef = doc(db, 'projects', pid, 'memberContacts', editorEmail);
  await expectAllowed('ADMIN writes private member contact', () => setDoc(memberContactRef, {
    projectId: pid, email: editorEmail, phone: '0901234567', displayName: 'Editor Test',
    updatedAt: Date.now(), updatedByUid: ownerUid,
  }));
  await expectAllowed('ADMIN reads private member contact', () => getDoc(memberContactRef));

  const sharedSettingsRef = doc(db, 'projects', pid, 'settings', 'shared');
  const trashRef = doc(db, 'projects', pid, 'trash', 'TRASH-RULE-1');
  await expectAllowed('ADMIN creates shared project settings', () => setDoc(sharedSettingsRef, {
    id: 'shared', driveAutoSyncEnabled: false, updatedAt: Date.now(),
  }));
  await expectAllowed('ADMIN creates trash metadata', () => setDoc(trashRef, {
    id: 'TRASH-RULE-1', action: 'DELETE', entityType: 'room', entityId: 'ROOM-X', createdAt: Date.now(),
  }));
  await expectDenied('ADMIN cannot recreate legacy floor-plan Firestore metadata', () => setDoc(doc(db, 'projects', pid, 'floor_plan_images', 'FP-LEGACY-RULE-1'), {
    id: 'FP-LEGACY-RULE-1', projectId: pid, floorPlanId: 'FP-RULE-OLD', updatedAt: Date.now(),
  }));

  const workVolumeRef = doc(db, 'projects', pid, 'work_volumes', 'WV-RULE-1');
  const workVolumeFinancialRef = doc(db, 'projects', pid, 'work_volume_financials', 'WV-RULE-1');
  await expectAllowed('ADMIN creates work-volume master definition without embedded unit price', () => setDoc(workVolumeRef, {
    id: 'WV-RULE-1', title: 'Trần chìm', floor: 'Tầng 1', category: 'Trần', unit: 'm²',
    planned: 350, actual: 0, status: 'Chưa thi công',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectAllowed('ADMIN writes isolated work-volume financial record', () => setDoc(workVolumeFinancialRef, {
    id: 'WV-RULE-1', projectId: pid, workVolumeId: 'WV-RULE-1', unitPrice: 110000, updatedAt: Date.now(),
  }));
  await expectAllowed('ADMIN reads isolated work-volume financial record', () => getDoc(workVolumeFinancialRef));
  await expectAllowed('ADMIN restore may sanitize a legacy work-volume price field with deleteField merge', () => setDoc(workVolumeRef, {
    unitPrice: deleteField(), revision: 2, updatedAt: Date.now() + 1,
  }, { merge: true }));
  await expectDenied('ADMIN cannot embed unitPrice back into shared work-volume document', () => setDoc(doc(db, 'projects', pid, 'work_volumes', 'WV-PRICE-LEAK'), {
    id: 'WV-PRICE-LEAK', title: 'Không được phép', floor: 'Tầng 1', category: 'Trần', unit: 'm²',
    planned: 1, actual: 0, unitPrice: 123456, status: 'Chưa thi công',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));

  // Equipment catalog: ADMIN-only metadata, reversible soft delete, never hard delete.
  const equipmentRef = doc(db, 'projects', pid, 'equipment_catalog', 'EQ-RULE-TEST-1');
  const equipmentFixture = {
    id: 'EQ-RULE-TEST-1', projectId: pid, name: 'Máy cắt kiểm thử', unit: 'Cái',
    category: 'Thiết bị', brand: '', model: '', specifications: '', notes: '',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await expectAllowed('ADMIN creates equipment master', () => setDoc(equipmentRef, equipmentFixture));
  await expectAllowed('ADMIN edits equipment display label without modifying warehouse name', () => updateDoc(equipmentRef, {
    displayName: 'Máy hàn CO₂', revision: 2, updatedAt: Date.now() + 2,
  }));
  await expectDenied('ADMIN cannot change warehouse-identity name directly', () => updateDoc(equipmentRef, {
    name: 'Mã đổi không an toàn', revision: 3, updatedAt: Date.now() + 4,
  }));
  await expectDenied('ADMIN cannot use blank display label', () => updateDoc(equipmentRef, {
    displayName: '', revision: 3, updatedAt: Date.now() + 6,
  }));
  await expectAllowed('ADMIN changes equipment metadata unit with revision', () => updateDoc(equipmentRef, {
    unit: 'Bộ', revision: 3, updatedAt: Date.now() + 10,
  }));
  await expectAllowed('ADMIN soft-deletes equipment identity', () => updateDoc(equipmentRef, {
    deletedAt: Date.now(), deletedByUid: ownerUid, revision: 4, updatedAt: Date.now() + 20,
  }));
  await expectDenied('ADMIN cannot edit trashed equipment metadata', () => updateDoc(equipmentRef, {
    category: 'Đổi trái phép', revision: 5, updatedAt: Date.now() + 30,
  }));
  await expectDenied('ADMIN cannot hard-delete equipment master', () => deleteDoc(equipmentRef));
  await expectAllowed('ADMIN restores equipment by original identity', () => updateDoc(equipmentRef, {
    deletedAt: null, deletedByUid: null, revision: 5, updatedAt: Date.now() + 40,
  }));
  await expectDenied('ADMIN cannot mark deletedAt as unsafe string', () => updateDoc(equipmentRef, {
    deletedAt: 'unsafe', deletedByUid: ownerUid, revision: 6, updatedAt: Date.now() + 50,
  }));
  await expectAllowed('ADMIN assigns equipment manual order without changing inventory', () => updateDoc(equipmentRef, {
    order: 2, revision: 6, updatedAt: Date.now() + 60,
  }));
  await expectDenied('ADMIN cannot assign invalid negative manual order', () => updateDoc(equipmentRef, {
    order: -1, revision: 6, updatedAt: Date.now() + 70,
  }));
  await expectDenied('ADMIN cannot assign fractional manual order', () => updateDoc(equipmentRef, {
    order: 1.5, revision: 6, updatedAt: Date.now() + 80,
  }));

  // One project-scoped draft per material/unit; no stock mutation.
  const orderKey = JSON.stringify(['material','thanh xương','cây']);
  const orderRef = doc(db, 'projects', pid, 'warehouse_order_drafts', encodeURIComponent(orderKey));
  const orderFixture = {
    projectId: pid, itemKey: orderKey, quantity: 24, kgPerUnit: 0.75,
    quantityExpression: '=12*2', kgPerUnitExpression: '', expectedDeliveryDate: '',
    revision: 1, updatedAt: Date.now(), updatedByUid: ownerUid,
  };
  await expectAllowed('ADMIN creates shared order draft without mutating stock', () => setDoc(orderRef, orderFixture));
  await expectAllowed('ADMIN reads shared order draft', () => getDoc(orderRef));
  const orderDateKey = 'hnl-warehouse-order-expected-date';
  const orderDateRef = doc(db, 'projects', pid, 'warehouse_order_drafts', encodeURIComponent(orderDateKey));
  await expectAllowed('ADMIN sets expected delivery date without warehouse ledger write', () => setDoc(orderDateRef, {
    projectId: pid, itemKey: orderDateKey, quantity: 0, kgPerUnit: null,
    quantityExpression: '', kgPerUnitExpression: '', expectedDeliveryDate: '2026-10-30',
    revision: 1, updatedAt: Date.now(), updatedByUid: ownerUid,
  }));
  await expectDenied('ADMIN cannot skip order draft revision', () => updateDoc(orderRef, {
    quantity: 99, revision: 3, updatedByUid: ownerUid,
  }));
  await expectDenied('ADMIN cannot add unrelated order field', () => updateDoc(orderRef, {
    stockBalance: 1000, revision: 2, updatedByUid: ownerUid,
  }));
  await expectDenied('ADMIN cannot hard-delete order draft', () => deleteDoc(orderRef));

  await signIn(editorEmail);
  const editorUid = auth.currentUser.uid;

  await expectAllowed('EDITOR reads shared order draft', () => getDoc(orderRef));
  await expectAllowed('EDITOR reads expected order date', () => getDoc(orderDateRef));
  await expectAllowed('EDITOR updates quantity with next version', () => updateDoc(orderRef, {
    quantity: 30, quantityExpression: '=15*2', revision: 2,
    updatedAt: Date.now(), updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot replace order project identity', () => updateDoc(orderRef, {
    projectId: 'other-project', revision: 3, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot hard-delete shared order draft', () => deleteDoc(orderRef));
  await expectAllowed('EDITOR reads private member contact', () => getDoc(memberContactRef));
  await expectDenied('EDITOR cannot write private member contact', () => setDoc(memberContactRef, {
    projectId: pid, email: editorEmail, phone: '0999999999', displayName: 'Editor Escalation',
    updatedAt: Date.now(), updatedByUid: editorUid,
  }, { merge: true }));

  await signIn(viewerEmail);
  await expectAllowed('VIEWER remains a valid project member', () => getDoc(doc(db, 'projects', pid)));
  await expectAllowed('VIEWER reads shared order draft', () => getDoc(orderRef));
  await expectAllowed('VIEWER reads delivery date', () => getDoc(orderDateRef));
  await expectDenied('VIEWER cannot update order quantity', () => updateDoc(orderRef, {
    quantity: 5, revision: 3, updatedByUid: viewerUid,
  }));
  await expectDenied('VIEWER cannot create order draft', () => setDoc(doc(db,'projects',pid,'warehouse_order_drafts','viewer-draft'), {
    ...orderFixture, itemKey:'viewer-draft', updatedByUid:viewerUid,
  }));

  await expectDenied('VIEWER cannot read private member contact', () => getDoc(memberContactRef));
  await expectDenied('VIEWER cannot write private member contact', () => setDoc(doc(db, 'projects', pid, 'memberContacts', viewerEmail), {
    projectId: pid, email: viewerEmail, phone: '0888888888', displayName: 'Viewer Test',
    updatedAt: Date.now(), updatedByUid: viewerUid,
  }));
  await signIn(editorEmail);

  await expectAllowed('EDITOR may read equipment master', () => getDoc(equipmentRef));
  await expectDenied('EDITOR cannot soft-delete equipment master', () => updateDoc(equipmentRef, {
    deletedAt: Date.now(), deletedByUid: editorUid, revision: 5, updatedAt: Date.now() + 60,
  }));
  await expectDenied('EDITOR cannot reorder equipment master', () => updateDoc(equipmentRef, {
    order: 1, revision: 6, updatedAt: Date.now() + 90,
  }));
  await expectDenied('EDITOR cannot hard-delete equipment master', () => deleteDoc(equipmentRef));
  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));
  await expectDenied('EDITOR cannot read isolated work-volume financial record', () => getDoc(workVolumeFinancialRef));
  await expectDenied('EDITOR cannot create work-volume master definition', () => setDoc(doc(db, 'projects', pid, 'work_volumes', 'WV-RULE-EDITOR'), {
    id: 'WV-RULE-EDITOR', title: 'Editor created', floor: 'Tầng 1', category: 'Trần', unit: 'm²',
    planned: 100, actual: 0, unitPrice: 0, status: 'Chưa thi công', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('EDITOR cannot change work-volume structure', () => updateDoc(workVolumeRef, {
    title: 'Editor renamed', revision: 2, updatedAt: Date.now() + 10,
  }));
  await expectDenied('EDITOR cannot write master actual directly', () => updateDoc(workVolumeRef, {
    actual: 25, status: 'Đang thi công', revision: 2, updatedAt: Date.now() + 20,
  }));

  await expectAllowed('EDITOR reads shared settings', () => getDoc(sharedSettingsRef));
  await expectDenied('EDITOR cannot read protected Trash snapshots', () => getDoc(trashRef));
  await expectDenied('EDITOR cannot mutate shared settings', () => updateDoc(sharedSettingsRef, {
    driveAutoSyncEnabled: true, updatedAt: Date.now() + 30,
  }));
  await expectDenied('EDITOR cannot create shared settings', () => setDoc(doc(db, 'projects', pid, 'settings', 'editor-settings'), {
    id: 'editor-settings', value: true, updatedAt: Date.now(),
  }));
  await expectDenied('EDITOR cannot create trash metadata', () => setDoc(doc(db, 'projects', pid, 'trash', 'TRASH-EDITOR'), {
    id: 'TRASH-EDITOR', action: 'DELETE', entityType: 'room', entityId: 'ROOM-Y', createdAt: Date.now(),
  }));
  await expectDenied('EDITOR cannot delete trash metadata', () => deleteDoc(trashRef));
  await expectDenied('EDITOR cannot create unclassified future project collection', () => setDoc(doc(db, 'projects', pid, 'future_structure', 'FUTURE-EDITOR'), {
    id: 'FUTURE-EDITOR', label: 'must fail closed', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));

  const floorPlanRef = doc(db, 'projects', pid, 'floor_plans', 'FP-RULE-1');
  const roomRef = doc(db, 'projects', pid, 'rooms', 'ROOM-RULE-1');
  await signIn(ownerEmail);
  await expectAllowed('ADMIN creates floor-plan structure', () => setDoc(floorPlanRef, {
    id: 'FP-RULE-1', floorName: 'Tầng 1', order: 0, revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  // P1 O03: a Cloud lock MUST stop stale clients from creating or moving a
  // floor into the group while a two-phase delete is in progress. The deleted
  // group ID remains denied after lock release, until an atomic restore.
  const raceGroupId = 'SG-RACE-TEST';
  const floorRacePayload = (id, structureGroupId) => ({
    id, floorName: 'Tầng kiểm thử', structureGroupId, order: 1,
    revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  });
  await expectAllowed('ADMIN can create floor before group-delete lock', () =>
    setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-RACE-EXISTING'),
      floorRacePayload('FP-RACE-EXISTING', raceGroupId)));
  await expectAllowed('ADMIN acquires delete lock in shared settings', () =>
    updateDoc(sharedSettingsRef, { structureGroupDeleteLocks: { [raceGroupId]: { token: 'RACE-TEST', lockedAt: Date.now() } } }));
  await expectDenied('ADMIN cannot create floor in locked Khu/Khối', () =>
    setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-RACE-LOCKED'),
      floorRacePayload('FP-RACE-LOCKED', raceGroupId)));
  await expectDenied('ADMIN cannot move existing floor into locked Khu/Khối', () =>
    updateDoc(floorPlanRef, { structureGroupId: raceGroupId, revision: 2, updatedAt: Date.now() + 1 }));
  await expectAllowed('ADMIN can still create floor in unlocked Khu/Khối', () =>
    setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-RACE-OTHER'),
      floorRacePayload('FP-RACE-OTHER', 'SG-OTHER-TEST')));
  await expectAllowed('ADMIN closes lock and records deleted group guard atomically', () =>
    updateDoc(sharedSettingsRef, { structureGroupDeleteLocks: {}, structureGroupDeletedIds: [raceGroupId] }));
  await expectDenied('ADMIN cannot resurrect floor in deleted Khu/Khối', () =>
    setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-RACE-STALE'),
      floorRacePayload('FP-RACE-STALE', raceGroupId)));
  await expectAllowed('ADMIN clears deleted-group guard on restore', () =>
    updateDoc(sharedSettingsRef, { structureGroupDeletedIds: [] }));
  await expectAllowed('ADMIN may create floor after original group is restored', () =>
    setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-RACE-RESTORED'),
      floorRacePayload('FP-RACE-RESTORED', raceGroupId)));

  // Real two-user race on two separate Firebase Auth/Firestore clients.
  // A second ADMIN starts a floor write AFTER the delete lock commits.
  // The server must reject that stale-floor write while the first ADMIN
  // reads the complete floor index and deletes the empty Khu/Khối.
  const secondApp = initializeApp({
    apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com`, projectId,
  }, `rules-second-admin-${nonce}`);
  try {
    const secondAuth = getAuth(secondApp);
    const secondDb = getFirestore(secondApp);
    connectAuthEmulator(secondAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(secondDb, '127.0.0.1', 8080);
    const secondEmail = `admin2-${nonce}@example.test`;
    await createUserWithEmailAndPassword(secondAuth, secondEmail, password);
    await expectAllowed('owner grants real second ADMIN for race regression', () =>
      setDoc(doc(db, 'projects', pid, 'members', secondEmail), {
        email: secondEmail, role: 'ADMIN', active: true, assignedAt: Date.now(),
      }));
    const activeGroup = 'SG-TWO-ADMIN';
    const activeStructure = {
      enabled: true, label: 'Khu / Khối',
      groups: [
        { id: 'SG-MAIN', name: 'Khu đang làm', order: 0 },
        { id: activeGroup, name: 'Khu thử xóa', order: 1 },
      ],
      defaultGroupId: 'SG-MAIN',
    };
    await expectAllowed('ADMIN initializes two-group Cloud structure', () =>
      updateDoc(sharedSettingsRef, { structure: activeStructure, trash: { enabled: true, retentionDays: 7 } }));
    const token = 'LOCK-TWO-ADMIN';
    await expectAllowed('first ADMIN locks group before querying floors', () =>
      runTransaction(db, async (tx) => {
        const snap = await tx.get(sharedSettingsRef);
        if (!snap.exists()) throw Error('TWO_ADMIN_SETTINGS_MISSING');
        tx.update(sharedSettingsRef, {
          structureGroupDeleteLocks: { ...(snap.data().structureGroupDeleteLocks || {}),
            [activeGroup]: { token, lockedAt: Date.now() } },
        });
      }));
    const secondFloor = doc(secondDb, 'projects', pid, 'floor_plans', 'FP-TWO-ADMIN-LATE');
    await expectDenied('second ADMIN cannot create a floor after first ADMIN locks group', () =>
      setDoc(secondFloor, floorRacePayload('FP-TWO-ADMIN-LATE', activeGroup)));
    // Real Cloud query follows the lock. The second client's denied row
    // must not appear, and the group removal/Trash receipt commit together.
    const indexed = await getDocsFromServer(collection(db, 'projects', pid, 'floor_plans'));
    await expectAllowed('first ADMIN commits empty-group deletion and receipt atomically', () =>
      runTransaction(db, async (tx) => {
        const settings = await tx.get(sharedSettingsRef);
        if (settings.data()?.structureGroupDeleteLocks?.[activeGroup]?.token !== token) {
          throw Error('TWO_ADMIN_LOCK_LOST');
        }
        const floors = await Promise.all(indexed.docs.map((entry) => tx.get(entry.ref)));
        if (floors.some((item) => item.exists() && item.data()?.structureGroupId === activeGroup)) {
          throw Error('TWO_ADMIN_GROUP_NOT_EMPTY');
        }
        tx.update(sharedSettingsRef, {
          structure: { ...activeStructure, groups: activeStructure.groups.filter((g) => g.id !== activeGroup) },
          structureGroupDeleteLocks: {}, structureGroupDeletedIds: [activeGroup],
        });
        tx.set(doc(db, 'projects', pid, 'trash', 'TRASH-TWO-ADMIN'), {
          id: 'TRASH-TWO-ADMIN', projectId: pid, deletedAt: Date.now(),
          deletedItems: [{ collection: 'structureGroups', entityId: activeGroup }],
        });
      }));
    await expectDenied('second ADMIN cannot recreate deleted group floor after lock release', () =>
      setDoc(secondFloor, floorRacePayload('FP-TWO-ADMIN-LATE', activeGroup)));
    await expectAllowed('first ADMIN restores group and deleted-ID guard together', () =>
      runTransaction(db, async (tx) => {
        const snap = await tx.get(sharedSettingsRef);
        const deletedIds = snap.data()?.structureGroupDeletedIds || [];
        tx.update(sharedSettingsRef, {
          structure: activeStructure,
          structureGroupDeletedIds: deletedIds.filter((id) => id !== activeGroup),
        });
        tx.delete(doc(db, 'projects', pid, 'trash', 'TRASH-TWO-ADMIN'));
      }));
    await expectAllowed('second ADMIN may create floor once original group is restored', () =>
      setDoc(secondFloor, floorRacePayload('FP-TWO-ADMIN-LATE', activeGroup)));
  } finally {
    await deleteApp(secondApp);
  }

  await expectAllowed('ADMIN creates room geometry', () => setDoc(roomRef, {
    id: 'ROOM-RULE-1', floorId: 'FP-RULE-1', roomName: 'Căn 01', floorName: 'Tầng 1', workCategory: 'Trần chìm',
    x: 10, y: 10, width: 20, height: 15, frameStatus: 'Chưa làm', boardStatus: 'Chưa làm',
    workVolume: 50, inspectionStatus: 'Chưa nghiệm thu', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));

  const materialNormRef = doc(db, 'projects', pid, 'material_norms', 'NORM-RULE-1');
  const teamRef = doc(db, 'projects', pid, 'teams', 'TEAM-RULE-1');
  const checklistRef = doc(db, 'projects', pid, 'checklist', 'CHK-RULE-1');
  await expectAllowed('ADMIN creates material norm master structure', () => setDoc(materialNormRef, {
    id: 'NORM-RULE-1', materialName: 'Tấm TC', category: 'Tấm', unit: 'tấm', quotaQuantity: 10,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectAllowed('ADMIN creates team directory structure', () => setDoc(teamRef, {
    id: 'TEAM-RULE-1', name: 'Đội A', leader: 'Anh A', defaultCount: 5,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectAllowed('ADMIN creates checklist definition structure', () => setDoc(checklistRef, {
    id: 'CHK-RULE-1', floorName: 'Tầng 1', category: 'Trần', title: 'Kiểm tra cao độ', status: 'pending',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));

  const floorStoragePath = `projects/${pid}/floor-plans/FP-RULE-1/original.jpg`;
  await expectDenied('ADMIN cannot create new floor-plan binary in legacy Firebase Storage', () => uploadBytes(ref(storage, floorStoragePath), new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg',
    customMetadata: {
      projectId: pid, entityType: 'floorPlan', entityId: 'FP-RULE-1', assetId: 'FP-RULE-1',
      createdByUid: ownerUid, createdAt: String(Date.now()), app: 'HNL QLTC',
    },
  }));

  await signIn(editorEmail);
  await expectAllowed('EDITOR reads floor-plan and room structure', () => Promise.all([getDoc(floorPlanRef), getDoc(roomRef)]));
  await expectDenied('EDITOR cannot create floor-plan structure', () => setDoc(doc(db, 'projects', pid, 'floor_plans', 'FP-EDITOR'), {
    id: 'FP-EDITOR', floorName: 'Editor floor', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('EDITOR cannot replace/rename floor-plan structure', () => updateDoc(floorPlanRef, {
    floorName: 'Editor renamed floor', revision: 2, updatedAt: Date.now() + 10,
  }));
  await expectDenied('EDITOR cannot create room geometry', () => setDoc(doc(db, 'projects', pid, 'rooms', 'ROOM-EDITOR'), {
    id: 'ROOM-EDITOR', floorId: 'FP-RULE-1', roomName: 'Editor room', x: 1, y: 1, width: 10, height: 10,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const roomSnap = await getDoc(roomRef);
  const roomUpdatedAt = Number(roomSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR can update existing room field progress', () => updateDoc(roomRef, {
    inspectionStatus: 'Đạt nghiệm thu', frameStatus: 'Đang làm', revision: 2, updatedAt: roomUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot rename/move/resize room structure', () => updateDoc(roomRef, {
    roomName: 'Editor renamed room', x: 30, width: 25, revision: 3, updatedAt: roomUpdatedAt + 20,
  }));
  await expectDenied('EDITOR cannot soft-delete room structure', () => updateDoc(roomRef, {
    deleted: true, deletedAt: Date.now(), revision: 3, updatedAt: roomUpdatedAt + 30,
  }));

  await expectDenied('EDITOR cannot create material norm master structure', () => setDoc(doc(db, 'projects', pid, 'material_norms', 'NORM-EDITOR'), {
    id: 'NORM-EDITOR', materialName: 'Sai quyền', category: 'Tấm', unit: 'tấm', quotaQuantity: 1,
    revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('EDITOR cannot edit material norm master structure', () => updateDoc(materialNormRef, {
    materialName: 'Editor changed norm', revision: 2, updatedAt: Date.now() + 40,
  }));
  await expectDenied('EDITOR cannot create team directory structure', () => setDoc(doc(db, 'projects', pid, 'teams', 'TEAM-EDITOR'), {
    id: 'TEAM-EDITOR', name: 'Editor team', leader: 'X', defaultCount: 1,
    revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('EDITOR cannot edit team directory structure', () => updateDoc(teamRef, {
    name: 'Editor renamed team', revision: 2, updatedAt: Date.now() + 50,
  }));
  await expectDenied('EDITOR cannot create checklist definition', () => setDoc(doc(db, 'projects', pid, 'checklist', 'CHK-EDITOR'), {
    id: 'CHK-EDITOR', floorName: 'Tầng 1', category: 'Trần', title: 'Editor criterion', status: 'pending',
    revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const checklistSnap = await getDoc(checklistRef);
  const checklistUpdatedAt = Number(checklistSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR can update checklist inspection status', () => updateDoc(checklistRef, {
    status: 'passed', notes: 'Đã kiểm tra', inspectedBy: 'Editor', inspectedAt: new Date().toISOString(),
    revision: 2, updatedAt: checklistUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot alter checklist definition', () => updateDoc(checklistRef, {
    title: 'Editor renamed criterion', dueDate: '2026-12-31', revision: 3, updatedAt: checklistUpdatedAt + 20,
  }));
  await expectDenied('EDITOR cannot replace floor-plan drawing binary', () => uploadBytes(ref(storage, floorStoragePath), new Blob([new Uint8Array([1, 1, 1])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg',
    customMetadata: {
      projectId: pid, entityType: 'floorPlan', entityId: 'FP-RULE-1', assetId: 'FP-RULE-1',
      createdByUid: ownerUid, createdAt: String(Date.now()), app: 'HNL QLTC',
    },
  }));

  const recordRef = doc(db, 'projects', pid, 'defects', 'DF-RULE-1');
  await expectAllowed('EDITOR creates defect operational record', () => setDoc(recordRef, {
    id: 'DF-RULE-1', description: 'test', status: 'Mới phát hiện', revision: 1,
    createdAt: Date.now(), updatedAt: Date.now(), createdByUid: editorUid,
    deleted: false, deletedAt: null,
  }));
  const first = await getDoc(recordRef);
  const firstUpdatedAt = Number(first.data()?.updatedAt || 0);
  await expectAllowed('EDITOR defect operational update is monotonic', () => updateDoc(recordRef, {
    description: 'newer', status: 'Đang xử lý', revision: 2, updatedAt: firstUpdatedAt + 10,
  }));
  await expectDenied('stale revision update rejected', () => updateDoc(recordRef, {
    description: 'stale', revision: 1, updatedAt: firstUpdatedAt + 20,
  }));
  await expectDenied('EDITOR cannot soft-delete defect business record', () => updateDoc(recordRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, revision: 3, updatedAt: firstUpdatedAt + 30,
  }));
  await expectDenied('EDITOR cannot create defect tombstone to bypass delete gate', () => setDoc(doc(db, 'projects', pid, 'defects', 'DF-TOMBSTONE'), {
    id: 'DF-TOMBSTONE', revision: 1, updatedAt: Date.now(), deleted: true, deletedAt: Date.now(), deletedByUid: editorUid,
  }));
  await expectDenied('core hard delete rejected', () => deleteDoc(recordRef));
  // Two authenticated accounts read the same canonical Cloud lock; localStorage is
  // intentionally absent from this test. Transaction only writes lock + lifecycle.
  await expectAllowed('EDITOR locks Defect with monotonic Cloud revision', () => runTransaction(db, async (tx) => {
    const snap = await tx.get(recordRef);
    const row = snap.data();
    if (row.positionLocked === true) throw new Error('DEFECT_LOCK_ALREADY_TRUE');
    tx.update(recordRef, {
      positionLocked: true, revision: Number(row.revision || 0) + 1,
      updatedAt: Math.max(Date.now(), Number(row.updatedAt || 0) + 1),
      updatedByUid: editorUid,
    });
  }));
  await signIn(viewerEmail);
  await expectAllowed('VIEWER sees EDITOR Defect lock on another account', async () => {
    const snap = await getDoc(recordRef);
    if (snap.data()?.positionLocked !== true) throw new Error('VIEWER_DEFECT_LOCK_NOT_SHARED');
  });
  await expectDenied('VIEWER cannot unlock Defect Cloud flag', () => updateDoc(recordRef, {
    positionLocked: false, revision: 4, updatedAt: Date.now() + 1000, updatedByUid: viewerUid,
  }));
  await signIn(editorEmail);


  const inventoryRef = doc(db, 'projects', pid, 'inventory', 'INV-RULE-1');
  await expectAllowed('EDITOR creates warehouse operational record', () => setDoc(inventoryRef, {
    id: 'INV-RULE-1', materialName: 'Tấm TC', type: 'IN', quantity: 10, unit: 'tấm',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const invSnap = await getDoc(inventoryRef);
  const invUpdatedAt = Number(invSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR updates warehouse operational record', () => updateDoc(inventoryRef, {
    quantity: 12, revision: 2, updatedAt: invUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot soft-delete warehouse business record', () => updateDoc(inventoryRef, {
    deleted: true, deletedAt: Date.now(), revision: 3, updatedAt: invUpdatedAt + 20,
  }));

  // P1-07: balance identity and provenance guards. These fixtures are separate
  // from the warehouse ledger: full voucher-delta validation is still pending.
  const balanceRef = doc(db, 'projects', pid, 'inventory_balances', 'BAL-RULE-1');
  const balanceNow = Date.now();
  const balanceSeed = {
    id: 'BAL-RULE-1', projectId: pid, itemKind: 'material', materialId: 'MAT-RULE-1',
    materialName: 'Tấm TC', unit: 'tấm', onHand: 10, revision: 1,
    updatedAt: balanceNow, updatedByUid: editorUid,
  };
  await expectAllowed('EDITOR can create valid derived balance metadata', () => setDoc(balanceRef, balanceSeed));
  await expectDenied('EDITOR cannot impersonate owner in new balance metadata', () => setDoc(doc(db, 'projects', pid, 'inventory_balances', 'BAL-SPOOF-UID'), {
    ...balanceSeed, id: 'BAL-SPOOF-UID', updatedByUid: ownerUid,
  }));
  await expectDenied('EDITOR cannot create balance migration tombstone', () => setDoc(doc(db, 'projects', pid, 'inventory_balances', 'BAL-SPOOF-RENAME'), {
    ...balanceSeed, id: 'BAL-SPOOF-RENAME', renamedTo: 'another-key', renamedToUnit: 'hộp',
  }));
  await expectDenied('EDITOR cannot create balance with spoofed revision', () => setDoc(doc(db, 'projects', pid, 'inventory_balances', 'BAL-SPOOF-REV'), {
    ...balanceSeed, id: 'BAL-SPOOF-REV', revision: 300,
  }));
  await expectAllowed('EDITOR may update stock balance while retaining metadata', () => updateDoc(balanceRef, {
    onHand: 11, revision: 2, updatedAt: balanceNow + 1, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot swap balance materialId', () => updateDoc(balanceRef, {
    materialId: 'MAT-OTHER', onHand: 11, revision: 3, updatedAt: balanceNow + 2, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot change balance material name and unit', () => updateDoc(balanceRef, {
    materialName: 'Tấm giả', unit: 'thùng', revision: 3, updatedAt: balanceNow + 2, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot forge balance updater', () => updateDoc(balanceRef, {
    onHand: 12, revision: 3, updatedAt: balanceNow + 2, updatedByUid: ownerUid,
  }));
  await expectDenied('EDITOR cannot jump balance revision', () => updateDoc(balanceRef, {
    onHand: 12, revision: 99, updatedAt: balanceNow + 2, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot write migration tombstone on an existing balance', () => updateDoc(balanceRef, {
    renamedTo: 'another-key', revision: 3, updatedAt: balanceNow + 2, updatedByUid: editorUid,
  }));
  await signIn(ownerEmail);
  const beforeRoomLock = await getDoc(roomRef);
  await expectAllowed('ADMIN atomically locks Room without changing geometry', () => runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const row = snap.data();
    if (row.positionLocked === true) throw new Error('ROOM_LOCK_ALREADY_TRUE');
    tx.update(roomRef, {
      positionLocked: true, revision: Number(row.revision || 0) + 1,
      updatedAt: Math.max(Date.now(), Number(row.updatedAt || 0) + 1),
      updatedByUid: ownerUid,
    });
  }));
  await signIn(viewerEmail);
  await expectAllowed('VIEWER sees Room lock and unchanged room geometry on other account', async () => {
    const snap = await getDoc(roomRef);
    if (snap.data()?.positionLocked !== true || snap.data()?.x !== beforeRoomLock.data()?.x
      || snap.data()?.width !== beforeRoomLock.data()?.width) throw new Error('ROOM_LOCK_PARITY_OR_GEOMETRY');
  });
  await expectDenied('VIEWER cannot unlock Room Cloud flag', () => updateDoc(roomRef, {
    positionLocked: false, revision: 4, updatedAt: Date.now() + 1000, updatedByUid: viewerUid,
  }));
  await signIn(ownerEmail);
  await expectAllowed('ADMIN retains atomic unit migration metadata permission', () => updateDoc(balanceRef, {
    unit: 'thùng', renamedTo: 'renamed-balance', renamedToUnit: 'thùng',
    revision: 3, updatedAt: balanceNow + 2, updatedByUid: ownerUid,
  }));
  const legacyBalanceRef = doc(db, 'projects', pid, 'inventory_balances', 'BAL-LEGACY-RULE-1');
  await expectAllowed('ADMIN seeds legacy balance without a materialId', () => setDoc(legacyBalanceRef, {
    ...balanceSeed, id: 'BAL-LEGACY-RULE-1', itemKind: 'material', materialId: null, updatedByUid: ownerUid,
  }));
  await signIn(editorEmail);
  await expectAllowed('EDITOR may fill missing legacy materialId during transaction', () => updateDoc(legacyBalanceRef, {
    materialId: 'MAT-RULE-1', onHand: 11, revision: 2, updatedAt: balanceNow + 1, updatedByUid: editorUid,
  }));
  await signIn(viewerEmail);
  await expectDenied('VIEWER cannot forge derived warehouse balance', () => updateDoc(legacyBalanceRef, {
    onHand: 999, revision: 3, updatedAt: balanceNow + 2, updatedByUid: viewerUid,
  }));
  await signIn(editorEmail);

  const crewRef = doc(db, 'projects', pid, 'crew_records', 'CREW-RULE-1');
  await expectDenied('EDITOR cannot create crew record without creator identity', () => setDoc(doc(db, 'projects', pid, 'crew_records', 'CREW-NO-OWNER'), {
    id: 'CREW-NO-OWNER', date: '2026-08-27', teamName: 'Đội A', workerCount: 5,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectAllowed('EDITOR creates crew operational record bound to own uid', () => setDoc(crewRef, {
    id: 'CREW-RULE-1', date: '2026-08-27', teamName: 'Đội A', workerCount: 5,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), createdByUid: editorUid,
    deleted: false, deletedAt: null,
  }));
  const crewSnap = await getDoc(crewRef);
  const crewUpdatedAt = Number(crewSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR updates crew operational record', () => updateDoc(crewRef, {
    workerCount: 6, notes: 'Tăng ca', revision: 2, updatedAt: crewUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot rewrite crew creator identity', () => updateDoc(crewRef, {
    createdByUid: ownerUid, revision: 3, updatedAt: crewUpdatedAt + 20,
  }));
  const crewDeletedAt = Date.now();
  await expectAllowed('EDITOR may soft-delete own crew record', () => updateDoc(crewRef, {
    deleted: true, deletedAt: crewDeletedAt, deletedByUid: editorUid, deletedBy: editorUid,
    revision: 3, updatedAt: crewUpdatedAt + 30,
  }));
  const ownCrewReceiptRef = doc(db, 'projects', pid, 'trash', 'TRASH-EDITOR-OWN-CREW');
  const ownCrewReceipt = {
    id: 'TRASH-EDITOR-OWN-CREW', projectId: pid, deletedAt: crewDeletedAt,
    expiresAt: crewDeletedAt + 7 * 86400000, retentionDays: 7,
    deletedByUid: editorUid, deletedByEmail: editorEmail,
    deletedByName: 'Editor Test', approxBytes: 125,
    deletedItems: [{ collection: 'crewRecords', entityId: 'CREW-RULE-1',
      label: 'Quân số / nhật ký: Đội A', snapshot: { id: 'CREW-RULE-1', createdByUid: editorUid } }],
    relatedBefore: {},
  };
  await expectAllowed('EDITOR saves own crew Trash receipt after tombstone', () => setDoc(ownCrewReceiptRef, ownCrewReceipt));
  await expectAllowed('EDITOR can retry the same immutable crew Trash receipt', () => setDoc(ownCrewReceiptRef, ownCrewReceipt));
  await expectDenied('EDITOR cannot read protected own crew receipt', () => getDoc(ownCrewReceiptRef));
  await expectDenied('EDITOR cannot forge another crew Trash receipt', () => setDoc(doc(db, 'projects', pid, 'trash', 'TRASH-EDITOR-FORGED'), {
    ...ownCrewReceipt, id: 'TRASH-EDITOR-FORGED',
    deletedItems: [{ collection: 'crewRecords', entityId: 'CREW-RULE-1',
      label: 'Ngụy tạo', snapshot: { id: 'CREW-RULE-1', createdByUid: ownerUid } }],
  }));
  await expectDenied('EDITOR cannot mutate an own crew Trash receipt', () => updateDoc(ownCrewReceiptRef, { deletedAt: crewDeletedAt + 100 }));

  await signIn(ownerEmail);
  const ownerCrewRef = doc(db, 'projects', pid, 'crew_records', 'CREW-OWNER-RULE-1');
  await expectAllowed('ADMIN creates crew record owned by admin', () => setDoc(ownerCrewRef, {
    id: 'CREW-OWNER-RULE-1', date: '2026-08-27', teamName: 'Đội Chủ đầu tư', workerCount: 3,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), createdByUid: ownerUid,
    deleted: false, deletedAt: null,
  }));
  const ownerCrewSnap = await getDoc(ownerCrewRef);
  const ownerCrewUpdatedAt = Number(ownerCrewSnap.data()?.updatedAt || 0);

  // Legacy crew rows may predate createdByUid. ADMIN can keep those rows, but an
  // EDITOR must never be able to add their own creator id later and then delete it.
  const legacyCrewRef = doc(db, 'projects', pid, 'crew_records', 'CREW-LEGACY-RULE-1');
  await expectAllowed('ADMIN creates legacy crew fixture without creator uid', () => setDoc(legacyCrewRef, {
    id: 'CREW-LEGACY-RULE-1', date: '2026-08-26', teamName: 'Đội Legacy', workerCount: 2,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const legacyCrewSnap = await getDoc(legacyCrewRef);
  const legacyCrewUpdatedAt = Number(legacyCrewSnap.data()?.updatedAt || 0);

  await signIn(editorEmail);
  await expectDenied('EDITOR cannot soft-delete another user crew record', () => updateDoc(ownerCrewRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, deletedBy: editorUid,
    revision: 2, updatedAt: ownerCrewUpdatedAt + 10,
  }));
  await expectAllowed('EDITOR may operationally edit legacy crew without claiming ownership', () => updateDoc(legacyCrewRef, {
    workerCount: 3, revision: 2, updatedAt: legacyCrewUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot claim legacy crew creator identity', () => updateDoc(legacyCrewRef, {
    createdByUid: editorUid, revision: 3, updatedAt: legacyCrewUpdatedAt + 20,
  }));
  await expectDenied('EDITOR cannot soft-delete legacy crew without creator identity', () => updateDoc(legacyCrewRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, deletedBy: editorUid,
    revision: 3, updatedAt: legacyCrewUpdatedAt + 30,
  }));

  const photoMetaRef = doc(db, 'projects', pid, 'photos', 'PHOTO-META-RULE-1');
  await expectAllowed('EDITOR creates field photo metadata', () => setDoc(photoMetaRef, {
    id: 'PHOTO-META-RULE-1', entityType: 'defect', entityId: 'DF-RULE-1', fileName: 'a.jpg',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('EDITOR cannot create a photo with foreign project pointer', () => setDoc(doc(db, 'projects', pid, 'photos', 'PHOTO-META-SPOOF-CREATE'), {
    id: 'PHOTO-META-SPOOF-CREATE', entityType: 'defect', entityId: 'DF-RULE-1', projectId: 'other-project',
    storageProvider: 'r2', storagePath: 'projects/other-project/media/defect/DF-RULE-1/PHOTO-META-SPOOF-CREATE/original.jpg',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const immutableSuffix = 'a'.repeat(64);
  const immutableCreatePath = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-IMMUTABLE-CREATE--${immutableSuffix}/original.jpg`;
  await expectAllowed('EDITOR may publish a new immutable content-addressed R2 photo', () => setDoc(doc(db, 'projects', pid, 'photos', 'PHOTO-IMMUTABLE-CREATE'), {
    id: 'PHOTO-IMMUTABLE-CREATE', projectId: pid, entityType: 'defect', entityId: 'DF-RULE-1',
    storageProvider: 'r2', storagePath: immutableCreatePath, cloudFileId: `r2:${immutableCreatePath}`,
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  const photoSnap = await getDoc(photoMetaRef);
  const photoUpdatedAt = Number(photoSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR can annotate a photo without changing linked identity', () => updateDoc(photoMetaRef, {
    caption: 'Đã kiểm tra thực tế', revision: 2, updatedAt: photoUpdatedAt + 1, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot relink a photo to a different defect', () => updateDoc(photoMetaRef, {
    entityId: 'DF-OTHER', revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  await expectDenied('EDITOR cannot change a photo project identity', () => updateDoc(photoMetaRef, {
    projectId: 'other-project', revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  await expectDenied('EDITOR cannot forge existing photo creator timestamp', () => updateDoc(photoMetaRef, {
    createdAt: 1, revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  await expectDenied('EDITOR cannot spoof actor identity on existing photo', () => updateDoc(photoMetaRef, {
    updatedByUid: ownerUid, revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  const validR2Path = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-META-RULE-1/original.jpg`;
  const validThumb = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-META-RULE-1/thumb.jpg`;
  await expectDenied('EDITOR cannot spoof a cross-project R2 media pointer', () => updateDoc(photoMetaRef, {
    storageProvider: 'r2', storagePath: 'projects/other-project/media/defect/DF-RULE-1/PHOTO-META-RULE-1/original.jpg',
    revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  await expectDenied('EDITOR cannot point to another photo assetId', () => updateDoc(photoMetaRef, {
    projectId: pid, storageProvider: 'r2', storagePath: `projects/${pid}/media/defect/DF-RULE-1/ANOTHER-PHOTO/original.jpg`,
    revision: 3, updatedAt: photoUpdatedAt + 2,
  }));
  await expectAllowed('EDITOR can publish an authenticated R2 photo replacement pointer', () => updateDoc(photoMetaRef, {
    projectId: pid, storageProvider: 'r2', storagePath: validR2Path, thumbnailPath: validThumb,
    cloudFileId: `r2:${validR2Path}`, cloudUrl: `r2:${validR2Path}`,
    revision: 3, updatedAt: photoUpdatedAt + 3, updatedByUid: editorUid,
  }));
  await expectDenied('EDITOR cannot swap only the displayed R2 URL to another object', () => updateDoc(photoMetaRef, {
    cloudFileId: 'r2:projects/other-project/secret.jpg', revision: 4, updatedAt: photoUpdatedAt + 4,
  }));
  const immutableReplacementPath = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-META-RULE-1--${immutableSuffix}/original.jpg`;
  await expectAllowed('EDITOR can replace photo pointer with content-addressed R2 object', () => updateDoc(photoMetaRef, {
    storagePath: immutableReplacementPath, cloudFileId: `r2:${immutableReplacementPath}`,
    cloudUrl: `r2:${immutableReplacementPath}`, revision: 4, updatedAt: photoUpdatedAt + 5,
  }));
  await expectAllowed('EDITOR may soft-delete field photo metadata', () => updateDoc(photoMetaRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, revision: 5, updatedAt: photoUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot silently undelete a photo they already removed', () => updateDoc(photoMetaRef, {
    deleted: false, deletedAt: null, revision: 6, updatedAt: photoUpdatedAt + 20,
  }));
  await expectDenied('EDITOR cannot manage membership', () => setDoc(doc(db, 'projects', pid, 'members', `x-${nonce}@example.test`), {
    email: `x-${nonce}@example.test`, role: 'VIEWER', active: true,
  }));

  const storagePath = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-RULE-1/original.jpg`;
  await expectDenied('EDITOR cannot create new project image in legacy Firebase Storage', () => uploadBytes(ref(storage, storagePath), new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg',
    customMetadata: {
      projectId: pid, entityType: 'defect', entityId: 'DF-RULE-1', assetId: 'PHOTO-RULE-1',
      createdByUid: editorUid, createdAt: String(Date.now()), app: 'HNL QLTC',
    },
  }));
  await expectDenied('EDITOR cannot forge storage project metadata', () => uploadBytes(ref(storage, `projects/${pid}/media/defect/DF-RULE-1/BAD/original.jpg`), new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg', customMetadata: { projectId: 'other-project', entityType: 'defect', entityId: 'DF-RULE-1', assetId: 'BAD', createdByUid: editorUid },
  }));

  // Regression: a stale UID ADMIN alias must never override canonical email VIEWER.
  await signIn(ownerEmail);
  await expectAllowed('ADMIN may create stale UID alias for canonical-precedence regression', () => setDoc(doc(db, 'projects', pid, 'members', viewerUid), {
    uid: viewerUid, email: viewerEmail, role: 'ADMIN', active: true, assignedAt: Date.now(), updatedAt: Date.now(),
  }));

  await signIn(viewerEmail);
  await expectAllowed('VIEWER may read equipment master', () => getDoc(equipmentRef));
  await expectDenied('VIEWER cannot restore or delete equipment master', () => updateDoc(equipmentRef, {
    deletedAt: Date.now(), deletedByUid: viewerUid, revision: 5, updatedAt: Date.now() + 70,
  }));
  await expectAllowed('VIEWER reads project/core record', () => getDoc(recordRef));
  await expectDenied('VIEWER cannot read isolated work-volume financial record', () => getDoc(workVolumeFinancialRef));
  await expectAllowed('VIEWER reads shared settings', () => getDoc(sharedSettingsRef));
  await expectDenied('VIEWER cannot read protected Trash snapshots', () => getDoc(trashRef));
  await expectDenied('VIEWER cannot mutate shared settings', () => updateDoc(sharedSettingsRef, { driveAutoSyncEnabled: true, updatedAt: Date.now() + 300 }));
  await expectDenied('VIEWER cannot write core record', () => updateDoc(recordRef, { description: 'viewer write', revision: 3, updatedAt: Date.now() + 100 }));
  await expectDenied('VIEWER cannot create defect operational record', () => setDoc(doc(db, 'projects', pid, 'defects', 'DF-VIEWER'), {
    id: 'DF-VIEWER', description: 'viewer', status: 'Mới phát hiện', revision: 1, updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));
  await expectDenied('VIEWER cannot change checklist inspection status', () => updateDoc(checklistRef, {
    status: 'defect', revision: 3, updatedAt: Date.now() + 200,
  }));
  await expectDenied('VIEWER cannot upload Storage file', () => uploadBytes(ref(storage, `projects/${pid}/media/defect/DF-RULE-1/VIEWER/original.jpg`), new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg', customMetadata: { projectId: pid, entityType: 'defect', entityId: 'DF-RULE-1', assetId: 'VIEWER', createdByUid: auth.currentUser.uid },
  }));

  await signIn(ownerEmail);
  await expectAllowed('ADMIN updates shared settings', () => updateDoc(sharedSettingsRef, { driveAutoSyncEnabled: true, updatedAt: Date.now() + 400 }));
  await expectAllowed('ADMIN purges non-core trash metadata', () => deleteDoc(trashRef));
  await expectDenied('project root hard delete rejected', () => deleteDoc(doc(db, 'projects', pid)));
  await expectDenied('ADMIN cannot create new project image in legacy Firebase Storage', () => uploadBytes(ref(storage, storagePath), new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg', customMetadata: { projectId: pid, entityType: 'defect', entityId: 'DF-RULE-1', assetId: 'PHOTO-RULE-1', createdByUid: ownerUid },
  }));

  // Deletion Undo must advance the *server* revision rather than reuse the delete revision.
  // Exercise all 8 generic Cloud business collections on disposable Auth/Firestore emulators.
  const undoCoreCollections = ['rooms', 'floor_plans', 'defects', 'crew_records',
    'work_volumes', 'material_norms', 'checklist', 'teams'];
  for (const cloudCollection of undoCoreCollections) {
    const recordId = 'UNDO-' + cloudCollection.replace(/_/g, '-');
    const undoRef = doc(db, 'projects', pid, cloudCollection, recordId);
    const base = Date.now() + 5000;
    await expectAllowed('undo ' + cloudCollection + ': create source record', () => setDoc(undoRef, {
      id: recordId, description: 'Synthetic Undo fixture', revision: 1,
      createdAt: base, updatedAt: base, deleted: false, deletedAt: null,
    }));
    await expectAllowed('undo ' + cloudCollection + ': write server tombstone', () => updateDoc(undoRef, {
      deleted: true, deletedAt: base + 1, deletedByUid: ownerUid,
      revision: 2, updatedAt: base + 1, updatedByUid: ownerUid,
    }));
    await expectDenied('undo ' + cloudCollection + ': stale revision cannot resurrect', () => updateDoc(undoRef, {
      deleted: false, deletedAt: null, revision: 2, updatedAt: base + 2,
    }));
    await expectAllowed('undo ' + cloudCollection + ': verified transaction restores at revision 3', () =>
      runTransaction(db, async (tx) => {
        const current = await tx.get(undoRef);
        if (!current.exists() || current.data().deleted !== true
          || current.data().deletedByUid !== ownerUid || current.data().deletedAt !== base + 1) {
          throw new Error('UNDO_EMULATOR_TOMBSTONE_CONFLICT');
        }
        tx.update(undoRef, {
          deleted: false, deletedAt: null, deletedByUid: null,
          revision: current.data().revision + 1,
          updatedAt: Math.max(Date.now(), current.data().updatedAt + 1),
          updatedByUid: ownerUid,
        });
      }));
    const restored = await getDoc(undoRef);
    if (restored.data().deleted !== false || restored.data().revision !== 3) {
      throw new Error('UNDO_EMULATOR_RESTORE_NOT_DURABLE:' + cloudCollection);
    }
  }
  await signIn(viewerEmail);
  for (const cloudCollection of undoCoreCollections) {
    const recordId = 'UNDO-' + cloudCollection.replace(/_/g, '-');
    const row = await getDoc(doc(db, 'projects', pid, cloudCollection, recordId));
    if (!row.exists() || row.data().deleted !== false || row.data().revision !== 3) {
      throw new Error('UNDO_EMULATOR_OTHER_ACCOUNT_CANNOT_SEE_RESTORE:' + cloudCollection);
    }
  }
  await signIn(ownerEmail);
  // Redo must also advance revision; then a second Undo may restore again.
  // Two authenticated client sessions read the final Cloud state, never localStorage.
  for (const cloudCollection of undoCoreCollections) {
    const recordId = 'UNDO-' + cloudCollection.replace(/_/g, '-');
    const undoRef = doc(db, 'projects', pid, cloudCollection, recordId);
    const deletedAt = Date.now() + 300;
    await expectAllowed('redo ' + cloudCollection + ': transaction deletes at next revision', () =>
      runTransaction(db, async (tx) => {
        const current = await tx.get(undoRef);
        if (!current.exists() || current.data().revision !== 3 || current.data().deleted !== false) {
          throw new Error('REDO_EMULATOR_ACTIVE_REVISION_CONFLICT');
        }
        tx.update(undoRef, {
          deleted: true, deletedAt, deletedByUid: ownerUid,
          revision: current.data().revision + 1,
          updatedAt: Math.max(Date.now(), current.data().updatedAt + 1),
          updatedByUid: ownerUid,
        });
      }));
    await expectDenied('redo ' + cloudCollection + ': stale second Undo rejected', () => updateDoc(undoRef, {
      deleted: false, deletedAt: null, revision: 4, updatedAt: Date.now() + 500,
    }));
    await expectAllowed('redo ' + cloudCollection + ': next Undo revision 5', () =>
      runTransaction(db, async (tx) => {
        const current = await tx.get(undoRef);
        if (!current.exists() || current.data().revision !== 4 || current.data().deletedAt !== deletedAt) {
          throw new Error('UNDO_AFTER_REDO_TOMBSTONE_CONFLICT');
        }
        tx.update(undoRef, {
          deleted: false, deletedAt: null, deletedByUid: null,
          revision: current.data().revision + 1,
          updatedAt: Math.max(Date.now(), current.data().updatedAt + 1),
          updatedByUid: ownerUid,
        });
      }));
  }
  await signIn(viewerEmail);
  for (const cloudCollection of undoCoreCollections) {
    const recordId = 'UNDO-' + cloudCollection.replace(/_/g, '-');
    const row = await getDoc(doc(db, 'projects', pid, cloudCollection, recordId));
    if (!row.exists() || row.data().deleted !== false || row.data().revision !== 5) {
      throw new Error('UNDO_REDO_UNDO_SECOND_ACCOUNT_CANNOT_SEE_RESTORE:' + cloudCollection);
    }
  }
  await signIn(ownerEmail);
  console.log('UNDO_8_CORE_COLLECTIONS_2_ACCOUNTS_EMULATOR_PASS');

  // Revocation must remain fail-closed even when a stale UID alias still grants ADMIN.
  await expectAllowed('ADMIN creates stale EDITOR UID alias before canonical revocation regression', () => setDoc(doc(db, 'projects', pid, 'members', editorUid), {
    uid: editorUid, email: editorEmail, role: 'ADMIN', active: true, assignedAt: Date.now(), updatedAt: Date.now(),
  }));
  await expectAllowed('ADMIN tombstones canonical EDITOR membership', () => updateDoc(doc(db, 'projects', pid, 'members', editorEmail), {
    role: 'VIEWER', active: false, revokedAt: Date.now(), updatedAt: Date.now(),
  }));
  await signIn(editorEmail);
  await expectDenied('revoked canonical EDITOR cannot fall back to stale UID ADMIN alias', () => getDoc(recordRef));

  // Soft-deleted projects are frozen: root remains restorable by ADMIN, all business access stops.
  await signIn(ownerEmail);
  await expectAllowed('ADMIN soft-deletes project root for frozen-project regression', () => updateDoc(doc(db, 'projects', pid), {
    deleted: true, deletedAt: Date.now(), trashRetentionDays: 7, trashExpiresAt: Date.now() + 7 * 86400000, updatedAt: Date.now(),
  }));
  await expectAllowed('ADMIN may still read deleted project root for restore', () => getDoc(doc(db, 'projects', pid)));
  await expectDenied('ADMIN cannot operate business subcollections while project is deleted', () => getDoc(workVolumeFinancialRef));
  await signIn(viewerEmail);
  await expectDenied('VIEWER cannot read business records from deleted project', () => getDoc(recordRef));

  console.log('FIREBASE RULES BEHAVIOR PASS');
} finally {
  await deleteApp(app).catch(() => {});
}
