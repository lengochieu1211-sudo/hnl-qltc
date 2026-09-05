from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'MISSING PATTERN: {label}')
    return text.replace(old, new, 1)

# 1) Provider client: session-only BYOK + catalog status
path = Path('src/ai/providers/hnlManagedProvider.ts')
text = path.read_text(encoding='utf-8')
text = replace_once(text,
"""export interface HnlManagedProviderOptions {
  gatewayUrl?: string;
  provider?: HnlManagedProviderId;
  projectId: string;
  role: UserRole;
}
""",
"""export interface HnlManagedProviderOptions {
  gatewayUrl?: string;
  provider?: HnlManagedProviderId;
  projectId: string;
  role: UserRole;
  /** Optional BYOK credential kept only in the caller's in-memory state. */
  apiKey?: string;
}

export interface HnlManagedProviderCatalog {
  managedAvailable: boolean;
  models: AiProviderModelInfo[];
}
""", 'provider options')
text = replace_once(text,
"""  private readonly projectId: string;
  private readonly role: UserRole;
""",
"""  private readonly projectId: string;
  private readonly role: UserRole;
  private readonly apiKey: string;
""", 'provider private fields')
text = replace_once(text,
"""    this.projectId = String(options.projectId || '').trim();
    this.role = options.role;
    this.id = `hnl-managed:${this.provider}`;
""",
"""    this.projectId = String(options.projectId || '').trim();
    this.role = options.role;
    this.apiKey = String(options.apiKey || '').trim();
    if (this.apiKey.length > 1024) throw new Error('HNL_AI_API_KEY_TOO_LONG');
    this.id = `hnl-managed:${this.provider}`;
""", 'provider constructor')
old_list = """  async listModels(signal?: AbortSignal): Promise<AiProviderModelInfo[]> {
    const response = await fetchGateway(`${this.gatewayUrl}/v1/models`, { method: 'GET', signal });
    if (!response.ok) throw new Error(`HNL_AI_MODELS_${response.status}`);
    const body = await response.json();
    const provider = Array.isArray(body?.providers)
      ? body.providers.find((item: any) => item?.provider === this.provider)
      : null;
    if (!provider?.available) return [];
    return (provider.models || []).map((item: any) => ({
      id: String(item.id || ''),
      displayName: String(item.displayName || item.id || ''),
      supportsStreaming: Boolean(item.supportsStreaming),
      supportsStructuredOutput: Boolean(item.supportsStructuredOutput),
      supportsToolCalling: Boolean(item.supportsToolCalling),
      supportsVision: Boolean(item.supportsVision),
      supportsFiles: Boolean(item.supportsFiles),
    })).filter((item: AiProviderModelInfo) => item.id);
  }
"""
new_list = """  async getCatalog(signal?: AbortSignal): Promise<HnlManagedProviderCatalog> {
    const response = await fetchGateway(`${this.gatewayUrl}/v1/models`, { method: 'GET', signal });
    if (!response.ok) throw new Error(`HNL_AI_MODELS_${response.status}`);
    const body = await response.json();
    const provider = Array.isArray(body?.providers)
      ? body.providers.find((item: any) => item?.provider === this.provider)
      : null;
    const models = (provider?.models || []).map((item: any) => ({
      id: String(item.id || ''),
      displayName: String(item.displayName || item.id || ''),
      supportsStreaming: Boolean(item.supportsStreaming),
      supportsStructuredOutput: Boolean(item.supportsStructuredOutput),
      supportsToolCalling: Boolean(item.supportsToolCalling),
      supportsVision: Boolean(item.supportsVision),
      supportsFiles: Boolean(item.supportsFiles),
    })).filter((item: AiProviderModelInfo) => item.id);
    return { managedAvailable: Boolean(provider?.available), models };
  }

  async listModels(signal?: AbortSignal): Promise<AiProviderModelInfo[]> {
    const catalog = await this.getCatalog(signal);
    return catalog.managedAvailable || Boolean(this.apiKey) ? catalog.models : [];
  }
"""
text = replace_once(text, old_list, new_list, 'provider listModels')
text = replace_once(text,
"""        messages: request.messages,
        responseSchema: request.responseSchema,
""",
"""        messages: request.messages,
        responseSchema: request.responseSchema,
        apiKey: this.apiKey || undefined,
""", 'provider chat body')
path.write_text(text, encoding='utf-8')

