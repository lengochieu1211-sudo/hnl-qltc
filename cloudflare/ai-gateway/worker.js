const SERVICE_NAME = 'HNL QLTC AI Gateway';
const DEFAULT_CF_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_BODY_BYTES = 96 * 1024;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 24000;
const MODES = new Set(['HNL_DATA_NARRATIVE', 'GENERAL_AI', 'HYBRID']);
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();

// Curated fallback is intentionally limited to text/chat models verified for the HNL
// gateway. When a provider exposes a model-list API, /v1/models refreshes from that API.
const PROVIDER_MODELS = {
  cloudflare: [
    { id: DEFAULT_CF_MODEL, displayName: 'Cloudflare Llama 3.1 8B Fast', supportsStructuredOutput: true },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Cloudflare Llama 3.3 70B Fast', supportsStructuredOutput: true },
    { id: '@cf/openai/gpt-oss-120b', displayName: 'Cloudflare GPT-OSS 120B', supportsStructuredOutput: true },
    { id: '@cf/zai-org/glm-5.3-flash', displayName: 'Cloudflare GLM 5.3 Flash · Paid', supportsStructuredOutput: true },
    { id: '@cf/zai-org/glm-5.3', displayName: 'Cloudflare GLM 5.3 · Paid', supportsStructuredOutput: true },
    { id: '@cf/zai-org/glm-5.2', displayName: 'Cloudflare GLM 5.2 · Paid', supportsStructuredOutput: true },
    { id: '@cf/zai-org/glm-4.7-flash', displayName: 'Cloudflare GLM 4.7 Flash', supportsStructuredOutput: true },
    { id: '@cf/moonshotai/kimi-k2.7-code', displayName: 'Cloudflare Kimi K2.7 Code · Paid', supportsStructuredOutput: true },
    { id: '@cf/moonshotai/kimi-k2.6', displayName: 'Cloudflare Kimi K2.6 · Paid', supportsStructuredOutput: true },
  ],
  gemini: [
    { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportsStructuredOutput: true },
    { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportsStructuredOutput: true },
    { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportsStructuredOutput: true },
    { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', supportsStructuredOutput: true },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportsStructuredOutput: true },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportsStructuredOutput: true },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportsStructuredOutput: true },
  ],
  openai: [
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', supportsStructuredOutput: true },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', supportsStructuredOutput: true },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', supportsStructuredOutput: true },
    { id: 'gpt-5.6', displayName: 'GPT-5.6', supportsStructuredOutput: true },
    { id: 'gpt-4.1', displayName: 'GPT-4.1', supportsStructuredOutput: true },
    { id: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini', supportsStructuredOutput: true },
    { id: 'gpt-4.1-nano', displayName: 'GPT-4.1 nano', supportsStructuredOutput: true },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', displayName: 'Groq GPT OSS 120B', supportsStructuredOutput: true },
    { id: 'openai/gpt-oss-20b', displayName: 'Groq GPT OSS 20B', supportsStructuredOutput: true },
    { id: 'llama-3.3-70b-versatile', displayName: 'Groq Llama 3.3 70B Versatile', supportsStructuredOutput: true },
    { id: 'llama-3.1-8b-instant', displayName: 'Groq Llama 3.1 8B Instant', supportsStructuredOutput: true },
    { id: 'groq/compound', displayName: 'Groq Compound', supportsStructuredOutput: false },
    { id: 'groq/compound-mini', displayName: 'Groq Compound Mini', supportsStructuredOutput: false },
    { id: 'qwen/qwen3.6-27b', displayName: 'Groq Qwen 3.6 27B · Preview', supportsStructuredOutput: true },
    { id: 'qwen/qwen3.8-27b', displayName: 'Groq Qwen 3.8 27B · Preview', supportsStructuredOutput: true },
  ],
  openrouter: [
    { id: 'openrouter/auto', displayName: 'OpenRouter Auto', supportsStructuredOutput: true },
    { id: 'openai/gpt-4.1-mini', displayName: 'OpenRouter GPT-4.1 mini', supportsStructuredOutput: true },
  ],
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function normalizeOrigin(value) {
  try { return new URL(String(value || '')).origin; } catch { return ''; }
}

function getEnvironment(env) {
  const value = String(env.ENVIRONMENT || 'DEV').trim().toUpperCase();
  return value === 'PROD' ? 'PROD' : 'DEV';
}

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((value) => normalizeOrigin(value.trim())).filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (configuredOrigins(env).includes(normalized)) return true;
  if (getEnvironment(env) === 'DEV') return /^https:\/\/hnl-qltc-dev--hnl-ai-[a-z0-9-]+\.web\.app$/i.test(normalized);
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

function providerKey(provider, env, byok = '') {
  if (byok) return byok;
  if (provider === 'gemini') return env.GEMINI_API_KEY || '';
  if (provider === 'openai') return env.OPENAI_API_KEY || '';
  if (provider === 'groq') return env.GROQ_API_KEY || '';
  if (provider === 'openrouter') return env.OPENROUTER_API_KEY || '';
  return '';
}

function normalizeModel(id, displayName) {
  return {
    id: String(id || '').trim(),
    displayName: String(displayName || id || '').trim(),
    supportsStructuredOutput: true,
    supportsStreaming: false,
    supportsToolCalling: false,
    supportsVision: false,
    supportsFiles: false,
  };
}

function curatedProviderCatalog(provider, env) {
  return {
    provider,
    available: providerAvailable(provider, env),
    source: 'curated',
    refreshedAt: Date.now(),
    models: (PROVIDER_MODELS[provider] || []).map((item) => ({ ...normalizeModel(item.id, item.displayName), ...item })),
  };
}

function keepOpenAiTextModel(id) {
  return /^gpt-(?:5|4\.1)/i.test(id) && !/(image|audio|realtime|transcribe|tts|search|moderation)/i.test(id);
}

function keepGroqChatModel(id) {
  return !/(whisper|orpheus|guard|tts|audio)/i.test(id);
}

function keepGeminiTextModel(id) {
  return /^gemini-/i.test(id) && !/(image|embedding|live|tts|transcribe|robotics)/i.test(id);
}

async function discoverProviderModels(provider, env, byok = '') {
  if (provider === 'cloudflare') return curatedProviderCatalog(provider, env);
  const key = providerKey(provider, env, byok);
  if (!key && provider !== 'openrouter') return curatedProviderCatalog(provider, env);
  const cacheKey = `${provider}:${byok ? 'byok' : 'managed'}`;
  const cached = modelCache.get(cacheKey);
  if (!byok && cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) return cached.value;

  try {
    let models = [];
    if (provider === 'gemini') {
      const response = await withTimeout(12000, (signal) => fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, { signal }));
      if (!response.ok) throw new Error(`GEMINI_MODELS_${response.status}`);
      const body = await response.json();
      models = (body?.models || [])
        .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
        .map((item) => ({ id: String(item.name || '').replace(/^models\//, ''), displayName: item.displayName }))
        .filter((item) => keepGeminiTextModel(item.id));
    } else if (provider === 'openai') {
      const response = await withTimeout(12000, (signal) => fetch('https://api.openai.com/v1/models', { signal, headers: { authorization: `Bearer ${key}` } }));
      if (!response.ok) throw new Error(`OPENAI_MODELS_${response.status}`);
      const body = await response.json();
      models = (body?.data || []).map((item) => ({ id: item.id, displayName: item.id })).filter((item) => keepOpenAiTextModel(item.id));
    } else if (provider === 'groq') {
      const response = await withTimeout(12000, (signal) => fetch('https://api.groq.com/openai/v1/models', { signal, headers: { authorization: `Bearer ${key}` } }));
      if (!response.ok) throw new Error(`GROQ_MODELS_${response.status}`);
      const body = await response.json();
      models = (body?.data || []).map((item) => ({ id: item.id, displayName: item.id })).filter((item) => keepGroqChatModel(item.id));
    } else if (provider === 'openrouter') {
      const headers = key ? { authorization: `Bearer ${key}` } : {};
      const response = await withTimeout(12000, (signal) => fetch('https://openrouter.ai/api/v1/models', { signal, headers }));
      if (!response.ok) throw new Error(`OPENROUTER_MODELS_${response.status}`);
      const body = await response.json();
      models = (body?.data || [])
        .filter((item) => !Array.isArray(item?.architecture?.output_modalities) || item.architecture.output_modalities.includes('text'))
        .map((item) => ({ id: item.id, displayName: item.name || item.id }))
        .slice(0, 160);
      if (!models.some((item) => item.id === 'openrouter/auto')) models.unshift({ id: 'openrouter/auto', displayName: 'OpenRouter Auto' });
    }

    const unique = Array.from(new Map(models.filter((item) => item.id).map((item) => [item.id, normalizeModel(item.id, item.displayName)])).values());
    if (unique.length === 0) throw new Error('EMPTY_MODEL_CATALOG');
    unique.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));
    const value = { provider, available: Boolean(key) || providerAvailable(provider, env), source: 'live', refreshedAt: Date.now(), models: unique };
    if (!byok) modelCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    return curatedProviderCatalog(provider, env);
  }
}

async function catalog(env, options = {}) {
  const onlyProvider = String(options.provider || '').trim().toLowerCase();
  const providers = onlyProvider && Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, onlyProvider)
    ? [onlyProvider]
    : Object.keys(PROVIDER_MODELS);
  return Promise.all(providers.map((provider) => discoverProviderModels(provider, env, provider === onlyProvider ? options.apiKey || '' : '')));
}

async function verifyFirebaseToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
  const token = match[1].trim();
  if (!token || token.length > 8192) throw Object.assign(new Error('AUTH_INVALID'), { status: 401 });
  if (!env.FIREBASE_WEB_API_KEY) throw Object.assign(new Error('AUTH_CONFIG_MISSING'), { status: 503 });
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token }),
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
  if (!providerAvailable(provider, env) && !apiKey && provider !== 'openrouter') throw Object.assign(new Error('PROVIDER_UNAVAILABLE'), { status: 503 });
  const model = safeText(input.model || PROVIDER_MODELS[provider][0].id, 180);
  if (!/^[a-zA-Z0-9@._:/-]+$/.test(model)) throw new Error('MODEL_INVALID');
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

