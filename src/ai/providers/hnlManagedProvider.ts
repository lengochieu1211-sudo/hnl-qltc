import { auth } from '../../lib/firebase';
import type { UserRole } from '../../utils/securityUtils';
import type {
  AIProvider,
  AiProviderCapabilities,
  AiProviderChatRequest,
  AiProviderChatResponse,
  AiProviderConnectionResult,
  AiProviderModelInfo,
} from './providerTypes';

export type HnlManagedProviderId = 'cloudflare' | 'gemini' | 'openai' | 'groq' | 'openrouter';

export interface HnlManagedProviderOptions {
  gatewayUrl?: string;
  provider?: HnlManagedProviderId;
  projectId: string;
  role: UserRole;
  apiKey?: string;
}

export interface HnlManagedProviderCatalog {
  managedAvailable: boolean;
  models: AiProviderModelInfo[];
}

function envValue(name: string): string {
  const env = (import.meta as any).env || {};
  return String(env[name] || '').trim();
}

function cleanGatewayUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function currentIdToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('HNL_AI_AUTH_REQUIRED');
  return user.getIdToken(forceRefresh);
}

async function fetchGateway(url: string, init: RequestInit, retryAuth = true): Promise<Response> {
  const token = await currentIdToken(false);
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
  });
  if (response.status === 401 && retryAuth) {
    const fresh = await currentIdToken(true);
    return fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), authorization: `Bearer ${fresh}` },
    });
  }
  return response;
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function normalizeUnit(value: unknown): string {
  return normalizeText(value)
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\s+/g, '')
    .replace(/^metvuong$/, 'm2')
    .replace(/^metkhoi$/, 'm3');
}

function parseNumber(value: string): number | null {
  const raw = String(value || '').trim().replace(/\s/g, '');
  if (!raw) return null;
  let normalized = raw;
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) normalized = raw.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(raw)) normalized = raw.replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseExternalPayload(request: AiProviderChatRequest): { question: string; context: any } | null {
  if (request.mode !== 'GENERAL_AI') return null;
  const last = [...request.messages].reverse().find((message) => message.role === 'user');
  const content = String(last?.content || '').trim();
  if (!content.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed?.hnlContext) return null;
    return { question: String(parsed.question || ''), context: parsed.hnlContext };
  } catch {
    return null;
  }
}

function rows(value: any): any[] {
  return value && typeof value === 'object' && Array.isArray(value.rows) ? value.rows : [];
}

function buildDeterministicTodayAnswer(request: AiProviderChatRequest): string | null {
  if (request.mode !== 'GENERAL_AI') return null;
  const last = [...request.messages].reverse().find((message) => message.role === 'user');
  const content = String(last?.content || '').trim();
  if (!content || content.startsWith('{')) return null;
  const q = normalizeText(content);
  if (!/hom nay/.test(q) || !/(thu may|ngay may|ngay nao)/.test(q)) return null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const date = new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
  return `Theo ngày giờ hiện tại của thiết bị (${timeZone}), hôm nay là ${date}.`;
}

function targetTeam(payload: { question: string; context: any }): string {
  const requested = Array.isArray(payload.context?.requestedTeams) ? payload.context.requestedTeams : [];
  const requestedName = String(requested[0]?.name || '').trim();
  if (requestedName) return requestedName;
  const names = new Set<string>();
  for (const row of [...rows(payload.context?.quantityDetails), ...rows(payload.context?.crew)]) {
    const name = String(row?.teamName || row?.assignedTeam || '').trim();
    if (name) names.add(name);
  }
  const q = normalizeText(payload.question);
  return Array.from(names).sort((a, b) => b.length - a.length).find((name) => q.includes(normalizeText(name))) || '';
}

function supportedQuantityValues(context: any): Map<string, number[]> {
  const byUnit = new Map<string, number[]>();
  const detailRows = rows(context?.quantityDetails);
  const validationRows = rows(context?.quantityValidationTotals);
  const push = (unit: unknown, value: unknown) => {
    const number = Number(value);
    const key = normalizeUnit(unit);
    if (!key || !Number.isFinite(number)) return;
    const list = byUnit.get(key) || [];
    list.push(number);
    byUnit.set(key, list);
  };
  for (const row of detailRows) push(row?.unit, row?.volume);
  for (const row of validationRows) push(row?.unit, row?.volume);
  const totals = new Map<string, number>();
  for (const row of detailRows) {
    const number = Number(row?.volume);
    const key = normalizeUnit(row?.unit);
    if (!key || !Number.isFinite(number)) continue;
    totals.set(key, (totals.get(key) || 0) + number);
  }
  for (const [unit, total] of totals) push(unit, total);
  return byUnit;
}

