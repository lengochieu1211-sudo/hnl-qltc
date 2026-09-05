import type { TeamInfo } from '../../types';
import type { AiToolResult } from '../core/contracts';
import {
  buildAiNarrativeContext,
  validateAiNarrativeResponse,
  type AiNarrativeContext,
  type AiNarrativeResponse,
} from '../evidence/narrativeContext';
import { planHnlAiQuestion, type HnlAiQueryPlan } from '../planning/queryPlanner';
import type { AIProvider } from '../providers/providerTypes';
import { executeHnlAiTool, type HnlAiToolRuntime } from '../tools/toolRegistry';
import { validateHnlAiToolCall } from '../tools/toolValidation';

export type AiCloudStatus = 'not-requested' | 'ok' | 'offline' | 'unavailable' | 'invalid-response';

export interface RunHnlAiQuestionParams {
  question: string;
  runtime: HnlAiToolRuntime;
  referenceDate: string;
  provider?: AIProvider;
  model?: string;
  requestNarrative?: boolean;
  cloudAvailable?: boolean;
  timeoutMs?: number;
}

export interface HnlAiOrchestratorResult {
  plan: HnlAiQueryPlan;
  toolResult?: AiToolResult<unknown>;
  narrativeContext?: AiNarrativeContext;
  narrative?: AiNarrativeResponse;
  cloudStatus: AiCloudStatus;
  provider?: string;
  model?: string;
  warnings: string[];
}

function buildProviderMessages(question: string, context: AiNarrativeContext): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        'Bạn là HNL AI Narrative Layer.',
        'Không được tạo FACT hoặc CALCULATED mới.',
        'Không được thay đổi bất kỳ số liệu nào trong facts.',
        'Chỉ trả JSON theo schema hnl-narrative-v1 với statements[].',
        'Mỗi INFERENCE phải tham chiếu supportingFactIds hoặc supportingIssueIds có thật.',
        'RECOMMENDATION phải là đề xuất, không được mô tả như dữ kiện đã xảy ra.',
        'Nếu dữ liệu không đủ, nói rõ giới hạn thay vì ước đoán.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        question,
        deterministicContext: context,
      }),
    },
  ];
}

async function requestNarrativeWithTimeout(params: {
  provider: AIProvider;
  model: string;
  question: string;
  context: AiNarrativeContext;
  timeoutMs: number;
}): Promise<{ narrative: AiNarrativeResponse; provider: string; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await params.provider.chat({
      mode: 'HNL_DATA_NARRATIVE',
      model: params.model,
      messages: buildProviderMessages(params.question, params.context),
      responseSchema: 'hnl-narrative-v1',
      timeoutMs: params.timeoutMs,
      signal: controller.signal,
    });
    if (response.structuredOutput === undefined) {
      throw new Error('AI_NARRATIVE_STRUCTURED_OUTPUT_MISSING');
    }
    return {
      narrative: validateAiNarrativeResponse(response.structuredOutput, params.context),
      provider: response.provider || params.provider.id,
      model: response.model || params.model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read-only orchestration for deterministic HNL Data/Audit questions.
 *
 * Failure isolation guarantee:
 * - Planning/tool execution happens locally first.
 * - Provider access is optional and receives only evidence-first narrative context.
 * - Provider outage/timeout/invalid output never removes or changes deterministic result.
 * - No write action or arbitrary Firestore query exists in this orchestrator.
 */
export async function runHnlAiQuestion(params: RunHnlAiQuestionParams): Promise<HnlAiOrchestratorResult> {
  const { runtime } = params;
  const activeTeams: TeamInfo[] = [...runtime.snapshot.teams].filter((team) => team.deletedAt === undefined || team.deletedAt === null);
  const plan = planHnlAiQuestion({
    question: params.question,
    context: runtime.context,
    teams: activeTeams,
    referenceDate: params.referenceDate,
  });

  if (plan.status !== 'ready' || !plan.toolCall) {
    return {
      plan,
      cloudStatus: 'not-requested',
      warnings: [...plan.warnings],
    };
  }

  // Validate even deterministic planner output through the same strict boundary that a
  // future provider tool-call would use. This prevents the two paths drifting apart.
  const validatedToolCall = validateHnlAiToolCall(plan.toolCall);
  const toolResult = executeHnlAiTool(validatedToolCall, runtime);
  const narrativeContext = buildAiNarrativeContext(toolResult);
  const baseWarnings = [...plan.warnings, ...toolResult.warnings];

  if (params.requestNarrative !== true) {
    return {
      plan,
      toolResult,
      narrativeContext,
      cloudStatus: 'not-requested',
      warnings: baseWarnings,
    };
  }

  if (params.cloudAvailable === false) {
    return {
      plan,
      toolResult,
      narrativeContext,
      cloudStatus: 'offline',
      warnings: [...baseWarnings, 'AI Cloud đang offline. Kết quả HNL Data/Audit deterministic vẫn khả dụng.'],
    };
  }

  if (!params.provider || !params.model) {
    return {
      plan,
      toolResult,
      narrativeContext,
      cloudStatus: 'unavailable',
      warnings: [...baseWarnings, 'Chưa cấu hình AI Provider/Model. Kết quả deterministic vẫn khả dụng.'],
    };
  }

  try {
    const response = await requestNarrativeWithTimeout({
      provider: params.provider,
      model: params.model,
      question: params.question,
      context: narrativeContext,
      timeoutMs: Math.max(1000, Math.min(params.timeoutMs || 20_000, 60_000)),
    });
    return {
      plan,
      toolResult,
      narrativeContext,
      narrative: response.narrative,
      cloudStatus: 'ok',
      provider: response.provider,
      model: response.model,
      warnings: baseWarnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const invalidResponse = /NARRATIVE|Fact ID|Audit Issue ID|INFERENCE|Statement|structured/i.test(message);
    return {
      plan,
      toolResult,
      narrativeContext,
      cloudStatus: invalidResponse ? 'invalid-response' : 'unavailable',
      provider: params.provider.id,
      model: params.model,
      warnings: [
        ...baseWarnings,
        `AI Provider không thể tạo phần diễn giải an toàn (${message}). Kết quả deterministic vẫn giữ nguyên.`,
      ],
    };
  }
}