async function assertModelAllowed(payload, env) {
  const providerCatalog = await discoverProviderModels(payload.provider, env, payload.apiKey || '');
  if (!providerCatalog.models.some((item) => item.id === payload.model)) throw new Error('MODEL_NOT_AVAILABLE');
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

function extractText(result) {
  if (typeof result === 'string') return result.trim();
  const direct = [result?.response, result?.result?.response, result?.result?.text, result?.text, result?.output_text]
    .find((value) => typeof value === 'string' && value.trim());
  if (direct) return String(direct).trim();
  const choice = result?.choices?.[0]?.message?.content;
  if (typeof choice === 'string' && choice.trim()) return choice.trim();
  if (Array.isArray(result?.result) && result.result.length) return result.result.map((item) => item?.text || item?.response || '').join('').trim();
  return '';
}

async function callCloudflareAI(env, payload) {
  const started = Date.now();
  const result = await env.AI.run(payload.model, {
    messages: payload.messages,
    max_tokens: 1800,
    temperature: payload.responseSchema ? 0.1 : 0.3,
  });
  const text = extractText(result);
  if (!text) throw Object.assign(new Error('CLOUDFLARE_EMPTY_RESPONSE'), { status: 502 });
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
  const text = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error(`${provider.toUpperCase()}_EMPTY_RESPONSE`);
  return {
    provider, model: payload.model, text,
    structuredOutput: payload.responseSchema ? parseStructured(text) : undefined,
    usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens, totalTokens: body?.usage?.total_tokens },
    latencyMs: Date.now() - started,
  };
}

