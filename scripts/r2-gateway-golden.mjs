import worker from '../cloudflare/r2-gateway/worker.js';

const originalFetch = globalThis.fetch;
const objects = new Map();

function jwt(payload) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.x`;
}

const identities = {
  admin: { user_id: 'uid-admin', email: 'admin@example.com' },
  editor: { user_id: 'uid-editor', email: 'editor@example.com' },
  viewer: { user_id: 'uid-viewer', email: 'viewer@example.com' },
};

const roles = new Map([
  ['uid-editor', 'EDITOR'], ['editor@example.com', 'EDITOR'],
  ['uid-viewer', 'VIEWER'], ['viewer@example.com', 'VIEWER'],
]);

function fsDoc(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return { fields: out };
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (!url.startsWith('https://firestore.googleapis.com/')) return originalFetch(input, init);
  const token = String(init.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  let payload = null;
  try { payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch {}
  if (!payload?.user_id || !payload?.email) return new Response('unauthorized', { status: 401 });
  if (/\/documents\/projects\/p1$/.test(url)) {
    return Response.json(fsDoc({ ownerUid: 'uid-admin', ownerEmail: 'admin@example.com' }));
  }
  const memberMatch = url.match(/\/members\/([^/?]+)$/);
  if (memberMatch) {
    const id = decodeURIComponent(memberMatch[1]);
    const role = roles.get(id);
    if (!role) return new Response('missing', { status: 404 });
    return Response.json(fsDoc({ role, active: true }));
  }
  return new Response('missing', { status: 404 });
};

const env = {
  FIREBASE_PROJECT_ID: 'com-example-qlct-61329',
  SUPER_ADMIN_EMAIL: 'super@example.com',
  ALLOWED_ORIGINS: 'https://hnlqltc.web.app,https://com-example-qlct-61329.web.app,https://com-example-qlct-61329.firebaseapp.com',
  MAX_UPLOAD_BYTES: '26214400',
  HNL_QLTC_MEDIA: {
    async put(key, body, options) {
      objects.set(key, { body: new Uint8Array(body), options });
      return { httpEtag: '"golden-etag"' };
    },
    async head(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.body.byteLength,
        customMetadata: value.options?.customMetadata || {},
        httpEtag: '"golden-etag"',
        writeHttpMetadata(headers) { headers.set('Content-Type', value.options?.httpMetadata?.contentType || 'application/octet-stream'); },
      };
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        body: value.body,
        size: value.body.byteLength,
        customMetadata: value.options?.customMetadata || {},
        httpEtag: '"golden-etag"',
        writeHttpMetadata(headers) { headers.set('Content-Type', value.options?.httpMetadata?.contentType || 'application/octet-stream'); },
      };
    },
    async delete(key) { objects.delete(key); },
  },
};

async function call(identity, method, key, body = null) {
  const token = jwt(identity);
  return worker.fetch(new Request(`https://gateway.example/v1/object?key=${encodeURIComponent(key)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://hnlqltc.web.app',
      ...(body ? { 'Content-Type': 'image/jpeg', 'X-HNL-Metadata': encodeURIComponent(JSON.stringify({ projectId: 'p1' })) } : {}),
    },
    body,
  }), env);
}

function assert(ok, message) { if (!ok) throw new Error(`R2 GOLDEN FAIL: ${message}`); console.log(`PASS R2: ${message}`); }

const mediaKey = 'projects/p1/media/defect/d1/a1/original.jpg';
const floorKey = 'projects/p1/floor-plans/f1/original.jpg';

let response = await call(identities.editor, 'PUT', mediaKey, new Uint8Array([1, 2, 3]));
assert(response.status === 200, 'EDITOR may upload operational media');
response = await call(identities.viewer, 'HEAD', mediaKey);
assert(response.status === 200, 'VIEWER/project member may HEAD media durability');
assert(Number(response.headers.get('Content-Length')) === 3, 'HEAD exposes durable object size');
assert(Boolean(response.headers.get('X-HNL-SHA256')), 'HEAD exposes stored SHA-256');
response = await call(identities.editor, 'PUT', floorKey, new Uint8Array([4, 5]));
assert(response.status === 403, 'EDITOR may not upload floor-plan structure');
response = await call(identities.viewer, 'PUT', mediaKey, new Uint8Array([6]));
assert(response.status === 403, 'VIEWER may not upload media');
roles.set('uid-editor', 'ADMIN');
roles.set('editor@example.com', 'VIEWER');
response = await call(identities.editor, 'PUT', mediaKey, new Uint8Array([6, 7]));
assert(response.status === 403, 'canonical email VIEWER overrides stale UID ADMIN');
roles.set('uid-editor', 'EDITOR');
roles.set('editor@example.com', 'EDITOR');
response = await call(identities.admin, 'PUT', floorKey, new Uint8Array([7, 8]));
assert(response.status === 200, 'ADMIN/owner may upload floor-plan structure');
response = await call(identities.viewer, 'GET', mediaKey);
assert(response.status === 200, 'VIEWER/project member may read media');
assert(response.headers.get('Access-Control-Allow-Origin') === 'https://hnlqltc.web.app', 'CORS allows the new hnlqltc Hosting origin');
response = await call(identities.editor, 'DELETE', mediaKey);
assert(response.status === 403, 'EDITOR may not purge media');
response = await call(identities.admin, 'DELETE', mediaKey);
assert(response.status === 200, 'ADMIN/owner may purge media');

console.log('R2 GATEWAY GOLDEN PASS');
globalThis.fetch = originalFetch;
