const SERVICE_NAME = 'HNL QLTC AI Gateway';
const DEFAULT_CF_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_BODY_BYTES = 96 * 1024;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 24000;
const MODES = new Set(['HNL_DATA_NARRATIVE', 'GENERAL_AI', 'HYBRID']);

const PROVIDER_MODELS = {
  cloudflare: [
    { id: DEFAULT_CF_MODEL, displayName: 'Cloudflare Llama 3.1 8B Fast', supportsStructuredOutput: true },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Cloudflare Llama 3.3 70B Fast', supportsStructuredOutput: true },
    { id: '@cf/zai-org/glm-4.7-flash', displayName: 'Cloudflare GLM 4.7 Flash', supportsStructuredOutput: true },
    { id: '@cf/moonshotai/kimi-k2.6', displayName: 'Cloudflare Kimi K2.6', supportsStructuredOutput: true },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportsStructuredOutput: true },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportsStructuredOutput: true },
  ],
  openai: [
    { id: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini', supportsStructuredOutput: true },
    { id: 'gpt-4.1', displayName: 'GPT-4.1', supportsStructuredOutput: true },
    { id: 'gpt-4.1-nano', displayName: 'GPT-4.1 nano', supportsStructuredOutput: true },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', supportsStructuredOutput: true },
    { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', supportsStructuredOutput: true },
    { id: 'openai/gpt-oss-20b', displayName: 'GPT OSS 20B', supportsStructuredOutput: true },
    { id: 'openai/gpt-oss-120b', displayName: 'GPT OSS 120B', supportsStructuredOutput: true },
  ],
  openrouter: [
    { id: 'openai/gpt-4.1-mini', displayName: 'OpenRouter GPT-4.1 mini', supportsStructuredOutput: true },
    { id: 'google/gemini-3.8-flash', displayName: 'OpenRouter Gemini 3.8 Flash', supportsStructuredOutput: true },
    { id: 'openrouter/auto', displayName: 'OpenRouter Auto', supportsStructuredOutput: true },
  ],
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function normalizeOrigin(value) {
  try { return new URL(String(value || '')).origin; } catch { return ''; }
}

function getEnvironment(env) {
  const value = String(env.ENVIRONMENT || 'DEV').trim().toUpperCase();
  return value === 'PROD' ? 'PROD' : 'DEV';
}

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => normalizeOrigin(value.trim()))
    .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (configuredOrigins(env).includes(normalized)) return true;
  if (getEnvironment(env) === 'DEV') {
    return /^https:\/\/hnl-qltc-dev--hnl-ai-[a-z0-9-]+\.web\.app$/i.test(normalized);
  }
  return false;
}

function corsHeaders(origin, env) {
  const normalized = normalizeOrigin(origin);
  const exact = configuredOrigins(env);
  const allowed = isAllowedOrigin(origin, env) ? normalized : '';
  const fallback = exact[0] || '';
  return {
    ...(allowed || fallback ? { 'access-control-allow-origin': allowed || fallback } : {}),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function safeText(value, max = MAX_MESSAGE_CHARS) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error('INVALID_TEXT');
  return text;
}

function safeApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length < 8 || key.length > 1024 || /\s/.test(key)) throw new Error('API_KEY_INVALID');
  return key;
}

function providerAvailable(provider, env) {
  if (provider === 'cloudflare') return Boolean(env.AI);
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY);
  if (provider === 'openai') return Boolean(env.OPENAI_API_KEY);
  if (provider === 'groq') return Boolean(env.GROQ_API_KEY);
  if (provider === 'openrouter') return Boolean(env.OPENROUTER_API_KEY);
  return false;
}

function catalog(env) {
  return Object.entries(PROVIDER_MODELS).map(([provider, models]) => ({
    provider,
    available: providerAvailable(provider, env),
    models: models.map((model) => ({
      ...model,
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsFiles: false,
    })),
  }));
}

async function verifyFirebaseToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
  const token = match[1].trim();
  if (!token || token.length > 8192) throw Object.assign(new Error('AUTH_INVALID'), { status: 401 });
  if (!env.FIREBASE_WEB_API_KEY) throw Object.assign(new Error('AUTH_CONFIG_MISSING'), { status: 503 });

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  if (!response.ok) throw Object.assign(new Error('AUTH_INVALID'), { status: 401 });
  const body = await response.json();
  const user = Array.isArray(body.users) ? body.users[0] : null;
  if (!user?.localId) throw Object.assign(new Error('AUTH_INVALID'), { status: 401 });
  return { uid: String(user.localId), email: String(user.email || '').toLowerCase() };
}

