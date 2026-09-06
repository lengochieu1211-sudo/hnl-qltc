import { assertCanonicalDateRange } from '../core/dateRange';
import { HNL_AI_TOOL_NAMES, type HnlAiToolArgs, type HnlAiToolName } from './toolRegistry';

export class HnlAiToolValidationError extends Error {
  constructor(
    public readonly code: 'INVALID_TOOL_CALL' | 'TOOL_NOT_ALLOWED' | 'INVALID_TOOL_ARGS',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HnlAiToolValidationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', `${label} chứa field không được whitelist.`, { unknownKeys: unknown });
  }
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  const text = String(value ?? '').trim();
  if (!text) throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', `Thiếu ${field}.`, { field });
  if (text.length > maxLength) {
    throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', `${field} vượt giới hạn ${maxLength} ký tự.`, { field, length: text.length });
  }
  return text;
}

function emptyArgs(value: unknown, tool: HnlAiToolName): Record<string, never> {
  if (!isPlainObject(value)) {
    throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', `${tool}.args phải là object rỗng.`);
  }
  assertExactKeys(value, [], `${tool}.args`);
  return {};
}

/**
 * Boundary validator for future provider/function-calling input. It accepts unknown JSON
 * and returns only a typed whitelist request. No Firestore path, JS expression or extra
 * argument survives this boundary.
 */
export function validateHnlAiToolCall(input: unknown): HnlAiToolArgs {
  if (!isPlainObject(input)) {
    throw new HnlAiToolValidationError('INVALID_TOOL_CALL', 'Tool call phải là JSON object.');
  }
  assertExactKeys(input, ['name', 'args'], 'tool call');
  const name = String(input.name ?? '').trim();
  if (!(HNL_AI_TOOL_NAMES as readonly string[]).includes(name)) {
    throw new HnlAiToolValidationError('TOOL_NOT_ALLOWED', 'Tool không nằm trong whitelist HNL AI.', { name });
  }
  const toolName = name as HnlAiToolName;

  switch (toolName) {
    case 'resolveTeam': {
      if (!isPlainObject(input.args)) throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', 'resolveTeam.args phải là object.');
      assertExactKeys(input.args, ['query'], 'resolveTeam.args');
      return { name: 'resolveTeam', args: { query: requiredString(input.args.query, 'query') } };
    }
    case 'getTeamSummary': {
      if (!isPlainObject(input.args)) throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', 'getTeamSummary.args phải là object.');
      assertExactKeys(input.args, ['teamRef', 'dateRange'], 'getTeamSummary.args');
      const teamRef = requiredString(input.args.teamRef, 'teamRef');
      if (!isPlainObject(input.args.dateRange)) {
        throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', 'dateRange phải là object {from,to}.');
      }
      assertExactKeys(input.args.dateRange, ['from', 'to'], 'dateRange');
      let dateRange;
      try {
        dateRange = assertCanonicalDateRange({
          from: requiredString(input.args.dateRange.from, 'dateRange.from', 10),
          to: requiredString(input.args.dateRange.to, 'dateRange.to', 10),
        });
      } catch (error) {
        throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', 'dateRange phải dùng canonical YYYY-MM-DD và from <= to.', {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      return { name: 'getTeamSummary', args: { teamRef, dateRange } };
    }
    case 'getCurrentTeamProgress':
    case 'getCurrentTeamProgressDetail': {
      if (!isPlainObject(input.args)) throw new HnlAiToolValidationError('INVALID_TOOL_ARGS', `${toolName}.args phải là object.`);
      assertExactKeys(input.args, ['teamRef'], `${toolName}.args`);
      return { name: toolName, args: { teamRef: requiredString(input.args.teamRef, 'teamRef') } } as HnlAiToolArgs;
    }
    case 'auditDefectLinks':
    case 'auditQuantityData':
    case 'auditCrewData':
    case 'auditProjectIntegrity':
      return { name: toolName, args: emptyArgs(input.args, toolName) } as HnlAiToolArgs;
    default: {
      const neverTool: never = toolName;
      throw new HnlAiToolValidationError('TOOL_NOT_ALLOWED', 'Tool không được hỗ trợ.', { name: neverTool });
    }
  }
}
