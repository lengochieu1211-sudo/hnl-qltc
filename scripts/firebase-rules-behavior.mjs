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
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  deleteObject,
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
  await expectAllowed('ADMIN creates work-volume master definition', () => setDoc(workVolumeRef, {
    id: 'WV-RULE-1', title: 'Trần chìm', floor: 'Tầng 1', category: 'Trần', unit: 'm²',
    planned: 350, actual: 0, unitPrice: 110000, status: 'Chưa thi công',
    revision: 1, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, deletedAt: null,
  }));

  await signIn(editorEmail);
  const editorUid = auth.currentUser.uid;

  await expectAllowed('EDITOR reads work-volume master definition', () => getDoc(workVolumeRef));
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
  await expectAllowed('EDITOR reads trash metadata', () => getDoc(trashRef));
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
  await expectAllowed('ADMIN uploads floor-plan drawing binary', () => uploadBytes(ref(storage, floorStoragePath), new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' }), {
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
  await expectAllowed('EDITOR may soft-delete own crew record', () => updateDoc(crewRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, deletedBy: editorUid,
    revision: 3, updatedAt: crewUpdatedAt + 30,
  }));

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
  const photoSnap = await getDoc(photoMetaRef);
  const photoUpdatedAt = Number(photoSnap.data()?.updatedAt || 0);
  await expectAllowed('EDITOR may soft-delete field photo metadata', () => updateDoc(photoMetaRef, {
    deleted: true, deletedAt: Date.now(), deletedByUid: editorUid, revision: 2, updatedAt: photoUpdatedAt + 10,
  }));
  await expectDenied('EDITOR cannot manage membership', () => setDoc(doc(db, 'projects', pid, 'members', `x-${nonce}@example.test`), {
    email: `x-${nonce}@example.test`, role: 'VIEWER', active: true,
  }));

  const storagePath = `projects/${pid}/media/defect/DF-RULE-1/PHOTO-RULE-1/original.jpg`;
  await expectAllowed('EDITOR uploads project image with bound metadata', () => uploadBytes(ref(storage, storagePath), new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }), {
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
  await expectAllowed('VIEWER reads project/core record', () => getDoc(recordRef));
  await expectAllowed('VIEWER reads shared settings', () => getDoc(sharedSettingsRef));
  await expectAllowed('VIEWER reads trash metadata', () => getDoc(trashRef));
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
  await expectAllowed('ADMIN/owner may purge Storage binary after retention', () => deleteObject(ref(storage, storagePath)));
  await expectAllowed('ADMIN/owner may purge floor-plan Storage binary after retention', () => deleteObject(ref(storage, floorStoragePath)));

  console.log('FIREBASE RULES BEHAVIOR PASS');
} finally {
  await deleteApp(app).catch(() => {});
}