# 2) Gateway: multiple curated models + BYOK override, never persisted/logged
path = Path('cloudflare/ai-gateway/worker.js')
text = path.read_text(encoding='utf-8')
start = text.index('const PROVIDER_MODELS = {')
end = text.index('\n};', start) + 3
new_catalog = """const PROVIDER_MODELS = {
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
};"""
text = text[:start] + new_catalog + text[end:]
text = replace_once(text,
"""function safeText(value, max = MAX_MESSAGE_CHARS) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error('INVALID_TEXT');
  return text;
}
""",
"""function safeText(value, max = MAX_MESSAGE_CHARS) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error('INVALID_TEXT');
  return text;
}

function safeApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length < 8 || key.length > 1024 || /\\s/.test(key)) throw new Error('API_KEY_INVALID');
  return key;
}
""", 'worker safeApiKey')
old_validate = """function validateChatBody(input, env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_BODY');
  const provider = String(input.provider || 'cloudflare').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, provider)) throw new Error('PROVIDER_NOT_ALLOWED');
  if (!providerAvailable(provider, env)) throw Object.assign(new Error('PROVIDER_UNAVAILABLE'), { status: 503 });
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
  return { provider, model, mode, responseSchema, projectId, role, messages };
}
"""
new_validate = """function validateChatBody(input, env) {
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
"""
text = replace_once(text, old_validate, new_validate, 'worker validateChatBody')
text = replace_once(text,
"""async function callGemini(env, payload) {
  const started = Date.now();
""",
"""async function callGemini(env, payload) {
  const started = Date.now();
  const apiKey = payload.apiKey || env.GEMINI_API_KEY;
""", 'worker gemini key var')
text = replace_once(text,
"""  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
""",
"""  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
""", 'worker gemini endpoint')
old_call_provider = """async function callProvider(env, payload) {
  if (payload.provider === 'cloudflare') return callCloudflareAI(env, payload);
  if (payload.provider === 'gemini') return callGemini(env, payload);
  if (payload.provider === 'openai') return callOpenAiCompatible('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY, 'openai', payload);
  if (payload.provider === 'groq') return callOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, 'groq', payload);
  if (payload.provider === 'openrouter') {
    const referer = normalizeOrigin(env.PUBLIC_APP_URL) || configuredOrigins(env)[0] || 'https://hnlqltc.web.app';
    return callOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, 'openrouter', payload, { 'HTTP-Referer': referer, 'X-Title': 'HNL QLTC AI' });
  }
  throw new Error('PROVIDER_NOT_ALLOWED');
}
"""
new_call_provider = """async function callProvider(env, payload) {
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
"""
text = replace_once(text, old_call_provider, new_call_provider, 'worker callProvider')
path.write_text(text, encoding='utf-8')

