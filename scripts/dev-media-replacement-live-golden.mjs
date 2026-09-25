import crypto from 'node:crypto';
import fs from 'node:fs';
import { google } from 'googleapis';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, deleteUser } from 'firebase/auth';
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
const prodProjectId = required('PROD_FIREBASE_PROJECT_ID');
const prodR2Url = required('PROD_R2_URL').replace(/\/+$/, '');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

if (devProjectId !== 'hnl-qltc-dev') throw new Error(`REFUSING: unexpected DEV project ${devProjectId}`);
if (devProjectId === prodProjectId) throw new Error('REFUSING: DEV Firebase project equals PROD');
if (r2Url === prodR2Url) throw new Error('REFUSING: DEV R2 equals PROD');
if (!/-dev\./i.test(r2Url)) throw new Error(`REFUSING: non-DEV R2 URL ${r2Url}`);
if (serviceAccount.project_id !== devProjectId) throw new Error(`Service account project mismatch: ${serviceAccount.project_id}`);

const config = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};
if (config.projectId !== devProjectId) throw new Error(`REFUSING: SDK project mismatch ${config.projectId}`);

const runId = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z_-]/g, '').slice(-32);
const nonce = `${runId}-${Date.now().toString(36)}`;
const pid = `dev-media-replace-${nonce}`;
const defectId = `DEF-${nonce}`;
const photoId = `PHOTO-${nonce}`;
const logicalAssetId = photoId;
const adminUid = `dev-media-admin-${nonce}`.slice(0, 120);
const editorUid = `dev-media-editor-${nonce}`.slice(0, 120);
const viewerUid = `dev-media-viewer-${nonce}`.slice(0, 120);
const adminEmail = `${adminUid}@example.test`.toLowerCase();
const editorEmail = `${editorUid}@example.test`.toLowerCase();
const viewerEmail = `${viewerUid}@example.test`.toLowerCase();
const now = Date.now();

const report = {
  devProjectId,
  projectId: pid,
  photoId,
  runId,
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: [],
};

const pass = (name, detail = '') => {
  report.checks.push({ name, status: 'PASS', detail });
  console.log(`PASS MEDIA REPLACE LIVE: ${name}${detail ? ` — ${detail}` : ''}`);
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
  const idToken = await auth.currentUser.getIdToken(true);
  return { kind, uid, email, app, auth, db: getFirestore(app), idToken };
}

async function adminAccessToken() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('Unable to obtain service-account OAuth token for cleanup');
  return token;
}

