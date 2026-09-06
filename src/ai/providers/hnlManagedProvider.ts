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
  /** Optional BYOK credential kept only in the caller's in-memory state. */
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

type GroundedQuantity = {
  teamName: string;
  workCategory: string;
  volume: number;
  unit: string;
  records?: number;
};

function normalizeSearchText(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function normalizeQuantityUnit(value: unknown): string {
  return normalizeSearchText(value)
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\s+/g, '')
    .replace(/^metvuong$/, 'm2')
    .replace(/^metkhoi$/, 'm3');
}

function parseLocalizedQuantity(value: string): number | null {
  const raw = String(value || '').trim().replace(/\s/g, '');
  if (!raw) return null;
  let normalized = raw;
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) {
    normalized = raw.replace(/,/g, '');
  } else if (/^-?\d+,\d+$/.test(raw)) {
    normalized = raw.replace(',', '.');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseExternalHnlPayload(request: AiProviderChatRequest): { question: string; context: any } | null {
  if (request.mode !== 'GENERAL_AI') return null;
  const userMessages = request.messages.filter((message) => message.role === 'user');
  const content = String(userMessages[userMessages.length - 1]?.content || '').trim();
  if (!content.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || !parsed.hnlContext) return null;
    return { question: String(parsed.question || ''), context: parsed.hnlContext };
  } catch (_) {
    return null;
  }
}

function getCappedRows(value: any): any[] {
  return value && typeof value === 'object' && Array.isArray(value.rows) ? value.rows : [];
}

function collectGroundedQuantities(context: any): GroundedQuantity[] {
  const quantities: GroundedQuantity[] = [];
  for (const row of getCappedRows(context?.quantitySummaryByTeamAndCategory)) {
    const volume = Number(row?.volume);
    if (!Number.isFinite(volume)) continue;
    quantities.push({
      teamName: String(row?.teamName || ''),
      workCategory: String(row?.workCategory || ''),
      volume,
      unit: String(row?.unit || ''),
      records: Number(row?.records) || undefined,
    });
  }
  for (const row of getCappedRows(context?.quantityDetails)) {
    const volume = Number(row?.volume);
    if (!Number.isFinite(volume)) continue;
    quantities.push({
      teamName: String(row?.teamName || ''),
      workCategory: String(row?.workCategory || row?.item || ''),
      volume,
      unit: String(row?.unit || ''),
    });
  }
  for (const row of getCappedRows(context?.workVolumes)) {
    for (const field of ['actual', 'planned'] as const) {
      const volume = Number(row?.[field]);
      if (!Number.isFinite(volume)) continue;
      quantities.push({
        teamName: '',
        workCategory: String(row?.title || row?.category || ''),
        volume,
        unit: String(row?.unit || ''),
      });
    }
  }
  return quantities;
}

function quantityClaimIsGrounded(value: number, unit: string, evidence: GroundedQuantity[]): boolean {
  if (Math.abs(value) < 1e-9) return true;
  const normalizedUnit = normalizeQuantityUnit(unit);
  return evidence.some((item) => {
    if (normalizeQuantityUnit(item.unit) !== normalizedUnit) return false;
    const tolerance = Math.max(0.001, Math.abs(item.volume) * 0.000001);
    return Math.abs(item.volume - value) <= tolerance;
  });
}

function hasUnsupportedQuantityClaim(text: string, evidence: GroundedQuantity[]): boolean {
  const unitPattern = '(?:m²|m2|m³|m3|kg|tấn|tan|bộ|bo|cái|cai|tấm|tam|thanh|hộp|hop)';
  const pattern = new RegExp(`(-?\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d+)?|-?\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})\\b`, 'giu');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = parseLocalizedQuantity(match[1]);
    if (value === null) continue;
    if (!quantityClaimIsGrounded(value, match[2], evidence)) return true;
  }
  return false;
}

function formatGroundedNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function findTargetTeam(question: string, context: any): string | undefined {
  const rows = [
    ...getCappedRows(context?.quantitySummaryByTeamAndCategory),
    ...getCappedRows(context?.quantityDetails),
  ];
  const names = Array.from(new Set(rows.map((row) => String(row?.teamName || '').trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
  const normalizedQuestion = normalizeSearchText(question);
  return names.find((name) => normalizedQuestion.includes(normalizeSearchText(name)));
}

function looksLikeQuantityQuestion(question: string): boolean {
  const q = normalizeSearchText(question)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
  return /\b(khoi luong|san luong|m2|m3|hang muc|tung tang|theo tang)\b/.test(q);
}

function buildDeterministicQuantityAnswer(question: string, context: any): string | null {
  if (!looksLikeQuantityQuestion(question)) return null;
  const targetTeam = findTargetTeam(question, context);
  if (!targetTeam) return null;

  const detailRows = getCappedRows(context?.quantityDetails)
    .map((row) => ({
      teamName: String(row?.teamName || '').trim(),
      floorName: String(row?.floorName || '').trim(),
      roomName: String(row?.roomName || '').trim(),
      workCategory: String(row?.workCategory || row?.item || '').trim(),
      volume: Number(row?.volume),
      unit: String(row?.unit || '').trim(),
    }))
    .filter((row) => row.teamName === targetTeam && Number.isFinite(row.volume));

  const summaryRows = getCappedRows(context?.quantitySummaryByTeamAndCategory)
    .map((row) => ({
      teamName: String(row?.teamName || '').trim(),
      workCategory: String(row?.workCategory || '').trim(),
      volume: Number(row?.volume),
      unit: String(row?.unit || '').trim(),
      records: Number(row?.records) || 0,
    }))
    .filter((row) => row.teamName === targetTeam && Number.isFinite(row.volume));

  if (detailRows.length === 0 && summaryRows.length === 0) {
    return `HNL chưa có khối lượng xác thực được gắn với ${targetTeam} trong phạm vi dữ liệu bạn đã cho phép. HNL không tạo số liệu mẫu hoặc ước tính.`;
  }

  const wantsFloor = /tầng|tang|floor/i.test(question);
  if (wantsFloor && detailRows.length > 0) {
    const grouped = new Map<string, { floorName: string; workCategory: string; unit: string; volume: number; records: number }>();
    for (const row of detailRows) {
      const key = [row.floorName, row.workCategory, row.unit].join('|');
      const current = grouped.get(key) || {
        floorName: row.floorName || 'Chưa rõ tầng',
        workCategory: row.workCategory || 'Chưa rõ hạng mục',
        unit: row.unit || 'đơn vị chưa khai báo',
        volume: 0,
        records: 0,
      };
      current.volume += row.volume;
      current.records += 1;
      grouped.set(key, current);
    }
    const rows = Array.from(grouped.values()).sort((a, b) => a.floorName.localeCompare(b.floorName, 'vi') || a.workCategory.localeCompare(b.workCategory, 'vi'));
    const lines = rows.slice(0, 36).map((row) => `- ${row.floorName} · ${row.workCategory}: ${formatGroundedNumber(row.volume)} ${row.unit} (${row.records} bản ghi)`);
    return [
      `Khối lượng xác thực của ${targetTeam} theo snapshot HNL hiện tại:`,
      ...lines,
      getCappedRows(context?.quantityDetails).length > detailRows.length && context?.quantityDetails?.truncated
        ? 'Lưu ý: payload đã được giới hạn số dòng; đây là các bản ghi xác thực được gửi trong câu hỏi này, không phải số liệu ước tính.'
        : 'HNL chỉ cộng các bản ghi cùng tầng/hạng mục/đơn vị và không cộng chéo đơn vị.',
    ].join('\n');
  }

  const lines = summaryRows.slice(0, 24).map((row) => `- ${row.workCategory || 'Chưa rõ hạng mục'}: ${formatGroundedNumber(row.volume)} ${row.unit || 'đơn vị chưa khai báo'}${row.records ? ` (${row.records} bản ghi)` : ''}`);
  return [
    `Khối lượng xác thực của ${targetTeam} theo snapshot HNL hiện tại:`,
    ...lines,
    'HNL không tạo hạng mục hoặc số liệu mẫu, không cộng chéo đơn vị và không suy diễn khối lượng theo khoảng ngày khi nguồn không có lịch sử theo ngày.',
  ].join('\n');
}

function buildDeterministicTodayAnswer(request: AiProviderChatRequest): string | null {
  if (request.mode !== 'GENERAL_AI') return null;
  const last = [...request.messages].reverse().find((message) => message.role === 'user');
  const text = String(last?.content || '').trim();
  if (!text || text.startsWith('{')) return null;
  const normalized = normalizeSearchText(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
  if (!/hom nay/.test(normalized) || !/(thu may|ngay may|ngay nao)/.test(normalized)) return null;
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  return `Theo ngày giờ hiện tại của thiết bị (${timeZone}), hôm nay là ${date}.`;
}

function buildGroundedQuantityFallback(question: string, context: any, evidence: GroundedQuantity[]): string {
  const deterministic = buildDeterministicQuantityAnswer(question, context);
  if (deterministic) return deterministic;

  const summary = getCappedRows(context?.quantitySummaryByTeamAndCategory)
    .map((row) => ({
      teamName: String(row?.teamName || '').trim(),
      workCategory: String(row?.workCategory || '').trim(),
      volume: Number(row?.volume),
      unit: String(row?.unit || '').trim(),
      records: Number(row?.records) || 0,
    }))
    .filter((row) => Number.isFinite(row.volume));

  const normalizedQuestion = normalizeSearchText(question);
  const namedTeams = Array.from(new Set(summary.map((row) => row.teamName).filter(Boolean)));
  const targetTeam = namedTeams.find((name) => normalizedQuestion.includes(normalizeSearchText(name)));
  const selected = targetTeam ? summary.filter((row) => row.teamName === targetTeam) : summary;

  if (selected.length === 0) {
    const hasAnyQuantity = evidence.length > 0;
    return targetTeam
      ? `HNL đã chặn câu trả lời AI vì có số khối lượng không tồn tại trong dữ liệu được phép. Hiện chưa có khối lượng nào được gắn rõ với ${targetTeam}. Không tạo số liệu mẫu hoặc ước tính.`
      : hasAnyQuantity
        ? 'HNL đã chặn câu trả lời AI vì có số khối lượng không tồn tại trong dữ liệu được phép. Dữ liệu hiện có chưa đủ để lập báo cáo theo đội được hỏi; HNL không tự tạo số liệu mẫu hoặc ước tính.'
        : 'HNL đã chặn câu trả lời AI vì có số khối lượng không tồn tại trong dữ liệu được phép. Hiện không có dữ liệu khối lượng xác thực trong phạm vi đã chọn.';
  }

  const lines = selected.slice(0, 20).map((row) => {
    const team = row.teamName || 'Chưa gán đội';
    const category = row.workCategory || 'Chưa rõ hạng mục';
    const unit = row.unit || 'đơn vị chưa khai báo';
    return `- ${team} · ${category}: ${formatGroundedNumber(row.volume)} ${unit}${row.records ? ` (${row.records} bản ghi)` : ''}`;
  });
  return [
    'HNL đã chặn phần trả lời AI có số khối lượng không có trong dữ liệu nguồn.',
    'Khối lượng xác thực hiện có trong snapshot:',
    ...lines,
    'HNL không cộng chéo các đơn vị khác nhau và không suy diễn khối lượng theo khoảng ngày khi nguồn không có lịch sử khối lượng theo ngày.',
  ].join('\n');
}

function guardExternalHnlResponse(request: AiProviderChatRequest, text: string | undefined): string | undefined {
  if (!text) return text;
  const payload = parseExternalHnlPayload(request);
  if (!payload?.context?.quantitySummaryByTeamAndCategory && !payload?.context?.quantityDetails) return text;
  const deterministic = buildDeterministicQuantityAnswer(payload.question, payload.context);
  // Quantity questions about a named HNL team are answered from the sanitized deterministic
  // rows, not from provider prose. This prevents a model from mixing another team's valid
  // number into the requested team or inventing floor/category labels around a real number.
  if (deterministic) return deterministic;
  const evidence = collectGroundedQuantities(payload.context);
  if (!hasUnsupportedQuantityClaim(text, evidence)) return text;
  return buildGroundedQuantityFallback(payload.question, payload.context, evidence);
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

  async chat(request: AiProviderChatRequest): Promise<AiProviderChatResponse> {
    const startedAt = Date.now();
    const todayAnswer = buildDeterministicTodayAnswer(request);
    if (todayAnswer) {
      return {
        provider: 'hnl-local',
        model: 'deterministic-date',
        text: todayAnswer,
        latencyMs: Date.now() - startedAt,
        finishReason: 'stop',
      };
    }

    const hnlPayload = parseExternalHnlPayload(request);
    if (hnlPayload) {
      const quantityAnswer = buildDeterministicQuantityAnswer(hnlPayload.question, hnlPayload.context);
      if (quantityAnswer) {
        return {
          provider: 'hnl-local',
          model: 'deterministic-hnl-quantity',
          text: quantityAnswer,
          latencyMs: Date.now() - startedAt,
          finishReason: 'stop',
        };
      }
    }

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