function supportedCrewValues(context: any): Set<number> {
  const result = new Set<number>([0]);
  const crew = rows(context?.crew);
  const byDate = new Map<string, number>();
  for (const row of crew) {
    const candidates = [row?.morningCount, row?.afternoonCount, row?.eveningCount, row?.workerCount]
      .map(Number)
      .filter(Number.isFinite);
    for (const value of candidates) result.add(value);
    const daily = Number(row?.workerCount);
    if (Number.isFinite(daily)) byDate.set(String(row?.date || ''), (byDate.get(String(row?.date || '')) || 0) + daily);
  }
  for (const value of byDate.values()) result.add(value);
  const total = Array.from(byDate.values()).reduce((sum, value) => sum + value, 0);
  if (total > 0) result.add(total);
  return result;
}

function numericClaimsSupported(text: string, context: any): boolean {
  const quantities = supportedQuantityValues(context);
  const quantityPattern = /(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?)\s*(m²|m2|m³|m3|kg|tấn|tan|bộ|bo|cái|cai|tấm|tam|thanh|hộp|hop)\b/giu;
  let match: RegExpExecArray | null;
  while ((match = quantityPattern.exec(text)) !== null) {
    const value = parseNumber(match[1]);
    const unit = normalizeUnit(match[2]);
    if (value === null) continue;
    const supported = quantities.get(unit) || [];
    const ok = supported.some((source) => Math.abs(source - value) <= Math.max(0.001, Math.abs(source) * 0.000001));
    if (!ok) return false;
  }

  const crewValues = supportedCrewValues(context);
  const peoplePattern = /(\d+(?:[.,]\d+)?)\s*người\b/giu;
  while ((match = peoplePattern.exec(text)) !== null) {
    const value = parseNumber(match[1]);
    if (value !== null && !crewValues.has(value)) return false;
  }
  return true;
}

function entityClaimsSupported(text: string, payload: { question: string; context: any }): boolean {
  const context = payload.context;
  const expectedTeam = targetTeam(payload);
  const teamNames = new Set<string>();
  for (const item of Array.isArray(context?.teams) ? context.teams : []) {
    const name = String(item?.name || '').trim();
    if (name) teamNames.add(name);
  }
  for (const row of [...rows(context?.quantityDetails), ...rows(context?.crew)]) {
    const name = String(row?.teamName || row?.assignedTeam || '').trim();
    if (name) teamNames.add(name);
  }
  if (expectedTeam) {
    for (const name of teamNames) {
      if (normalizeText(name) !== normalizeText(expectedTeam) && normalizeText(text).includes(normalizeText(name))) return false;
    }
  }

  const floorNames = new Set<string>();
  for (const item of Array.isArray(context?.floors) ? context.floors : []) {
    const name = String(item?.name || '').trim();
    if (name) floorNames.add(normalizeText(name));
  }
  for (const row of [...rows(context?.quantityDetails), ...rows(context?.crew), ...rows(context?.rooms)]) {
    const name = String(row?.floorName || '').trim();
    if (name) floorNames.add(normalizeText(name));
  }
  const floorPattern = /\bTầng\s+(Trệt|Hầm\s*\d+|\d+|[A-Za-z0-9._-]+)\b/giu;
  let floorMatch: RegExpExecArray | null;
  while ((floorMatch = floorPattern.exec(text)) !== null) {
    const claimed = normalizeText(`Tầng ${floorMatch[1]}`);
    if (floorNames.size > 0 && !Array.from(floorNames).some((known) => known === claimed || known.includes(claimed) || claimed.includes(known))) return false;
  }
  return true;
}

function safeFallback(payload: { question: string; context: any }): string {
  const team = targetTeam(payload) || 'đội được hỏi';
  const quantityLines = rows(payload.context?.quantityValidationTotals)
    .slice(0, 24)
    .map((row) => `- ${String(row?.workCategory || 'Chưa rõ hạng mục')}: ${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(row?.volume) || 0)} ${String(row?.unit || '')}`);
  const crewLines = rows(payload.context?.crew)
    .slice(0, 24)
    .map((row) => `- ${String(row?.date || 'Chưa rõ ngày')} · ${String(row?.floorName || 'Chưa rõ tầng')}: ${Number(row?.workerCount) || 0} người`);
  return [
    `HNL đã chặn phần trả lời AI vì phát hiện số liệu hoặc nhãn không tồn tại trong dữ liệu nguồn của ${team}.`,
    quantityLines.length ? 'Khối lượng xác thực:' : '',
    ...quantityLines,
    crewLines.length ? 'Quân số xác thực:' : '',
    ...crewLines,
    'AI chỉ được phân tích và trình bày dữ liệu HNL; không được tạo tầng, đội, hạng mục hoặc số liệu mẫu.',
  ].filter(Boolean).join('\n');
}