const firestoreDocUrl = (path) => {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(devProjectId)}/databases/(default)/documents/${encoded}`;
};

async function adminDeleteDoc(oauthToken, path) {
  const response = await fetch(firestoreDocUrl(path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${oauthToken}` },
  });
  if (response.status !== 200 && response.status !== 404) {
    const body = await response.text().catch(() => '');
    throw new Error(`Cleanup delete ${path} failed HTTP ${response.status}: ${body.slice(0, 400)}`);
  }
  report.cleanup.push({ path, status: response.status === 404 ? 'NOT_FOUND' : 'DELETED' });
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
    golden: 'true',
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
  const serverSha = String(result?.sha256 || '').trim().toLowerCase();
  if (!serverSha) throw new Error(`PUT ${assetId}: missing SHA256`);
  if (serverSha !== expectedSha) throw new Error(`PUT ${assetId}: SHA mismatch ${serverSha} != ${expectedSha}`);

  const head = await requireStatus(`HEAD ${assetId}`, await fetch(r2Endpoint(storagePath), {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${identity.idToken}`, Origin: hostingUrl },
  }), 200);
  if (Number(head.headers.get('content-length') || 0) !== payload.length) throw new Error(`HEAD ${assetId}: size mismatch`);
  const headSha = String(head.headers.get('x-hnl-sha256') || '').trim().toLowerCase();
  if (!headSha || headSha !== expectedSha) throw new Error(`HEAD ${assetId}: SHA mismatch ${headSha || 'missing'} != ${expectedSha}`);
  return { size: payload.length, sha256: headSha };
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
let pathA = '';
let pathB = '';

try {
  adminClient = await createIdentity('ADMIN', adminUid, adminEmail);
  editor = await createIdentity('EDITOR', editorUid, editorEmail);
  viewer = await createIdentity('VIEWER', viewerUid, viewerEmail);
  pass('isolated ADMIN/EDITOR/VIEWER identities');

  const projectRefAdmin = doc(adminClient.db, 'projects', pid);
  if ((await getDoc(projectRefAdmin)).exists()) throw new Error('Fresh replacement-golden project unexpectedly exists');

  await setDoc(projectRefAdmin, {
    id: pid,
    name: `DEV Media Replacement Golden ${nonce}`,
    ownerUid: adminUid,
    ownerEmail: adminEmail,
    createdAt: now,
    updatedAt: now,
  });
  await setDoc(doc(adminClient.db, 'projects', pid, 'members', editorEmail), {
    email: editorEmail,
    role: 'EDITOR',
    active: true,
    assignedAt: now,
  });
  await setDoc(doc(adminClient.db, 'projects', pid, 'members', viewerEmail), {
    email: viewerEmail,
    role: 'VIEWER',
    active: true,
    assignedAt: now,
  });
  await setDoc(doc(editor.db, 'projects', pid, 'defects', defectId), {
    id: defectId,
    title: 'DEV immutable media replacement',
    description: 'Same logical photo ID must publish immutable binary revisions',
    status: 'Mới',
    revision: 1,
    createdAt: now + 1,
    updatedAt: now + 1,
    deleted: false,
    deletedAt: null,
  });
  pass('isolated project/member/Defect fixtures seeded through deployed rules');

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
  const viewerRev1Promise = waitForPhoto(viewer.db, (data) => Number(data.revision) === 1 && data.storagePath === pathA, 'viewer revision 1');
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

  const viewerRev1 = await viewerRev1Promise;
  if (!(await getR2(viewer, viewerRev1.storagePath)).equals(payloadA)) throw new Error('Viewer revision A byte mismatch');
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

  report.revisionA = { storagePath: pathA, sha256: shaA, bytes: payloadA.length };
  report.revisionB = { storagePath: pathB, sha256: shaB, bytes: payloadB.length };
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error?.message || error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if ((pathA || pathB) && adminClient?.auth?.currentUser) {
    try {
      const adminIdToken = await adminClient.auth.currentUser.getIdToken(true);
      for (const storagePath of [pathA, pathB].filter(Boolean)) {
        const response = await fetch(r2Endpoint(storagePath), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminIdToken}`, Origin: hostingUrl },
        });
        if (response.status !== 200 && response.status !== 404) {
          throw new Error(`R2 cleanup ${storagePath} failed HTTP ${response.status}`);
        }
        report.cleanup.push({ storagePath, status: response.status === 404 ? 'NOT_FOUND' : 'DELETED' });
      }
    } catch (error) {
      report.cleanup.push({ target: 'R2', status: 'DELETE_FAILED', detail: String(error?.message || error) });
      console.error('DEV media replacement R2 cleanup warning:', error?.message || error);
      process.exitCode = 1;
    }
  }

  try {
    const oauth = await adminAccessToken();
    const cleanupPaths = [
      `projects/${pid}/photos/${photoId}`,
      `projects/${pid}/defects/${defectId}`,
      `projects/${pid}/members/${editorEmail}`,
      `projects/${pid}/members/${viewerEmail}`,
      `projects/${pid}`,
    ];
    for (const path of cleanupPaths) await adminDeleteDoc(oauth, path);
    console.log('DEV media replacement Firestore cleanup: PASS');
  } catch (error) {
    report.cleanup.push({ target: 'Firestore', status: 'DELETE_FAILED', detail: String(error?.message || error) });
    console.error('DEV media replacement Firestore cleanup warning:', error?.message || error);
    process.exitCode = 1;
  }

  for (const identity of [viewer, editor, adminClient]) {
    if (!identity) continue;
    try {
      if (identity.auth.currentUser) await deleteUser(identity.auth.currentUser);
      report.cleanup.push({ authUid: identity.uid, status: 'DELETED' });
    } catch (error) {
      report.cleanup.push({ authUid: identity.uid, status: 'DELETE_FAILED', detail: String(error?.code || error?.message || error) });
      console.error(`Auth cleanup warning for ${identity.uid}:`, error?.code || error?.message || error);
      process.exitCode = 1;
    }
    try { await deleteApp(identity.app); } catch {}
  }

  report.finishedAt = new Date().toISOString();
  fs.mkdirSync('runtime-evidence', { recursive: true });
  fs.writeFileSync('runtime-evidence/dev-media-replacement-live.json', JSON.stringify(report, null, 2));
  console.log(`DEV IMMUTABLE MEDIA REPLACEMENT GOLDEN ${report.status || 'FAIL'} — ${report.checks.length} checks`);
}
