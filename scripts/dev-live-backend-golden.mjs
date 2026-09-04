import crypto from 'node:crypto';
import fs from 'node:fs';
import { google } from 'googleapis';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, deleteUser, getIdTokenResult } from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  disableNetwork,
  enableNetwork,
  waitForPendingWrites,
} from 'firebase/firestore';

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

const projectId = required('VITE_FIREBASE_PROJECT_ID');
const apiKey = required('VITE_FIREBASE_API_KEY');
const appId = required('VITE_FIREBASE_APP_ID');
const messagingSenderId = required('VITE_FIREBASE_MESSAGING_SENDER_ID');
const authDomain = required('VITE_FIREBASE_AUTH_DOMAIN');
const storageBucket = required('VITE_FIREBASE_STORAGE_BUCKET');
const r2Url = required('DEV_R2_URL').replace(/\/$/, '');
const credentialPath = required('GOOGLE_APPLICATION_CREDENTIALS');
const hostingUrl = required('DEV_HOSTING_URL').replace(/\/$/, '');
const prodProjectId = required('PROD_FIREBASE_PROJECT_ID');
const prodR2Url = required('PROD_R2_URL').replace(/\/$/, '');

if (projectId !== 'hnl-qltc-dev') throw new Error(`Refusing live golden outside hnl-qltc-dev: ${projectId}`);
if (projectId === prodProjectId) throw new Error('REFUSING: DEV project equals PROD project');
if (r2Url === prodR2Url) throw new Error('REFUSING: DEV R2 equals PROD R2');
if (!hostingUrl.includes('hnl-qltc-dev.web.app')) throw new Error(`Unexpected DEV Hosting URL: ${hostingUrl}`);

const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
if (serviceAccount.project_id !== projectId) {
  throw new Error(`Service account project mismatch: ${serviceAccount.project_id} != ${projectId}`);
}

const config = { apiKey, appId, messagingSenderId, projectId, authDomain, storageBucket };
const runSuffix = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z_-]/g, '').slice(-32);
const nonce = `${runSuffix}-${Date.now().toString(36)}`;
const pid = `dev-live-golden-${nonce}`;
const adminUid = `dev-admin-${nonce}`.slice(0, 120);
const editorUid = `dev-editor-${nonce}`.slice(0, 120);
const viewerUid = `dev-viewer-${nonce}`.slice(0, 120);
const adminEmail = `dev-admin-${nonce}@example.test`.toLowerCase();
const editorEmail = `dev-editor-${nonce}@example.test`.toLowerCase();
const viewerEmail = `dev-viewer-${nonce}@example.test`.toLowerCase();
const floorId = 'FP-LIVE-1';
const roomId = 'ROOM-LIVE-1';
const teamId = 'TEAM-LIVE-1';
const defectId = 'DEFECT-LIVE-1';