# 3) UI: provider selector + model selector + in-memory API field
path = Path('src/features/ai/AiAssistantPage.tsx')
text = path.read_text(encoding='utf-8')
text = replace_once(text,
"""import { HnlManagedAiProvider } from '../../ai/providers/hnlManagedProvider';
""",
"""import { HnlManagedAiProvider, type HnlManagedProviderId } from '../../ai/providers/hnlManagedProvider';
""", 'UI provider import')
marker = """function canonicalToday(timeZone: string): string {
"""
provider_meta = """const PROVIDER_META: Record<HnlManagedProviderId, { label: string; apiHint: string }> = {
  cloudflare: { label: 'Cloudflare Workers AI', apiHint: 'HNL Managed · không cần nhập API Key.' },
  gemini: { label: 'Google Gemini', apiHint: 'Có thể dùng HNL Managed hoặc nhập Gemini API Key riêng.' },
  openai: { label: 'OpenAI', apiHint: 'Có thể dùng HNL Managed hoặc nhập OpenAI API Key riêng.' },
  groq: { label: 'Groq', apiHint: 'Có thể dùng HNL Managed hoặc nhập Groq API Key riêng.' },
  openrouter: { label: 'OpenRouter', apiHint: 'Có thể dùng HNL Managed hoặc nhập OpenRouter API Key riêng.' },
};

"""
text = replace_once(text, marker, provider_meta + marker, 'UI provider meta')
text = replace_once(text,
"""  const [models, setModels] = useState<AiProviderModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [exportBusy, setExportBusy] = useState<AiExportKind | null>(null);
""",
"""  const [providerId, setProviderId] = useState<HnlManagedProviderId>('cloudflare');
  const [models, setModels] = useState<AiProviderModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [managedAvailable, setManagedAvailable] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [exportBusy, setExportBusy] = useState<AiExportKind | null>(null);
""", 'UI state')
old_provider = """  const provider = useMemo(() => {
    if (!gatewayUrl || !props.projectId) return null;
    try {
      return new HnlManagedAiProvider({ gatewayUrl, provider: 'cloudflare', projectId: props.projectId, role: props.role });
    } catch {
      return null;
    }
  }, [gatewayUrl, props.projectId, props.role]);
"""
new_provider = """  const catalogProvider = useMemo(() => {
    if (!gatewayUrl || !props.projectId) return null;
    try {
      return new HnlManagedAiProvider({ gatewayUrl, provider: providerId, projectId: props.projectId, role: props.role });
    } catch {
      return null;
    }
  }, [gatewayUrl, providerId, props.projectId, props.role]);

  const provider = useMemo(() => {
    if (!gatewayUrl || !props.projectId) return null;
    try {
      return new HnlManagedAiProvider({ gatewayUrl, provider: providerId, projectId: props.projectId, role: props.role, apiKey });
    } catch {
      return null;
    }
  }, [gatewayUrl, providerId, props.projectId, props.role, apiKey]);
"""
text = replace_once(text, old_provider, new_provider, 'UI provider memo')
old_effect = """  useEffect(() => {
    let cancelled = false;
    if (!provider || !props.online || !props.accessVerified) {
      setModels([]);
      setModel('');
      return;
    }
    provider.listModels().then((items) => {
      if (cancelled) return;
      setModels(items);
      setModel((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id || ''));
    }).catch(() => {
      if (!cancelled) { setModels([]); setModel(''); }
    });
    return () => { cancelled = true; };
  }, [provider, props.online, props.accessVerified]);
"""
new_effect = """  useEffect(() => {
    let cancelled = false;
    if (!catalogProvider || !props.online || !props.accessVerified) {
      setModels([]);
      setModel('');
      setManagedAvailable(false);
      return;
    }
    setModelsLoading(true);
    catalogProvider.getCatalog().then((catalog) => {
      if (cancelled) return;
      setManagedAvailable(catalog.managedAvailable);
      setModels(catalog.models);
      setModel((current) => current && catalog.models.some((item) => item.id === current) ? current : (catalog.models[0]?.id || ''));
    }).catch(() => {
      if (!cancelled) { setModels([]); setModel(''); setManagedAvailable(false); }
    }).finally(() => {
      if (!cancelled) setModelsLoading(false);
    });
    return () => { cancelled = true; };
  }, [catalogProvider, props.online, props.accessVerified]);

  const selectedProvider = PROVIDER_META[providerId];
  const hasSessionApiKey = providerId !== 'cloudflare' && apiKey.trim().length >= 8;
  const providerReady = Boolean(provider && model && (managedAvailable || hasSessionApiKey));
"""
text = replace_once(text, old_effect, new_effect, 'UI catalog effect')
text = replace_once(text,
"""        if (!provider || !model) throw new Error('HNL Managed AI chưa sẵn sàng.');
""",
"""        if (!provider || !model || !providerReady) throw new Error(providerId === 'cloudflare' ? 'Cloudflare HNL Managed AI chưa sẵn sàng.' : 'Provider chưa có HNL Managed API. Hãy nhập API Key riêng cho phiên này hoặc chọn provider khác.');
""", 'UI AI mode ready check')
text = replace_once(text,
"""        provider: mode === 'hybrid' ? (provider || undefined) : undefined,
        model: mode === 'hybrid' ? (model || undefined) : undefined,
""",
"""        provider: mode === 'hybrid' && providerReady ? (provider || undefined) : undefined,
        model: mode === 'hybrid' && providerReady ? (model || undefined) : undefined,
""", 'UI hybrid provider gate')
composer = """      <section className=\"rounded-2xl border border-slate-200 bg-white p-3 shadow-sm\">\n        <div className=\"flex flex-wrap gap-2 mb-3\">\n"""
provider_panel = """      <section className=\"rounded-2xl border border-slate-200 bg-white p-3 shadow-sm\">\n        {(mode === 'ai' || mode === 'hybrid') && <div className=\"mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3\">\n          <div className=\"grid grid-cols-1 sm:grid-cols-2 gap-2\">\n            <label className=\"text-[11px] font-bold text-slate-700\">Nhà cung cấp AI\n              <select value={providerId} onChange={(e) => { setProviderId(e.target.value as HnlManagedProviderId); setApiKey(''); setShowApiKey(false); setModel(''); setError(''); }} className=\"mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800\">\n                {(Object.keys(PROVIDER_META) as HnlManagedProviderId[]).map((id) => <option key={id} value={id}>{PROVIDER_META[id].label}</option>)}\n              </select>\n            </label>\n            <label className=\"text-[11px] font-bold text-slate-700\">Model\n              <select value={model} disabled={modelsLoading || models.length === 0} onChange={(e) => setModel(e.target.value)} className=\"mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 disabled:opacity-60\">\n                {modelsLoading && <option value=\"\">Đang tải model...</option>}\n                {!modelsLoading && models.length === 0 && <option value=\"\">Chưa có model</option>}\n                {models.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.id}</option>)}\n              </select>\n            </label>\n          </div>\n          {providerId !== 'cloudflare' && <div className=\"mt-2\">\n            <div className=\"flex items-center justify-between gap-2\"><label className=\"text-[11px] font-bold text-slate-700\">API Key riêng</label><span className=\"text-[10px] font-semibold text-emerald-700\">Chỉ giữ trong bộ nhớ phiên này</span></div>\n            <div className=\"mt-1 flex gap-2\">\n              <input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete=\"off\" spellCheck={false} placeholder={`Nhập ${selectedProvider.label} API Key`} className=\"min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800\" />\n              <button type=\"button\" onClick={() => setShowApiKey((value) => !value)} className=\"rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold text-slate-700\">{showApiKey ? 'Ẩn' : 'Hiện'}</button>\n              {apiKey && <button type=\"button\" onClick={() => setApiKey('')} className=\"rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700\">Xóa</button>}\n            </div>\n            <p className=\"mt-1.5 text-[10px] leading-4 text-slate-500\">{selectedProvider.apiHint} API Key bạn nhập không lưu vào Firestore, localStorage, APK/EXE hay log của HNL; tải lại ứng dụng sẽ phải nhập lại.</p>\n          </div>}\n          <div className=\"mt-2 text-[10px] font-semibold text-slate-600\">Trạng thái: {modelsLoading ? 'Đang đọc danh sách model...' : providerReady ? `${selectedProvider.label} · ${hasSessionApiKey ? 'API riêng phiên này' : 'HNL Managed'}` : providerId === 'cloudflare' ? 'HNL Managed chưa sẵn sàng' : 'Chưa có credential — nhập API Key riêng hoặc dùng HNL Managed nếu đã cấu hình'}</div>\n        </div>}\n        <div className=\"flex flex-wrap gap-2 mb-3\">\n"""
text = replace_once(text, composer, provider_panel, 'UI provider panel')
old_status = """          <div className=\"text-[10px] text-slate-500\">{mode === 'data' || mode === 'audit' ? 'Không cần AI Cloud' : model ? `HNL Managed AI · ${model}` : 'AI Cloud chưa sẵn sàng'}</div>\n"""
new_status = """          <div className=\"text-[10px] text-slate-500\">{mode === 'data' || mode === 'audit' ? 'Không cần AI Cloud' : model ? `${selectedProvider.label} · ${model} · ${hasSessionApiKey ? 'API riêng' : managedAvailable ? 'HNL Managed' : 'chưa có API'}` : 'AI Cloud chưa sẵn sàng'}</div>\n"""
text = replace_once(text, old_status, new_status, 'UI status line')
path.write_text(text, encoding='utf-8')