function validateChatBody(input, env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_BODY');
  const provider = String(input.provider || 'cloudflare').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, provider)) throw new Error('PROVIDER_NOT_ALLOWED');
  const apiKey = safeApiKey(input.apiKey);
  if (provider === 'cloudflare' && apiKey) throw new Error('BYOK_NOT_SUPPORTED_FOR_CLOUDFLARE');
  if (!providerAvailable(provider, env) && !apiKey) throw Object.assign(new Error('PROVIDER_UNAVAILABLE'), { status: 503 });
  const model = safeText(input.model || PROVIDER_MODELS[provider][0].id, 160);
  if (!PROVIDER_MODELS[provider].some((item) => item.id === model)) throw new Error('MODEL_NOT_ALLOWED');
  const mode = String(input.mode || '').trim();
  if (!MODES.has(mode)) throw new Error('MODE_NOT_ALLOWED');
  const responseSchema = input.responseSchema == null ? undefined : safeText(input.responseSchema, 80);
  if (responseSchema && responseSchema !== 'hnl-narrative-v1') throw new Error('SCHEMA_NOT_ALLOWED');
  const projectId = safeText(input.projectId, 160);
  const role = String(input.role || '').toUpperCase();
  if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(role)) throw new Error('ROLE_INVALID');
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > MAX_MESSAGES) throw new Error('MESSAGES_INVALID');
  let totalChars = 0;
  const messages = input.messages.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('MESSAGE_INVALID');
    const roleValue = String(item.role || '');
    if (!['system', 'user', 'assistant'].includes(roleValue)) throw new Error('MESSAGE_ROLE_INVALID');
    const content = safeText(item.content);
    totalChars += content.length;
    return { role: roleValue, content };
  });
  if (totalChars > 64000) throw new Error('PROMPT_TOO_LARGE');
  return { provider, model, mode, responseSchema, projectId, role, messages, apiKey };
}

function parseStructured(text) {
  if (!text) return undefined;
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch { return undefined; }
}

async function withTimeout(ms, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fn(controller.signal); } finally { clearTimeout(timer); }
}

async function callCloudflareAI(env, payload) {
  const started = Date.now();
  const result = await env.AI.run(payload.model, {
    messages: payload.messages,
    max_tokens: 1400,
    temperature: payload.responseSchema ? 0.1 : 0.3,
  });
  const text = typeof result === 'string' ? result : String(result?.response || result?.result?.response || '');
  return { provider: 'cloudflare', model: payload.model, text, structuredOutput: payload.responseSchema ? parseStructured(text) : undefined, latencyMs: Date.now() - started };
}

async function callOpenAiCompatible(url, apiKey, provider, payload, extraHeaders = {}) {
  const started = Date.now();
  const response = await withTimeout(30000, (signal) => fetch(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      temperature: payload.responseSchema ? 0.1 : 0.3,
      ...(payload.responseSchema ? { response_format: { type: 'json_object' } } : {}),
    }),
  }));
  if (!response.ok) throw new Error(`${provider.toUpperCase()}_${response.status}`);
  const body = await response.json();
  const text = String(body?.choices?.[0]?.message?.content || '');
  return {
    provider, model: payload.model, text,
    structuredOutput: payload.responseSchema ? parseStructured(text) : undefined,
    usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens, totalTokens: body?.usage?.total_tokens },
    latencyMs: Date.now() - started,
  };
}

async function callGemini(env, payload) {
  const started = Date.now();
  const apiKey = payload.apiKey || env.GEMINI_API_KEY;
  const system = payload.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = payload.messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(30000, (signal) => fetch(endpoint, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: payload.responseSchema ? 0.1 : 0.3, ...(payload.responseSchema ? { responseMimeType: 'application/json' } : {}) },
    }),
  }));
  if (!response.ok) throw new Error(`GEMINI_${response.status}`);
  const body = await response.json();
  const text = String(body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '');
  return { provider: 'gemini', model: payload.model, text, structuredOutput: payload.responseSchema ? parseStructured(text) : undefined, latencyMs: Date.now() - started };
}

async function callProvider(env, payload) {
  if (payload.provider === 'cloudflare') return callCloudflareAI(env, payload);
  if (payload.provider === 'gemini') return callGemini(env, payload);
  if (payload.provider === 'openai') return callOpenAiCompatible('https://api.openai.com/v1/chat/completions', payload.apiKey || env.OPENAI_API_KEY, 'openai', payload);
  if (payload.provider === 'groq') return callOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', payload.apiKey || env.GROQ_API_KEY, 'groq', payload);
  if (payload.provider === 'openrouter') {
    const referer = normalizeOrigin(env.PUBLIC_APP_URL) || configuredOrigins(env)[0] || 'https://hnlqltc.web.app';
    return callOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', payload.apiKey || env.OPENROUTER_API_KEY, 'openrouter', payload, { 'HTTP-Referer': referer, 'X-Title': 'HNL QLTC AI' });
  }
  throw new Error('PROVIDER_NOT_ALLOWED');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);
    if (!isAllowedOrigin(origin, env)) return json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: SERVICE_NAME,
        environment: getEnvironment(env),
        firebaseProjectId: env.FIREBASE_PROJECT_ID || '',
        workersAi: Boolean(env.AI),
      }, 200, cors);
    }

    try {
      const identity = await verifyFirebaseToken(request, env);
      if (url.pathname === '/v1/models' && request.method === 'GET') {
        return json({ ok: true, providers: catalog(env), identity: { uid: identity.uid } }, 200, cors);
      }
      if (url.pathname === '/v1/chat' && request.method === 'POST') {
        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: 'BODY_TOO_LARGE' }, 413, cors);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'BODY_TOO_LARGE' }, 413, cors);
        const payload = validateChatBody(JSON.parse(raw), env);
        const result = await callProvider(env, payload);
        return json({ ok: true, ...result }, 200, cors);
      }
      return json({ ok: false, error: 'NOT_FOUND' }, 404, cors);
    } catch (error) {
      const status = Number(error?.status || 0) || (/AUTH_/.test(String(error?.message || '')) ? 401 : 400);
      const safe = String(error?.message || 'AI_GATEWAY_ERROR').slice(0, 120);
      return json({ ok: false, error: safe }, status, cors);
    }
  },
};