const report = { projectId, pid, startedAt: new Date().toISOString(), checks: [], cleanup: [] };
const pass = (name, detail = '') => {
  report.checks.push({ name, status: 'PASS', detail });
  console.log(`PASS LIVE: ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const b64url = (value) => Buffer.from(value).toString('base64url');

function mintCustomToken(uid, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims: { email, email_verified: true, hnlDevGolden: true },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function createIdentity(kind, uid, email) {
  const app = initializeApp(config, `dev-live-${kind}-${nonce}`);
  const auth = getAuth(app);
  await signInWithCustomToken(auth, mintCustomToken(uid, email));
  const tokenResult = await getIdTokenResult(auth.currentUser, true);
  if (String(tokenResult.claims.email || '').toLowerCase() !== email) {
    throw new Error(`${kind} custom token email claim missing`);
  }
  pass(`${kind} Firebase custom-auth identity`, email);
  return { kind, uid, email, app, auth, db: getFirestore(app) };
}

async function expectDenied(name, fn) {
  try {
    await fn();
  } catch (error) {
    const text = String(error?.code || error?.message || error).toLowerCase();
    if (text.includes('permission') || text.includes('denied') || text.includes('unauthorized')) {
      pass(name, 'denied as expected');
      return;
    }
    throw error;
  }
  throw new Error(`Expected denial but operation succeeded: ${name}`);
}

async function requireStatus(name, response, expected) {
  if (response.status !== expected) {
    const body = await response.text().catch(() => '');
    throw new Error(`${name}: expected HTTP ${expected}, got ${response.status}: ${body.slice(0, 500)}`);
  }
  pass(name, `HTTP ${expected}`);
  return response;
}

function waitForSnapshot(ref, predicate, label, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsubscribe = onSnapshot(ref, snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      if (!predicate(data)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(data);
    }, error => {
      clearTimeout(timer);
      unsubscribe();
      reject(error);
    });
  });
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
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encoded}`;
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

let admin;
let editor;
let viewer;
let r2ObjectKey = '';

try {
  admin = await createIdentity('ADMIN', adminUid, adminEmail);
  editor = await createIdentity('EDITOR', editorUid, editorEmail);
  viewer = await createIdentity('VIEWER', viewerUid, viewerEmail);

  const projectRefAdmin = doc(admin.db, 'projects', pid);
  const projectRefEditor = doc(editor.db, 'projects', pid);
  const projectRefViewer = doc(viewer.db, 'projects', pid);
  const now = Date.now();

  if ((await getDoc(projectRefAdmin)).exists()) throw new Error('Fresh live golden project unexpectedly exists');
  pass('fresh DEV project root probe');

  await setDoc(projectRefAdmin, {
    id: pid,
    name: 'HNL QLTC DEV Live Golden',
    ownerUid: adminUid,
    ownerEmail: adminEmail,
    createdAt: now,
    updatedAt: now,
  });
  pass('ADMIN creates isolated live project root');

  await setDoc(doc(admin.db, 'projects', pid, 'members', editorEmail), {
    email: editorEmail,
    role: 'EDITOR',
    active: true,
    assignedAt: now,
  });
  await setDoc(doc(admin.db, 'projects', pid, 'members', viewerEmail), {
    email: viewerEmail,
    role: 'VIEWER',
    active: true,
    assignedAt: now,
  });
  pass('ADMIN materializes canonical EDITOR/VIEWER memberships');

  if (!(await getDoc(projectRefEditor)).exists()) throw new Error('EDITOR cannot read live project');
  if (!(await getDoc(projectRefViewer)).exists()) throw new Error('VIEWER cannot read live project');
  pass('multi-user project reads through deployed Firestore rules');

  await setDoc(doc(admin.db, 'projects', pid, 'memberContacts', editorEmail), {
    projectId: pid,
    email: editorEmail,
    phone: '0901234567',
    displayName: 'DEV Editor Golden',
    updatedAt: now + 1,
    updatedByUid: adminUid,
  });
  const editorContact = await getDoc(doc(editor.db, 'projects', pid, 'memberContacts', editorEmail));
  if (!editorContact.exists() || editorContact.data().phone !== '0901234567') {
    throw new Error('EDITOR phone/contact live read mismatch');
  }
  pass('member phone persists and is readable by EDITOR', editorContact.data().phone);
  await expectDenied('VIEWER private phone/contact read', () => getDoc(doc(viewer.db, 'projects', pid, 'memberContacts', editorEmail)));

  await setDoc(doc(admin.db, 'projects', pid, 'floor_plans', floorId), {
    id: floorId,
    floorName: 'Tầng DEV 1',
    order: 0,
    revision: 1,
    updatedAt: now + 2,
    deleted: false,
    deletedAt: null,
  });
  await setDoc(doc(admin.db, 'projects', pid, 'teams', teamId), {
    id: teamId,
    name: 'Đội DEV A',
    leader: 'Đội trưởng DEV',
    defaultCount: 5,
    revision: 1,
    createdAt: now + 3,
    updatedAt: now + 3,
    deleted: false,
    deletedAt: null,
  });
  await setDoc(doc(admin.db, 'projects', pid, 'rooms', roomId), {
    id: roomId,
    floorId,
    roomName: 'Căn DEV 01',
    floorName: 'Tầng DEV 1',
    x: 10,
    y: 10,
    width: 20,
    height: 15,
    assignedTeam: 'Đội DEV A',
    teamId,
    frameStatus: 'Chưa làm',
    boardStatus: 'Chưa làm',
    inspectionStatus: 'Chưa nghiệm thu',
    revision: 1,
    updatedAt: now + 4,
    deleted: false,
    deletedAt: null,
  });
  pass('ADMIN creates floor/room/team structure');

  await expectDenied('EDITOR cannot create room structure', () => setDoc(doc(editor.db, 'projects', pid, 'rooms', 'ROOM-EDITOR-DENY'), {
    id: 'ROOM-EDITOR-DENY',
    floorId,
    roomName: 'Không được tạo',
    revision: 1,
    updatedAt: now + 5,
    deleted: false,
    deletedAt: null,
  }));

  const defectRefEditor = doc(editor.db, 'projects', pid, 'defects', defectId);
  const defectRefViewer = doc(viewer.db, 'projects', pid, 'defects', defectId);
  const viewerSeesCreate = waitForSnapshot(
    defectRefViewer,
    data => data.id === defectId && data.revision === 1,
    'VIEWER realtime Defect create',
  );

  await setDoc(defectRefEditor, {
    id: defectId,
    title: 'Defect DEV liên kết căn/đội',
    description: 'Live Golden Defect → roomId → teamId',
    floorId,
    roomId,
    teamId,
    roomName: 'Căn DEV 01',
    assignedTeam: 'Đội DEV A',
    status: 'Mới',
    revision: 1,
    createdAt: now + 6,
    updatedAt: now + 6,
    deleted: false,
    deletedAt: null,
  });
  pass('EDITOR creates operational Defect on live DEV');

  const realtimeDefect = await viewerSeesCreate;
  if (realtimeDefect.roomId !== roomId || realtimeDefect.teamId !== teamId) {
    throw new Error(`Realtime Defect linkage mismatch: room=${realtimeDefect.roomId} team=${realtimeDefect.teamId}`);
  }
  pass('VIEWER receives Defect realtime with stable roomId/teamId');

  const roomSeen = await getDoc(doc(viewer.db, 'projects', pid, 'rooms', roomId));
  const teamSeen = await getDoc(doc(viewer.db, 'projects', pid, 'teams', teamId));
  if (!roomSeen.exists() || !teamSeen.exists()) throw new Error('VIEWER cannot resolve Defect room/team structure');
  if (roomSeen.data().teamId !== teamId) throw new Error('Room teamId mismatch in live DEV');
  pass('Defect → roomId → teamId resolves to exact room and team');

  await expectDenied('VIEWER cannot mutate Defect', () => updateDoc(defectRefViewer, {
    status: 'Đã sửa trái phép',
    revision: 2,
    updatedAt: now + 7,
  }));

  await updateDoc(defectRefEditor, {
    status: 'Đang xử lý',
    revision: 2,
    updatedAt: now + 8,
  });
  pass('EDITOR monotonic Defect update');

  await disableNetwork(editor.db);
  let pendingResolved = false;
  const offlinePendingWrite = updateDoc(defectRefEditor, {
    status: 'Chờ đồng bộ lại',
    revision: 3,
    updatedAt: now + 9,
  }).then(() => { pendingResolved = true; });
  await sleep(500);
  if (pendingResolved) throw new Error('Offline write unexpectedly committed while Firestore network disabled');
  pass('offline write remains pending while network disabled');

  const viewerSeesReconnect = waitForSnapshot(
    defectRefViewer,
    data => data.revision === 3 && data.status === 'Chờ đồng bộ lại',
    'VIEWER realtime reconnect update',
    20000,
  );
  await enableNetwork(editor.db);
  await offlinePendingWrite;
  await waitForPendingWrites(editor.db);
  const reconnected = await viewerSeesReconnect;
  if (reconnected.roomId !== roomId || reconnected.teamId !== teamId) {
    throw new Error('Reconnect changed Defect room/team identity');
  }
  pass('offline → reconnect publishes pending Defect to VIEWER with linkage intact');

  const editorIdToken = await editor.auth.currentUser.getIdToken(true);
  const viewerIdToken = await viewer.auth.currentUser.getIdToken(true);
  const adminIdToken = await admin.auth.currentUser.getIdToken(true);
  r2ObjectKey = `projects/${pid}/media/dev-live-golden.txt`;
  const r2Endpoint = `${r2Url}/v1/object?key=${encodeURIComponent(r2ObjectKey)}`;
  const payload = Buffer.from(`HNL-QLTC-DEV-R2-${nonce}`, 'utf8');
  const metadata = encodeURIComponent(JSON.stringify({ projectId: pid, entityType: 'defect', entityId: defectId, golden: 'true' }));

  await requireStatus('EDITOR uploads operational media to DEV R2', await fetch(r2Endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${editorIdToken}`,
      Origin: hostingUrl,
      'Content-Type': 'text/plain',
      'X-HNL-Metadata': metadata,
    },
    body: payload,
  }), 200);

  const viewerHead = await requireStatus('VIEWER HEADs durable DEV R2 media', await fetch(r2Endpoint, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${viewerIdToken}`, Origin: hostingUrl },
  }), 200);
  if (Number(viewerHead.headers.get('content-length') || 0) !== payload.length) throw new Error('R2 HEAD content-length mismatch');
  if (!viewerHead.headers.get('x-hnl-sha256')) throw new Error('R2 HEAD missing X-HNL-SHA256');
  pass('R2 durability exposes byte size + SHA256');

  const viewerGet = await requireStatus('VIEWER reads DEV R2 media cross-account', await fetch(r2Endpoint, {
    headers: { Authorization: `Bearer ${viewerIdToken}`, Origin: hostingUrl },
  }), 200);
  const downloaded = Buffer.from(await viewerGet.arrayBuffer());
  if (!downloaded.equals(payload)) throw new Error('Cross-account R2 binary payload mismatch');
  pass('cross-account R2 binary byte parity');

  await requireStatus('VIEWER cannot upload DEV R2 media', await fetch(`${r2Url}/v1/object?key=${encodeURIComponent(`projects/${pid}/media/viewer-denied.txt`)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${viewerIdToken}`, Origin: hostingUrl, 'Content-Type': 'text/plain' },
    body: Buffer.from('deny-me'),
  }), 403);

  await requireStatus('EDITOR cannot upload floor-plan structure to DEV R2', await fetch(`${r2Url}/v1/object?key=${encodeURIComponent(`projects/${pid}/floor-plans/editor-denied.txt`)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${editorIdToken}`, Origin: hostingUrl, 'Content-Type': 'text/plain' },
    body: Buffer.from('deny-floor'),
  }), 403);

  await requireStatus('EDITOR cannot purge DEV R2 media', await fetch(r2Endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${editorIdToken}`, Origin: hostingUrl },
  }), 403);

  await requireStatus('ADMIN purges DEV R2 golden media', await fetch(r2Endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminIdToken}`, Origin: hostingUrl },
  }), 200);
  r2ObjectKey = '';

  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error?.message || error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (r2ObjectKey && admin?.auth?.currentUser) {
    try {
      const token = await admin.auth.currentUser.getIdToken(true);
      await fetch(`${r2Url}/v1/object?key=${encodeURIComponent(r2ObjectKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Origin: hostingUrl },
      });
      report.cleanup.push({ r2ObjectKey, status: 'DELETE_ATTEMPTED' });
    } catch {}
  }

  try {
    const oauth = await adminAccessToken();
    const cleanupPaths = [
      `projects/${pid}/memberContacts/${editorEmail}`,
      `projects/${pid}/members/${editorEmail}`,
      `projects/${pid}/members/${viewerEmail}`,
      `projects/${pid}/defects/${defectId}`,
      `projects/${pid}/rooms/${roomId}`,
      `projects/${pid}/teams/${teamId}`,
      `projects/${pid}/floor_plans/${floorId}`,
      `projects/${pid}`,
    ];
    for (const path of cleanupPaths) await adminDeleteDoc(oauth, path);
    console.log('LIVE DEV Firestore test-data cleanup: PASS');
  } catch (error) {
    report.cleanupError = String(error?.message || error);
    console.error(`Cleanup warning: ${report.cleanupError}`);
    process.exitCode = 1;
  }

  for (const identity of [viewer, editor, admin]) {
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
  fs.writeFileSync('runtime-evidence/live-backend-report.json', JSON.stringify(report, null, 2));
  console.log(`LIVE BACKEND GOLDEN ${report.status || 'FAIL'} — ${report.checks.length} checks`);
}
