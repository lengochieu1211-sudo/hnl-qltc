// HNL QLTC R2 Gateway. No Firebase service-account secret is stored here.
// The browser sends its Firebase ID token; Firestore REST verifies that token and
// the existing project/member documents are used to enforce VIEWER/EDITOR/ADMIN.

const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
});

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : (allowed.includes('*') ? '*' : '');
  return allowOrigin ? {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-HNL-Metadata',
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  } : {};
}

function decodeJwtPayload(token) {
  try {
    const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = body + '='.repeat((4 - body.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

function fieldString(doc, name) { return String(doc?.fields?.[name]?.stringValue || ''); }
function fieldBool(doc, name, fallback = true) {
  const value = doc?.fields?.[name]?.booleanValue;
  return typeof value === 'boolean' ? value : fallback;
}

async function firestoreGet(env, token, documentPath) {
  const project = env.FIREBASE_PROJECT_ID || 'com-example-qlct-61329';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/${documentPath}`;
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function getRole(env, token, projectId) {
  const payload = decodeJwtPayload(token);
  const uid = String(payload?.user_id || payload?.sub || '');
  const email = String(payload?.email || '').toLowerCase();
  if (!uid || !email) return { ok: false, role: '' };

  const projectResp = await firestoreGet(env, token, `projects/${encodeURIComponent(projectId)}`);
  if (!projectResp.ok) return { ok: false, role: '' };
  const projectDoc = await projectResp.json();

  const superAdmin = String(env.SUPER_ADMIN_EMAIL || '').toLowerCase();
  if (superAdmin && email === superAdmin) return { ok: true, role: 'ADMIN' };
  if (fieldString(projectDoc, 'ownerUid') === uid || fieldString(projectDoc, 'ownerEmail').toLowerCase() === email) {
    return { ok: true, role: 'ADMIN' };
  }

  // Canonical email is authoritative whenever present. UID is legacy fallback only.
  for (const memberId of [email, uid]) {
    if (!memberId) continue;
    const response = await firestoreGet(env, token, `projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`);
    if (!response.ok) continue;
    const member = await response.json();
    if (!fieldBool(member, 'active', true)) return { ok: false, role: '' };
    const role = fieldString(member, 'role').toUpperCase();
    return ['ADMIN', 'EDITOR', 'ENGINEER', 'VIEWER'].includes(role)
      ? { ok: true, role }
      : { ok: false, role: '' };
  }
  return { ok: true, role: 'VIEWER' };
}

function parseKey(key) {
  const value = String(key || '').replace(/^\/+/, '');
  const match = value.match(/^projects\/([^/]+)\/(media|floor-plans)\//);
  return match ? { key: value, projectId: match[1], area: match[2] } : null;
}

function canWrite(role, area) {
  if (area === 'floor-plans') return role === 'ADMIN';
  return role === 'ADMIN' || role === 'EDITOR' || role === 'ENGINEER';
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'hnl-qltc-r2-gateway' }, 200, cors);
    if (url.pathname !== '/v1/object') return json({ error: 'NOT_FOUND' }, 404, cors);

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json({ error: 'AUTH_REQUIRED' }, 401, cors);
    const parsed = parseKey(url.searchParams.get('key'));
    if (!parsed) return json({ error: 'INVALID_OBJECT_KEY' }, 400, cors);

    const access = await getRole(env, token, parsed.projectId);
    if (!access.ok) return json({ error: 'PROJECT_ACCESS_DENIED' }, 403, cors);

    if (request.method === 'HEAD') {
      const object = await env.HNL_QLTC_MEDIA.head(parsed.key);
      if (!object) return new Response(null, { status: 404, headers: cors });
      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag || '');
      headers.set('Content-Length', String(Number(object.size || 0)));
      headers.set('X-HNL-SHA256', String(object.customMetadata?.sha256 || ''));
      headers.set('Cache-Control', 'no-store');
      return new Response(null, { status: 200, headers });
    }

    if (request.method === 'GET') {
      const object = await env.HNL_QLTC_MEDIA.get(parsed.key);
      if (!object) return json({ error: 'OBJECT_NOT_FOUND' }, 404, cors);
      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag || '');
      headers.set('Content-Length', String(Number(object.size || 0)));
      headers.set('X-HNL-SHA256', String(object.customMetadata?.sha256 || ''));
      headers.set('Cache-Control', 'private, max-age=3600');
      return new Response(object.body, { headers });
    }

    if (request.method === 'PUT') {
      if (!canWrite(access.role, parsed.area)) return json({ error: 'WRITE_DENIED', role: access.role }, 403, cors);
      const arrayBuffer = await request.arrayBuffer();
      if (!arrayBuffer.byteLength) return json({ error: 'EMPTY_OBJECT' }, 400, cors);
      const maxBytes = Number(env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
      if (arrayBuffer.byteLength > maxBytes) return json({ error: 'OBJECT_TOO_LARGE', maxBytes }, 413, cors);
      let customMetadata = {};
      try {
        const raw = decodeURIComponent(request.headers.get('X-HNL-Metadata') || '');
        if (raw) customMetadata = JSON.parse(raw);
      } catch {}
      const sha256 = await sha256Hex(arrayBuffer);
      customMetadata = { ...customMetadata, sha256 };
      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      const object = await env.HNL_QLTC_MEDIA.put(parsed.key, arrayBuffer, {
        httpMetadata: { contentType, cacheControl: 'private,max-age=31536000,immutable' },
        customMetadata,
      });
      return json({ key: parsed.key, size: arrayBuffer.byteLength, mimeType: contentType, sha256, etag: object.httpEtag, updated: new Date().toISOString() }, 200, cors);
    }

    if (request.method === 'DELETE') {
      if (access.role !== 'ADMIN') return json({ error: 'DELETE_DENIED' }, 403, cors);
      await env.HNL_QLTC_MEDIA.delete(parsed.key);
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors);
  },
};
