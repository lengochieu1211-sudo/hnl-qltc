import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, deleteUser } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { createHnlAiProjectSnapshot } from '../src/ai/data/projectSnapshot';
import type { AiQueryContext } from '../src/ai/core/contracts';
import { buildHealthCenterReport } from '../src/healthCenter/healthCenterEngine';
import { buildHealthCenterRepairPreview } from '../src/healthCenter/healthCenterRepair';
import { applyHealthCenterRepairPreview } from '../src/healthCenter/healthCenterRepairApply';
import { buildHealthCenterRepairPersistencePlan } from '../src/healthCenter/healthCenterRepairPersistence';
import type { CrewRecord, TeamInfo } from '../src/types';

const required = (name: string): string => {
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
const credentialPath = required('GOOGLE_APPLICATION_CREDENTIALS');
const prodProjectId = required('PROD_FIREBASE_PROJECT_ID');

if (projectId !== 'hnl-qltc-dev') throw new Error(`Refusing Health Center live repair outside DEV: ${projectId}`);
if (projectId === prodProjectId) throw new Error('REFUSING: DEV Firebase equals PROD Firebase');

const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8')) as {
  project_id: string;
  client_email: string;
  private_key: string;
};
if (serviceAccount.project_id !== projectId) throw new Error('Service-account project mismatch');

const config = { apiKey, appId, messagingSenderId, projectId, authDomain, storageBucket };
const runSuffix = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z_-]/g, '').slice(-24);
const nonce = `${runSuffix}-${Date.now().toString(36)}`;
const pid = `hc-repair-live-${nonce}`;
const adminUid = `hc-admin-${nonce}`.slice(0, 120);
const viewerUid = `hc-viewer-${nonce}`.slice(0, 120);
const adminEmail = `hc-admin-${nonce}@example.test`.toLowerCase();
const viewerEmail = `hc-viewer-${nonce}@example.test`.toLowerCase();
const teamId = 'TEAM-HC-LIVE-1';
const crewId = 'CREW-HC-LIVE-1';
const now = Date.now();
const evidence: Record<string, unknown> = { projectId, pid, startedAt: new Date().toISOString(), checks: [] as unknown[] };
const checks = evidence.checks as Array<{ name: string; status: 'PASS'; detail?: string }>;
const pass = (name: string, detail = '') => {
  checks.push({ name, status: 'PASS', ...(detail ? { detail } : {}) });
  console.log(`PASS HC LIVE: ${name}${detail ? ` — ${detail}` : ''}`);
};
const b64url = (value: string): string => Buffer.from(value).toString('base64url');

