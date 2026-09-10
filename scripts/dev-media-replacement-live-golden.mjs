import crypto from 'node:crypto';
import fs from 'node:fs';
import { initializeApp as initializeAdminApp, applicationDefault, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

const devProjectId = required('DEV_PROJECT_ID');
const hostingUrl = required('DEV_HOSTING_URL').replace(/\/+$/, '');
const r2Url = required('DEV_R2_URL').replace(/\/+$/, '');
const serviceAccountPath = required('GOOGLE_APPLICATION_CREDENTIALS');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (devProjectId !== 'hnl-qltc-dev') throw new Error(`REFUSING: unexpected DEV project ${devProjectId}`);
if (/com-example-qlct-61329/i.test(devProjectId)) throw new Error('REFUSING: PROD Firebase project');
if (!/-dev\./i.test(r2Url)) throw new Error(`REFUSING: non-DEV R2 URL ${r2Url}`);

const config = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};
if (config.projectId !== devProjectId) throw new Error(`REFUSING: SDK project mismatch ${config.projectId}`);

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const nonce = `${runId}-${Math.random().toString(36).slice(2, 10)}`;
const pid = `dev-media-replace-${nonce}`;
const defectId = `DEF-${nonce}`;
const photoId = `PHOTO-${nonce}`;
const logicalAssetId = photoId;
const adminUid = `dev-media-admin-${nonce}`;
const editorUid = `dev-media-editor-${nonce}`;
const viewerUid = `dev-media-viewer-${nonce}`;
const adminEmail = `${adminUid}@example.test`;
const editorEmail = `${editorUid}@example.test`;
const viewerEmail = `${viewerUid}@example.test`;
const now = Date.now();

const passLines = [];
const pass = (name, detail = '') => {
  const line = `PASS MEDIA REPLACE LIVE: ${name}${detail ? ` — ${detail}` : ''}`;
  passLines.push(line);
  console.log(line);
};
const b64url = (value) => Buffer.from(value).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function mintCustomToken(uid, email) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: issuedAt,
    exp: issuedAt + 3600,
    uid,
    claims: { email, email_verified: true, hnlDevMediaReplacementGolden: true },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function createIdentity(kind, uid, email) {
  const app = initializeApp(config, `dev-media-replace-${kind}-${nonce}`);
  const auth = getAuth(app);
  await signInWithCustomToken(auth, mintCustomToken(uid, email));
  if (!auth.currentUser) throw new Error(`${kind} auth user missing`);
  return { kind, uid, email, app, auth, db: getFirestore(app), idToken: await auth.currentUser.getIdToken(true) };
}

function r2Endpoint(storagePath) {
  return `${r2Url}/v1/object?key=${encodeURIComponent(storagePath)}`;
}

async function requireStatus(label, response, expected) {
  if (response.status !== expected) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${label}: expected HTTP ${expected}, got ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response;
}

async function putR2(identity, storagePath, payload, assetId, expectedSha) {
  const metadata = encodeURIComponent(JSON.stringify({
    projectId: pid,
    entityType: 'defect',
    entityId: defectId,
    assetId,
    createdByUid: identity.uid,
    createdAt: String(Date.now()),
    app: 'HNL QLTC',
  }));
  const response = await requireStatus(`PUT ${assetId}`, await fetch(r2Endpoint(storagePath), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${identity.idToken}`,
      Origin: hostingUrl,
      'Content-Type': 'image/jpeg',
      'X-HNL-Metadata': metadata,
    },
    body: payload,
  }), 200);
  const result = await response.json();
  if (Number(result?.size || 0) !== payload.length) throw new Error(`PUT ${assetId}: size mismatch`);
  const serverSha = String(result?.sha256 || '').toLowerCase();
  if (serverSha && serverSha !== expectedSha) throw new Error(`PUT ${assetId}: SHA mismatch ${serverSha} != ${expectedSha}`);

  const head = await requireStatus(`HEAD ${assetId}`, await fetch(r2Endpoint(storagePath), {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${identity.idToken}`, Origin: hostingUrl },
  }), 200);
  if (Number(head.headers.get('content-length') || 0) !== payload.length) throw new Error(`HEAD ${assetId}: size mismatch`);
  const headSha = String(head.headers.get('x-hnl-sha256') || '').toLowerCase();
  if (headSha && headSha !== expectedSha) throw new Error(`HEAD ${assetId}: SHA mismatch ${headSha} != ${expectedSha}`);
  return { size: payload.length, sha256: headSha || serverSha || expectedSha };
}

