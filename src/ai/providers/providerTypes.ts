export type AiProviderMode = 'HNL_DATA_NARRATIVE' | 'GENERAL_AI' | 'HYBRID';

export interface AiProviderModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  supportsVision?: boolean;
  supportsFiles?: boolean;
}

export interface AiProviderCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  vision: boolean;
  files: boolean;
  internet: boolean;
}

export interface AiProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiProviderChatRequest {
  mode: AiProviderMode;
  model: string;
  messages: AiProviderMessage[];
  /** Optional provider-neutral JSON schema identifier. The gateway/adapter owns provider syntax. */
  responseSchema?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AiProviderChatResponse {
  provider: string;
  model: string;
  text?: string;
  /** Parsed provider output when structured output is requested. Never trusted without local validation. */
  structuredOutput?: unknown;
  usage?: AiProviderUsage;
  latencyMs?: number;
  finishReason?: string;
}

export interface AiProviderStreamChunk {
  textDelta?: string;
  done?: boolean;
  usage?: AiProviderUsage;
}

export interface AiProviderConnectionResult {
  ok: boolean;
  provider: string;
  latencyMs?: number;
  errorCode?: string;
  message?: string;
}

/**
 * Provider-neutral contract. Business calculations, Firestore queries and RBAC must never
 * be implemented inside a provider adapter. Adapters only translate approved requests to
 * an external model service or the HNL Managed AI gateway.
 */
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  listModels(signal?: AbortSignal): Promise<AiProviderModelInfo[]>;
  chat(request: AiProviderChatRequest): Promise<AiProviderChatResponse>;
  streamChat?(request: AiProviderChatRequest): AsyncIterable<AiProviderStreamChunk>;
  testConnection(signal?: AbortSignal): Promise<AiProviderConnectionResult>;
  getCapabilities(): AiProviderCapabilities;
}