async function callOpenAiResponses(env, payload) {
  const started = Date.now();
  const apiKey = payload.apiKey || env.OPENAI_API_KEY;
  const instructions = payload.messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n');
  const input = payload.messages.filter((item) => item.role !== 'system').map((item) => ({ role: item.role, content: item.content }));
  const response = await withTimeout(45000, (signal) => fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: payload.model,
      ...(instructions ? { instructions } : {}),
      input,
      store: false,
      ...(payload.responseSchema ? { text: { format: { type: 'json_object' } } } : {}),
    }),
  }));
  if (!response.ok) throw new Error(`OPENAI_${response.status}`);
  const body = await response.json();
  const text = (body?.output || [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE');
  return {
    provider: 'openai', model: payload.model, text,
    structuredOutput: payload.responseSchema ? parseStructured(text) : undefined,
    usage: { inputTokens: body?.usage?.input_tokens, outputTokens: body?.usage?.output_tokens, totalTokens: body?.usage?.total_tokens },
    latencyMs: Date.now() - started,
  };
}

async function callGemini(env, payload) {
  const started = Date.now();
  const apiKey = payload.apiKey || env.GEMINI_API_KEY;
  const system = payload.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = payload.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await withTimeout(30000, (signal) => fetch(endpoint, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: payload.responseSchema ? 0.1 : 0.3, ...(payload.responseSchema ? { responseMimeType: 'application/json' } : {}) },
    }),
  }));
  if (!response.ok) throw new Error(`GEMINI_${response.status}`);
  const body = await response.json();
  const text = String(body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '').trim();
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');
  return { provider: 'gemini', model: payload.model, text, structuredOutput: payload.responseSchema ? parseStructured(text) : undefined, latencyMs: Date.now() - started };
}

