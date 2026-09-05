import type {
  AIProvider,
  AiProviderCapabilities,
  AiProviderChatRequest,
  AiProviderChatResponse,
  AiProviderConnectionResult,
  AiProviderModelInfo,
} from './providerTypes';

export interface MockAiProviderOptions {
  id?: string;
  failChat?: boolean;
  delayMs?: number;
  structuredOutput?: unknown;
  text?: string;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('AI_PROVIDER_ABORTED'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Test-only provider. It never opens a network connection or reads an API key. */
export class MockAiProvider implements AIProvider {
  readonly id: string;
  readonly displayName = 'HNL AI Mock';

  constructor(private readonly options: MockAiProviderOptions = {}) {
    this.id = options.id || 'mock';
  }

  async listModels(): Promise<AiProviderModelInfo[]> {
    return [{
      id: 'mock-structured',
      displayName: 'Mock Structured',
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsToolCalling: false,
    }];
  }

  async chat(request: AiProviderChatRequest): Promise<AiProviderChatResponse> {
    const startedAt = Date.now();
    await wait(this.options.delayMs || 0, request.signal);
    if (this.options.failChat) throw new Error('MOCK_PROVIDER_OUTAGE');
    return {
      provider: this.id,
      model: request.model,
      text: this.options.text,
      structuredOutput: this.options.structuredOutput,
      latencyMs: Date.now() - startedAt,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
    };
  }

  async testConnection(): Promise<AiProviderConnectionResult> {
    return this.options.failChat
      ? { ok: false, provider: this.id, errorCode: 'MOCK_PROVIDER_OUTAGE', message: 'Mock provider unavailable.' }
      : { ok: true, provider: this.id, latencyMs: 0 };
  }

  getCapabilities(): AiProviderCapabilities {
    return {
      streaming: false,
      structuredOutput: true,
      toolCalling: false,
      vision: false,
      files: false,
      internet: false,
    };
  }
}
