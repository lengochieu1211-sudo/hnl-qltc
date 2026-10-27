#!/usr/bin/env node
// P21.20: Real Firestore Emulator only. Synthetic documents; never accesses live Firebase.
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes, publicEncrypt, createCipheriv, createHash, constants} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {crawlFirestore, listDocumentsQuery} from './p2115-firestore-traversal.mjs';
import {decryptSnapshot, inventory, restoreToEmptyEmulator, assertIsolatedEmulator} from './p2115-firestore-restore-core.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (process.env.P2115_REAL_EMULATOR_TEST !== '1' || !/^(127\.0\.0\.1|localhost):8080$/.test(host || '')) {
  throw Error('P2120_LOCAL_EMULATOR_ONLY');
}
const sourceProject = 'hnl-qltc-dev'; // synthetic fixture on local emulator, NOT real DEV
const targetProject = 'hnl-qltc-restore-isolated';
assertIsolatedEmulator({host, targetProject});
const endpoint = project => 'http://' + host + '/v1/projects/' + project + '/databases/(default)/documents';
const sourceBase = endpoint(sourceProject);
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const sha = value => createHash('sha256').update(value).digest('hex');
async function request(url, options) {
  const response = await fetch(url, {...options, headers: {...(options?.headers || {}), authorization: 'Bearer owner'}});
  if (!response.ok) throw Error('P2120_EMULATOR_HTTP_' + response.status);
  return response.json();
}
async function writeFixture(relative, fields) {
  await request(sourceBase + '/' + encodePath(relative), {
    method: 'PATCH', headers: {'content-type': 'application/json'},
    body: JSON.stringify({fields})
  });
}
await writeFixture('projects/existing', {title: {stringValue: 'fixture'}});
await writeFixture('projects/existing/rooms/r1', {qty: {integerValue: '2'}});
await writeFixture('projects/missing-parent/rooms/orphan-child', {qty: {integerValue: '3'}});
await writeFixture('projects/missing-parent/rooms/orphan-child/notes/n1', {ok: {booleanValue: true}});
const missing = await fetch(sourceBase + '/projects/missing-parent', {headers: {authorization: 'Bearer owner'}});
assert.equal(missing.status, 404, 'missing parent must not be materialized');
const prefix = 'projects/' + sourceProject + '/databases/(default)/documents/';
const rows = [];
await crawlFirestore({
  listCollections: async parent => {
    const url = sourceBase + (parent ? '/' + encodePath(parent) : '') + ':listCollectionIds';
    const data = await request(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({pageSize: 200})});
    return data.collectionIds || [];
  },
  listDocuments: async (collection, cursor) => {
    return request(sourceBase + '/' + encodePath(collection) + '?' + listDocumentsQuery(cursor));
  },
  documentPath: (document, collection) => {
    assert.ok(document.name?.startsWith(prefix), 'source project mismatch');
    const relative = document.name.slice(prefix.length);
    assert.ok(relative.startsWith(collection + '/'), 'collection mismatch');
    return relative;
  },
  onCollection: async () => {},
  onDocument: async document => { rows.push(document); }
});
const expected = [
  'projects/existing',
  'projects/existing/rooms/r1',
  'projects/missing-parent/rooms/orphan-child',
  'projects/missing-parent/rooms/orphan-child/notes/n1'
].sort();
assert.deepEqual(rows.map(x => x.name.slice(prefix.length)).sort(), expected, 'missing-parent traversal parity');
const plain = Buffer.from(rows.map(document => JSON.stringify({document})).join('\n') + '\n');
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const key = randomBytes(32), iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
const manifest = {
  format: 'HNL-QLTC-P2115-FIRESTORE-V1', project: sourceProject,
  documents: rows.length, plaintextBytes: plain.length, plaintextSha256: sha(plain),
  encryptedBytes: encrypted.length, encryptedSha256: sha(encrypted),
  wrappedKeyBase64: publicEncrypt({key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING}, key).toString('base64'),
  ivBase64: iv.toString('base64'), tagBase64: cipher.getAuthTag().toString('base64')
};
key.fill(0);
const decrypted = decryptSnapshot({encrypted, manifest, privateKeyPem: privateKey});
assert.deepEqual(decrypted.map(x => x.path).sort(), expected);
const parity = await restoreToEmptyEmulator({host, targetProject, documents: decrypted});
assert.deepEqual(parity, inventory(decrypted), 'real emulator restore/readback inventory');
const restoredMissing = await fetch(endpoint(targetProject) + '/projects/missing-parent', {headers: {authorization: 'Bearer owner'}});
assert.equal(restoredMissing.status, 404, 'restore must not create missing parent');
const restoredChild = await fetch(endpoint(targetProject) + '/projects/missing-parent/rooms/orphan-child', {headers: {authorization: 'Bearer owner'}});
assert.equal(restoredChild.status, 200, 'orphan child must be restored');
await assert.rejects(
  () => restoreToEmptyEmulator({host, targetProject, documents: decrypted}),
  /RESTORE_TARGET_NOT_EMPTY/, 'must reject second restore into populated emulator'
);
console.log(JSON.stringify({status: 'P2120_REAL_FIRESTORE_EMULATOR_RESTORE_PASS', synthetic: true, documents: parity.documents, inventorySha256: parity.sha256, orphanChild: true, emptyTargetGate: true}));