async function callProvider(env, payload) {
  if (payload.provider === 'cloudflare') return callCloudflareAI(env, payload);
  if (payload.provider === 'gemini') return callGemini(env, payload);
  if (payload.provider === 'openai') return callOpenAiResponses(env, payload);
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
      return json({ ok: true, service: SERVICE_NAME, environment: getEnvironment(env), firebaseProjectId: env.FIREBASE_PROJECT_ID || '', workersAi: Boolean(env.AI) }, 200, cors);
    }

    try {
      const identity = await verifyFirebaseToken(request, env);
      if (url.pathname === '/v1/models' && request.method === 'GET') {
        const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
        return json({ ok: true, providers: await catalog(env, { provider }), identity: { uid: identity.uid } }, 200, cors);
      }
      if (url.pathname === '/v1/models' && request.method === 'POST') {
        const raw = await request.text();
        if (raw.length > 4096) return json({ ok: false, error: 'BODY_TOO_LARGE' }, 413, cors);
        const input = JSON.parse(raw || '{}');
        const provider = String(input.provider || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, provider)) throw new Error('PROVIDER_NOT_ALLOWED');
        const apiKey = safeApiKey(input.apiKey);
        if (provider === 'cloudflare' && apiKey) throw new Error('BYOK_NOT_SUPPORTED_FOR_CLOUDFLARE');
        return json({ ok: true, providers: await catalog(env, { provider, apiKey }), identity: { uid: identity.uid } }, 200, cors);
      }
      if (url.pathname === '/v1/chat' && request.method === 'POST') {
        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: 'BODY_TOO_LARGE' }, 413, cors);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: 'BODY_TOO_LARGE' }, 413, cors);
        const payload = validateChatBody(JSON.parse(raw), env);
        await assertModelAllowed(payload, env);
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