async function getR2(identity, storagePath) {
  const response = await requireStatus(`GET ${storagePath}`, await fetch(r2Endpoint(storagePath), {
    headers: { Authorization: `Bearer ${identity.idToken}`, Origin: hostingUrl },
  }), 200);
  return Buffer.from(await response.arrayBuffer());
}

function waitForPhoto(db, predicate, label, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ref = doc(db, 'projects', pid, 'photos', photoId);
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`${label}: realtime timeout`));
    }, timeoutMs);
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (!predicate(data)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(data);
    }, (error) => {
      clearTimeout(timer);
      unsubscribe();
      reject(error);
    });
  });
}

let adminClient;
let editor;
let viewer;
let adminApp;
let adminDb;
let pathA = '';
let pathB = '';

try {
  adminApp = initializeAdminApp({ credential: applicationDefault(), projectId: devProjectId }, `dev-media-replace-admin-sdk-${nonce}`);
  adminDb = getAdminFirestore(adminApp);

  adminClient = await createIdentity('ADMIN', adminUid, adminEmail);
  editor = await createIdentity('EDITOR', editorUid, editorEmail);
  viewer = await createIdentity('VIEWER', viewerUid, viewerEmail);
  pass('isolated ADMIN/EDITOR/VIEWER identities');

  await adminDb.doc(`projects/${pid}`).set({
    id: pid,
    projectId: pid,
    name: `DEV Media Replacement Golden ${nonce}`,
    ownerUid: adminUid,
    ownerEmail: adminEmail,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    deleted: false,
    deletedAt: null,
  });
  await adminDb.doc(`projects/${pid}/members/${editorEmail}`).set({ email: editorEmail, role: 'EDITOR', active: true, assignedAt: now });
  await adminDb.doc(`projects/${pid}/members/${viewerEmail}`).set({ email: viewerEmail, role: 'VIEWER', active: true, assignedAt: now });
  await adminDb.doc(`projects/${pid}/defects/${defectId}`).set({
    id: defectId,
    projectId: pid,
    description: 'DEV immutable media replacement golden',
    status: 'OPEN',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    createdByUid: editorUid,
    updatedByUid: editorUid,
    deleted: false,
    deletedAt: null,
  });
  pass('isolated project/member/Defect fixtures seeded');

  const payloadA = Buffer.from(`HNL-QLTC-PR62-REVISION-A-${nonce}`, 'utf8');
  const payloadB = Buffer.from(`HNL-QLTC-PR62-REVISION-B-${nonce}-DIFFERENT-BYTES`, 'utf8');
  const shaA = sha256(payloadA);
  const shaB = sha256(payloadB);
  if (shaA === shaB) throw new Error('Fixture SHA collision');

  const assetA = `${logicalAssetId}--${shaA}`;
  const assetB = `${logicalAssetId}--${shaB}`;
  pathA = `projects/${pid}/media/defect/${defectId}/${assetA}/original.jpg`;
  pathB = `projects/${pid}/media/defect/${defectId}/${assetB}/original.jpg`;
  if (pathA === pathB) throw new Error('Immutable replacement paths unexpectedly equal');
  pass('same logical photo maps to distinct content-addressed object paths');

  const uploadedA = await putR2(editor, pathA, payloadA, assetA, shaA);
  pass('revision A uploaded and durable', `${uploadedA.size} bytes / ${uploadedA.sha256}`);

  const photoRefEditor = doc(editor.db, 'projects', pid, 'photos', photoId);
  const revision1At = now + 1000;
  await setDoc(photoRefEditor, {
    id: photoId,
    projectId: pid,
    entityType: 'defect',
    entityId: defectId,
    name: 'replacement-golden.jpg',
    mimeType: 'image/jpeg',
    fileSize: payloadA.length,
    contentVersion: revision1At,
    contentHash: shaA,
    storageMd5Hash: shaA,
    storageProvider: 'r2',
    storagePath: pathA,
    cloudFileId: `r2:${pathA}`,
    binaryUploadState: 'ready',
    revision: 1,
    createdAt: now,
    createdByUid: editorUid,
    updatedAt: revision1At,
    updatedByUid: editorUid,
    deleted: false,
    deletedAt: null,
  });

  const viewerRev1 = await waitForPhoto(viewer.db, (data) => Number(data.revision) === 1 && data.storagePath === pathA, 'viewer revision 1');
  if (!Buffer.from(await getR2(viewer, viewerRev1.storagePath)).equals(payloadA)) throw new Error('Viewer revision A byte mismatch');
  pass('VIEWER receives revision A pointer + exact bytes cross-account');

  const uploadedB = await putR2(editor, pathB, payloadB, assetB, shaB);
  pass('revision B binary uploaded durably before metadata publication', `${uploadedB.size} bytes / ${uploadedB.sha256}`);

  const beforePublishSnap = await getDoc(doc(viewer.db, 'projects', pid, 'photos', photoId));
  if (!beforePublishSnap.exists()) throw new Error('Viewer lost revision A metadata before revision B publication');
  const beforePublish = beforePublishSnap.data();
  if (Number(beforePublish.revision) !== 1 || beforePublish.storagePath !== pathA) {
    throw new Error(`Old pointer changed before metadata publication: rev=${beforePublish.revision} path=${beforePublish.storagePath}`);
  }
  const oldBytesAfterBUpload = await getR2(viewer, pathA);
  if (!oldBytesAfterBUpload.equals(payloadA)) throw new Error('Revision A object was overwritten by revision B upload');
  pass('old Firestore pointer remains revision A and still returns A bytes while B is staged');

  const revision2At = revision1At + 1000;
  const viewerRev2Promise = waitForPhoto(viewer.db, (data) => Number(data.revision) === 2 && data.storagePath === pathB, 'viewer revision 2');
  await setDoc(photoRefEditor, {
    fileSize: payloadB.length,
    contentVersion: revision2At,
    contentHash: shaB,
    storageMd5Hash: shaB,
    storageProvider: 'r2',
    storagePath: pathB,
    cloudFileId: `r2:${pathB}`,
    binaryUploadState: 'ready',
    revision: 2,
    updatedAt: revision2At,
    updatedByUid: editorUid,
  }, { merge: true });

  const viewerRev2 = await viewerRev2Promise;
  const newBytes = await getR2(viewer, viewerRev2.storagePath);
  if (!newBytes.equals(payloadB)) throw new Error('Viewer revision B byte mismatch');
  if (sha256(newBytes) !== shaB) throw new Error('Viewer revision B checksum mismatch');
  const oldBytesFinal = await getR2(viewer, pathA);
  if (!oldBytesFinal.equals(payloadA)) throw new Error('Old immutable object mutated after revision B publication');
  pass('VIEWER receives revision B pointer + exact new bytes without stale-object overwrite');
  pass('revision A remains immutable after revision B publication');

  fs.mkdirSync('runtime-evidence', { recursive: true });
  fs.writeFileSync('runtime-evidence/dev-media-replacement-live.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    devProjectId,
    runId,
    projectId: pid,
    photoId,
    revisionA: { storagePath: pathA, sha256: shaA, bytes: payloadA.length },
    revisionB: { storagePath: pathB, sha256: shaB, bytes: payloadB.length },
    checks: passLines,
    result: 'PASS',
  }, null, 2));

  console.log(`DEV IMMUTABLE MEDIA REPLACEMENT GOLDEN PASS — ${passLines.length} checks`);
} finally {
  try {
    if (adminClient?.idToken && pathA) await fetch(r2Endpoint(pathA), { method: 'DELETE', headers: { Authorization: `Bearer ${adminClient.idToken}`, Origin: hostingUrl } });
    if (adminClient?.idToken && pathB) await fetch(r2Endpoint(pathB), { method: 'DELETE', headers: { Authorization: `Bearer ${adminClient.idToken}`, Origin: hostingUrl } });
  } catch (error) {
    console.warn('DEV media replacement R2 cleanup warning:', error instanceof Error ? error.message : String(error));
  }

  try {
    if (adminDb) await adminDb.recursiveDelete(adminDb.doc(`projects/${pid}`));
  } catch (error) {
    console.warn('DEV media replacement Firestore cleanup warning:', error instanceof Error ? error.message : String(error));
  }

  try {
    if (adminApp) {
      const adminAuth = getAdminAuth(adminApp);
      for (const uid of [adminUid, editorUid, viewerUid]) await adminAuth.deleteUser(uid).catch(() => undefined);
    }
  } catch (error) {
    console.warn('DEV media replacement Auth cleanup warning:', error instanceof Error ? error.message : String(error));
  }

  for (const identity of [adminClient, editor, viewer]) {
    if (identity?.app) await deleteApp(identity.app).catch(() => undefined);
  }
  if (adminApp) await deleteAdminApp(adminApp).catch(() => undefined);
}
