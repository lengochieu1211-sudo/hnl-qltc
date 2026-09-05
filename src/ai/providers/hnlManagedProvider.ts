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
    return {
      provider: String(body.provider || this.provider),
      model: String(body.model || request.model),
      text: typeof body.text === 'string' ? body.text : undefined,
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
