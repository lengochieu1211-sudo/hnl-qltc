import fs from 'node:fs';
import path from 'node:path';

const projectId = process.env.PROD_FIREBASE_PROJECT_ID || 'com-example-qlct-61329';
const token = process.env.GOOGLE_ACCESS_TOKEN || '';
const outputFile = process.argv[2];
if (!token) throw new Error('GOOGLE_ACCESS_TOKEN is required');
if (!outputFile) throw new Error('Output JSONL path is required');

const dbId = '(default)';
const rootResource = `projects/${projectId}/databases/${dbId}/documents`;
const apiRoot = `https://firestore.googleapis.com/v1/${rootResource}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const esc = (value) => encodeURIComponent(String(value));
const escPath = (p) => String(p || '').split('/').filter(Boolean).map(esc).join('/');

async function api(url, options = {}, attempt = 1) {
  const res = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.ok) return res.status === 204 ? {} : res.json();
  const text = await res.text();
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 6) {
    await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
    return api(url, options, attempt + 1);
  }
  throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
}

async function listCollectionIds(parentDocPath = '') {
  const resource = parentDocPath ? `${apiRoot}/${escPath(parentDocPath)}` : apiRoot;
  let pageToken = '';
  const ids = [];
  do {
    const body = { pageSize: 1000 };
    if (pageToken) body.pageToken = pageToken;
    const json = await api(`${resource}:listCollectionIds`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const id of json.collectionIds || []) if (id) ids.push(String(id));
    pageToken = String(json.nextPageToken || '');
  } while (pageToken);
  return [...new Set(ids)].sort();
}

async function listDocuments(collectionPath) {
  let pageToken = '';
  const docs = [];
  do {
    const url = new URL(`${apiRoot}/${escPath(collectionPath)}`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('showMissing', 'true');
    url.searchParams.set('mask.fieldPaths', '__name__');
    // The field mask above is intentionally removed below for full backup after URL construction.
    url.searchParams.delete('mask.fieldPaths');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const json = await api(url.toString());
    for (const doc of json.documents || []) docs.push(doc);
    pageToken = String(json.nextPageToken || '');
  } while (pageToken);
  return docs;
}

function relativeDocPath(fullName) {
  const marker = '/documents/';
  const value = String(fullName || '');
  const i = value.indexOf(marker);
  return i >= 0 ? value.slice(i + marker.length) : '';
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
const stream = fs.createWriteStream(outputFile, { encoding: 'utf8', flags: 'wx' });
const writeLine = async (obj) => {
  if (!stream.write(`${JSON.stringify(obj)}\n`)) {
    await new Promise(resolve => stream.once('drain', resolve));
  }
};

const stats = {
  format: 'HNL-QLTC-FIRESTORE-LOGICAL-BACKUP-V1',
  projectId,
  databaseId: dbId,
  startedAt: new Date().toISOString(),
  documentCount: 0,
  missingParentCount: 0,
  collectionCount: 0,
  maxDepth: 0,
};
await writeLine({ type: 'header', ...stats });

const seenCollections = new Set();
const seenDocuments = new Set();

async function walkParent(parentDocPath = '', depth = 0) {
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  const collectionIds = await listCollectionIds(parentDocPath);
  for (const collectionId of collectionIds) {
    const collectionPath = parentDocPath ? `${parentDocPath}/${collectionId}` : collectionId;
    if (seenCollections.has(collectionPath)) continue;
    seenCollections.add(collectionPath);
    stats.collectionCount++;
    const docs = await listDocuments(collectionPath);
    for (const doc of docs) {
      const docPath = relativeDocPath(doc.name);
      if (!docPath || seenDocuments.has(docPath)) continue;
      seenDocuments.add(docPath);
      const missing = !doc.fields && !doc.createTime && !doc.updateTime;
      if (missing) {
        stats.missingParentCount++;
        await writeLine({ type: 'missing-parent', path: docPath });
      } else {
        stats.documentCount++;
        await writeLine({
          type: 'document',
          path: docPath,
          fields: doc.fields || {},
          createTime: doc.createTime || null,
          updateTime: doc.updateTime || null,
        });
      }
      await walkParent(docPath, depth + 1);
    }
  }
}

try {
  await walkParent('', 0);
  stats.completedAt = new Date().toISOString();
  await writeLine({ type: 'footer', ...stats });
} finally {
  await new Promise((resolve, reject) => {
    stream.end(err => err ? reject(err) : resolve());
  });
}

console.log(`Logical Firestore backup complete: documents=${stats.documentCount}, collections=${stats.collectionCount}, missingParents=${stats.missingParentCount}, maxDepth=${stats.maxDepth}`);
if (stats.documentCount < 1) process.exit(3);
