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
  await createUserWithEmailAndPassword(auth, viewerEmail, password);
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

  await signIn(editorEmail);
  const editorUid = auth.currentUser.uid;
  const recordRef = doc(db, 'projects', pid, 'defects', 'DF-RULE-1');
  await expectAllowed('EDITOR creates core record', () => setDoc(recordRef, {
    id: 'DF-RULE-1', description: 'test', status: 'Mới phát hiện', revision: 1,
    createdAt: Date.now(), updatedAt: Date.now(), createdByUid: editorUid,
    deleted: false, deletedAt: null,
  }));
  const first = await getDoc(recordRef);
  const firstUpdatedAt = Number(first.data()?.updatedAt || 0);
  await expectAllowed('EDITOR monotonic revision update', () => updateDoc(recordRef, {
    description: 'newer', revision: 2, updatedAt: firstUpdatedAt + 10,
  }));
  await expectDenied('stale revision update rejected', () => updateDoc(recordRef, {
    description: 'stale', revision: 1, updatedAt: firstUpdatedAt + 20,
  }));
  await expectDenied('core hard delete rejected', () => deleteDoc(recordRef));
  await expectAllowed('explicit soft-delete tombstone create allowed', () => setDoc(doc(db, 'projects', pid, 'defects', 'DF-TOMBSTONE'), {
    id: 'DF-TOMBSTONE', revision: 1, updatedAt: Date.now(), deleted: true, deletedAt: Date.now(), deletedByUid: editorUid,
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

  await signIn(viewerEmail);
  await expectAllowed('VIEWER reads project/core record', () => getDoc(recordRef));
  await expectDenied('VIEWER cannot write core record', () => updateDoc(recordRef, { description: 'viewer write', revision: 3, updatedAt: Date.now() + 100 }));
  await expectDenied('VIEWER cannot upload Storage file', () => uploadBytes(ref(storage, `projects/${pid}/media/defect/DF-RULE-1/VIEWER/original.jpg`), new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), {
    contentType: 'image/jpeg', customMetadata: { projectId: pid, entityType: 'defect', entityId: 'DF-RULE-1', assetId: 'VIEWER', createdByUid: auth.currentUser.uid },
  }));

  await signIn(ownerEmail);
  await expectDenied('project root hard delete rejected', () => deleteDoc(doc(db, 'projects', pid)));
  await expectAllowed('ADMIN/owner may purge Storage binary after retention', () => deleteObject(ref(storage, storagePath)));

  console.log('FIREBASE RULES BEHAVIOR PASS');
} finally {
  await deleteApp(app).catch(() => {});
}