# 4) Gateway golden: verify BYOK uses the session key and never echoes it
path = Path('scripts/ai-gateway-golden.mjs')
text = path.read_text(encoding='utf-8')
text = replace_once(text,
"""  if (target.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
""",
"""  if (target === 'https://api.openai.com/v1/chat/completions') {
    assert.equal(init?.headers?.authorization, 'Bearer sk-user-session-key');
    const payload = JSON.parse(String(init.body || '{}'));
    assert.equal(payload.model, 'gpt-4.1-mini');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'BYOK OK' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (target.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
""", 'golden BYOK network stub')
insert_after = """  assert.equal(unavailable.status, 503);
"""
byok_test = """  assert.equal(unavailable.status, 503);

  const byok = await worker.fetch(new Request('https://gateway.test/v1/chat', {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...basePayload, provider: 'openai', model: 'gpt-4.1-mini', responseSchema: undefined, apiKey: 'sk-user-session-key' }),
  }), env);
  assert.equal(byok.status, 200);
  const byokBody = await byok.json();
  assert.equal(byokBody.ok, true);
  assert.equal(byokBody.provider, 'openai');
  assert.equal(byokBody.text, 'BYOK OK');
  assert.equal(JSON.stringify(byokBody).includes('sk-user-session-key'), false);

  const badKey = await worker.fetch(new Request('https://gateway.test/v1/chat', {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...basePayload, provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'short' }),
  }), env);
  assert.equal(badKey.status, 400);
"""
text = replace_once(text, insert_after, byok_test, 'golden BYOK tests')
path.write_text(text, encoding='utf-8')

print('AI provider/model/BYOK patch applied successfully')
