import assert from 'node:assert/strict';
import worker from '../cloudflare/ai-gateway/worker.js';

const origin = 'https://hnl-qltc-dev.web.app';
const env = {
  ENVIRONMENT: 'DEV',
  FIREBASE_PROJECT_ID: 'hnl-qltc-dev',
  FIREBASE_WEB_API_KEY: 'dev-public-web-api-key',
  ALLOWED_ORIGINS: 'https://hnl-qltc-dev.web.app,https://hnl-qltc-dev.firebaseapp.com',
  PUBLIC_APP_URL: 'https://hnl-qltc-dev.web.app',
  AI: {
    async run(model, input) {
      assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fast');
      assert.ok(Array.isArray(input.messages));
      return {
        response: JSON.stringify({
          statements: [{
            kind: 'INFERENCE',
            text: 'Có cảnh báo cần rà soát.',
            supportingFactIds: ['fact:1'],
            supportingIssueIds: [],
          }],
        }),
      };
    },
  },
};

const originalFetch = globalThis.fetch;
let identityLookupCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
    identityLookupCalls += 1;
    const payload = JSON.parse(String(init.body || '{}'));
    if (payload.idToken !== 'valid-dev-token') {
      return new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ users: [{ localId: 'uid-dev', email: 'dev@example.com' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected network request in golden: ${target}`);
};

try {
  const health = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin } }), env);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.environment, 'DEV');
  assert.equal(healthBody.firebaseProjectId, 'hnl-qltc-dev');
  assert.equal(healthBody.workersAi, true);
  assert.equal(identityLookupCalls, 0);

  const unauth = await worker.fetch(new Request('https://gateway.test/v1/models', { headers: { origin } }), env);
  assert.equal(unauth.status, 401);

  const authHeaders = { origin, authorization: 'Bearer valid-dev-token' };
  const models = await worker.fetch(new Request('https://gateway.test/v1/models', { headers: authHeaders }), env);
  assert.equal(models.status, 200);
  const modelsBody = await models.json();
  assert.equal(modelsBody.ok, true);
  const cf = modelsBody.providers.find((item) => item.provider === 'cloudflare');
  assert.equal(cf.available, true);
  assert.ok(cf.models.some((item) => item.id === '@cf/meta/llama-3.1-8b-instruct-fast'));

  // DEV preview origins are narrowly allowed only in DEV.
  const previewOrigin = 'https://hnl-qltc-dev--hnl-ai-ab12cd.web.app';
  const preview = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin: previewOrigin } }), env);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('access-control-allow-origin'), previewOrigin);
  const blocked = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(blocked.status, 403);

  // The same worker must fail closed in PROD and never inherit DEV preview CORS.
  const prodEnv = {
    ...env,
    ENVIRONMENT: 'PROD',
    FIREBASE_PROJECT_ID: 'com-example-qlct-61329',
    FIREBASE_WEB_API_KEY: 'prod-public-web-api-key',
    ALLOWED_ORIGINS: 'https://hnlqltc.web.app,https://com-example-qlct-61329.firebaseapp.com',
    PUBLIC_APP_URL: 'https://hnlqltc.web.app',
  };
  const prodHealth = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin: 'https://hnlqltc.web.app' } }), prodEnv);
  assert.equal(prodHealth.status, 200);
  const prodHealthBody = await prodHealth.json();
  assert.equal(prodHealthBody.environment, 'PROD');
  assert.equal(prodHealthBody.firebaseProjectId, 'com-example-qlct-61329');
  const prodRejectsDev = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin } }), prodEnv);
  assert.equal(prodRejectsDev.status, 403);
  const prodRejectsPreview = await worker.fetch(new Request('https://gateway.test/health', { headers: { origin: previewOrigin } }), prodEnv);
  assert.equal(prodRejectsPreview.status, 403);

  const basePayload = {
    provider: 'cloudflare',
    projectId: 'project-dev-test',
    role: 'VIEWER',
    mode: 'HNL_DATA_NARRATIVE',
    model: '@cf/meta/llama-3.1-8b-instruct-fast',
    responseSchema: 'hnl-narrative-v1',
    messages: [
      { role: 'system', content: 'Narrative only.' },
      { role: 'user', content: JSON.stringify({ facts: [{ id: 'fact:1', value: 3 }] }) },
    ],
  };

  const chat = await worker.fetch(new Request('https://gateway.test/v1/chat', {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(basePayload),
  }), env);
  assert.equal(chat.status, 200);
  const chatBody = await chat.json();
  assert.equal(chatBody.ok, true);
  assert.equal(chatBody.provider, 'cloudflare');
  assert.equal(chatBody.structuredOutput.statements[0].kind, 'INFERENCE');

  for (const invalid of [
    { ...basePayload, provider: 'arbitrary-provider' },
    { ...basePayload, model: 'arbitrary-model' },
    { ...basePayload, responseSchema: 'arbitrary-schema' },
    { ...basePayload, role: 'SUPER_ADMIN_FROM_MODEL' },
  ]) {
    const response = await worker.fetch(new Request('https://gateway.test/v1/chat', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(invalid),
    }), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }

  const unavailable = await worker.fetch(new Request('https://gateway.test/v1/chat', {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...basePayload, provider: 'openai', model: 'gpt-4.1-mini' }),
  }), env);
  assert.equal(unavailable.status, 503);

  assert.ok(identityLookupCalls >= 1);
  console.log('HNL AI Gateway Golden: PASS');
} finally {
  globalThis.fetch = originalFetch;
}