function guardExternalHnlResponse(request: AiProviderChatRequest, text: string | undefined): string | undefined {
  if (!text) return text;
  const payload = parseExternalPayload(request);
  if (!payload) return text;
  if (!numericClaimsSupported(text, payload.context) || !entityClaimsSupported(text, payload)) return safeFallback(payload);
  return text;
}

export class HnlManagedAiProvider implements AIProvider {
  readonly id: string;
  readonly displayName = 'HNL Managed AI';
  private readonly gatewayUrl: string;
  private readonly provider: HnlManagedProviderId;
  private readonly projectId: string;
  private readonly role: UserRole;
  private readonly apiKey: string;

  constructor(options: HnlManagedProviderOptions) {
    this.gatewayUrl = cleanGatewayUrl(options.gatewayUrl || envValue('VITE_HNL_AI_GATEWAY_URL'));
    this.provider = options.provider || 'cloudflare';
    this.projectId = String(options.projectId || '').trim();
    this.role = options.role;
    this.apiKey = String(options.apiKey || '').trim();
    if (this.apiKey.length > 1024) throw new Error('HNL_AI_API_KEY_TOO_LONG');
    this.id = `hnl-managed:${this.provider}`;
    if (!this.gatewayUrl) throw new Error('HNL_AI_GATEWAY_URL_MISSING');
    if (!this.projectId) throw new Error('HNL_AI_PROJECT_ID_MISSING');
  }

  async getCatalog(signal?: AbortSignal): Promise<HnlManagedProviderCatalog> {
    const response = await fetchGateway(`${this.gatewayUrl}/v1/models`, { method: 'GET', signal });
    if (!response.ok) throw new Error(`HNL_AI_MODELS_${response.status}`);
    const body = await response.json();
    const provider = Array.isArray(body?.providers) ? body.providers.find((item: any) => item?.provider === this.provider) : null;
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

  async chat(request: AiProviderChatRequest): Promise<AiProviderChatResponse> {
    const startedAt = Date.now();
    const todayAnswer = buildDeterministicTodayAnswer(request);
    if (todayAnswer) {
      return { provider: 'hnl-local', model: 'deterministic-date', text: todayAnswer, latencyMs: Date.now() - startedAt, finishReason: 'stop' };
    }

    // HNL data questions are intentionally sent to the selected AI provider. HNL supplies
    // sanitized raw records and validates the returned narrative afterwards; it does not
    // bypass the provider with a precomputed quantity answer.
    const response = await fetchGateway(`${this.gatewayUrl}/v1/chat`, {
      method: 'POST',
      signal: request.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: this.provider,
        projectId: this.projectId,
        role: this.role,
        mode: request.mode,
        model: request.model,
        messages: request.messages,
        responseSchema: request.responseSchema,
        apiKey: this.apiKey || undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) throw new Error(String(body?.error || `HNL_AI_GATEWAY_${response.status}`));
    const rawText = typeof body.text === 'string' ? body.text : undefined;
    return {
      provider: String(body.provider || this.provider),
      model: String(body.model || request.model),
      text: guardExternalHnlResponse(request, rawText),
      structuredOutput: body.structuredOutput,
      usage: body.usage,
      latencyMs: Number(body.latencyMs || (Date.now() - startedAt)),
      finishReason: body.finishReason,
    };
  }

  async testConnection(signal?: AbortSignal): Promise<AiProviderConnectionResult> {
    const startedAt = Date.now();
    try {
      const models = await this.listModels(signal);
      return models.length > 0
        ? { ok: true, provider: this.id, latencyMs: Date.now() - startedAt }
        : { ok: false, provider: this.id, latencyMs: Date.now() - startedAt, errorCode: 'PROVIDER_UNAVAILABLE', message: 'Provider chưa sẵn sàng trên HNL AI Gateway.' };
    } catch (error) {
      return { ok: false, provider: this.id, latencyMs: Date.now() - startedAt, errorCode: 'GATEWAY_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) };
    }
  }

  getCapabilities(): AiProviderCapabilities {
    return { streaming: false, structuredOutput: true, toolCalling: false, vision: false, files: false, internet: false };
  }
}