function mintCustomToken(uid: string, email: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: issuedAt,
    exp: issuedAt + 3600,
    uid,
    claims: { email, email_verified: true, hnlDevGolden: true },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function createIdentity(name: string, uid: string, email: string) {
  const app = initializeApp(config, `hc-live-${name}-${nonce}`);
  const auth = getAuth(app);
  await signInWithCustomToken(auth, mintCustomToken(uid, email));
  if (!auth.currentUser) throw new Error(`${name} auth unavailable`);
  return { app, auth, db: getFirestore(app), uid, email };
}

function waitForSnapshot(ref: ReturnType<typeof doc>, predicate: (data: Record<string, unknown>) => boolean, label: string, timeoutMs = 15000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    const unsubscribe = onSnapshot(ref, snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as Record<string, unknown>;
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

async function oauthToken(): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('Unable to obtain cleanup token');
  return token;
}

const firestoreDocUrl = (docPath: string): string => {
  const encoded = docPath.split('/').map(encodeURIComponent).join('/');
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encoded}`;
};

async function adminDeleteDoc(token: string, docPath: string): Promise<void> {
  const response = await fetch(firestoreDocUrl(docPath), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 200 && response.status !== 404) {
    throw new Error(`Cleanup failed ${docPath}: HTTP ${response.status}`);
  }
}

let admin: Awaited<ReturnType<typeof createIdentity>> | undefined;
let viewer: Awaited<ReturnType<typeof createIdentity>> | undefined;

try {
  admin = await createIdentity('admin', adminUid, adminEmail);
  viewer = await createIdentity('viewer', viewerUid, viewerEmail);
  pass('isolated ADMIN + VIEWER identities');

  await setDoc(doc(admin.db, 'projects', pid), {
    id: pid, name: 'Health Center Live Repair Golden', ownerUid: adminUid, ownerEmail: adminEmail,
    createdAt: now, updatedAt: now,
  });
  await setDoc(doc(admin.db, 'projects', pid, 'members', viewerEmail), {
    email: viewerEmail, role: 'VIEWER', active: true, assignedAt: now,
  });
  const team: TeamInfo = { id: teamId, name: 'Đội Health Golden', leader: 'Golden', defaultCount: 4 };
  await setDoc(doc(admin.db, 'projects', pid, 'teams', teamId), {
    ...team, revision: 1, createdAt: now + 1, updatedAt: now + 1, deleted: false, deletedAt: null,
  });
  const crewBefore: CrewRecord & { revision: number; updatedAt: number } = {
    id: crewId,
    date: '2026-09-06',
    teamName: team.name,
    leaderName: 'Golden',
    workerCount: 4,
    floorName: 'Tầng DEV',
    taskDescription: 'Thi công test Health Center',
    teamId: '',
    revision: 1,
    updatedAt: now + 2,
  };
  await setDoc(doc(admin.db, 'projects', pid, 'crew_records', crewId), { ...crewBefore, deleted: false, deletedAt: null });
  pass('seeded one deterministic missing-teamId issue');

  const context: AiQueryContext = { projectId: pid, role: 'ADMIN', accessVerified: true, timeZone: 'Asia/Ho_Chi_Minh' };
  const buildReport = (crewRecords: CrewRecord[]) => {
    const snapshot = createHnlAiProjectSnapshot({
      projectId: pid,
      projectName: 'Health Center Live Repair Golden',
      rooms: [], defects: [], crewRecords, teams: [team], floors: [], workVolumes: [], inventory: [], materialNorms: [], checklist: [],
      asOf: Date.now(), freshness: 'live',
    });
    return buildHealthCenterReport({ context, snapshot, runtimeLog: [] });
  };

  const reportBefore = buildReport([crewBefore]);
  const targetIssue = reportBefore.issues.find(issue => issue.ruleId === 'CREW_TEAM_ID_MISSING' && issue.entityId === crewId);
  if (!targetIssue) throw new Error('Health Center did not detect CREW_TEAM_ID_MISSING');
  if (targetIssue.actionClass !== 'SAFE_REPAIR_CANDIDATE') throw new Error(`Unexpected action class: ${targetIssue.actionClass}`);
  pass('Health Center detects deterministic safe repair', targetIssue.ruleId);

  const preview = buildHealthCenterRepairPreview(reportBefore, [targetIssue.id]);
  if (!preview.canApply || preview.operations.length !== 1 || preview.operations[0].after !== teamId) {
    throw new Error('Repair Preview did not resolve unique teamId');
  }
  pass('Repair Preview resolves unique teamId', String(preview.operations[0].after));

  const fullBefore = { defects: [], crewRecords: [crewBefore] };
  const applied = applyHealthCenterRepairPreview(fullBefore, preview);
  if (!applied.ok) throw new Error(`In-memory apply blocked: ${JSON.stringify(applied.failures)}`);
  const persistence = buildHealthCenterRepairPersistencePlan({
    beforeData: fullBefore,
    appliedData: applied.data,
    preview,
    now: now + 100,
    actorUid: adminUid,
  });
  if (persistence.changedRecordCount !== 1 || persistence.deletedIds && Object.keys(persistence.deletedIds).length !== 0) {
    throw new Error('Persistence plan scope is not exactly one non-delete crew update');
  }
  const row = persistence.addedOrModified.crew_records?.[0];
  if (!row || row.id !== crewId || row.teamId !== teamId || row.revision !== 2) {
    throw new Error(`Unexpected persistence row: ${JSON.stringify(row)}`);
  }
  pass('Persistence plan is narrow and monotonic');

  const viewerCrewRef = doc(viewer.db, 'projects', pid, 'crew_records', crewId);
  const viewerSeesRepair = waitForSnapshot(
    viewerCrewRef,
    data => data.teamId === teamId && Number(data.revision) === 2,
    'VIEWER realtime safe repair',
  );
  await updateDoc(doc(admin.db, 'projects', pid, 'crew_records', crewId), row);
  const realtimeRow = await viewerSeesRepair;
  if (realtimeRow.teamId !== teamId) throw new Error('VIEWER realtime teamId mismatch');
  pass('Firestore + realtime publishes safe repair to second account');

  const serverFixed = await getDoc(doc(admin.db, 'projects', pid, 'crew_records', crewId));
  if (!serverFixed.exists()) throw new Error('Fixed crew record missing from Firestore');
  const fixedCrew = serverFixed.data() as CrewRecord;
  const reportAfter = buildReport([fixedCrew]);
  if (reportAfter.issues.some(issue => issue.ruleId === 'CREW_TEAM_ID_MISSING' && issue.entityId === crewId)) {
    throw new Error('Re-audit still reports repaired teamId issue');
  }
  if (reportAfter.safeRepairCount !== 0) throw new Error(`Unexpected safeRepairCount after repair: ${reportAfter.safeRepairCount}`);
  pass('re-audit clears repaired issue and returns safeRepairCount=0');

  evidence.finishedAt = new Date().toISOString();
  evidence.auditSnapshotBefore = reportBefore.auditSnapshotId;
  evidence.auditSnapshotAfter = reportAfter.auditSnapshotId;
  evidence.repairedRecord = { id: crewId, teamId, revision: fixedCrew.revision };
  fs.mkdirSync(path.join(process.cwd(), 'runtime-evidence'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'runtime-evidence', 'health-center-repair-live.json'), JSON.stringify(evidence, null, 2));
  console.log('HNL Health Center DEV live safe-repair golden: PASS');
} finally {
  try {
    const token = await oauthToken();
    await adminDeleteDoc(token, `projects/${pid}/crew_records/${crewId}`);
    await adminDeleteDoc(token, `projects/${pid}/teams/${teamId}`);
    await adminDeleteDoc(token, `projects/${pid}/members/${viewerEmail}`);
    await adminDeleteDoc(token, `projects/${pid}`);
  } catch (error) {
    console.warn('Health Center golden cleanup warning:', error);
  }
  for (const identity of [viewer, admin]) {
    if (!identity) continue;
    try { if (identity.auth.currentUser) await deleteUser(identity.auth.currentUser); } catch {}
    try { await deleteApp(identity.app); } catch {}
  }
}
