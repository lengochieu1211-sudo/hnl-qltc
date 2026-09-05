import type { TeamInfo } from '../../types';
import type { AiDateRange, AiQueryContext } from '../core/contracts';
import { assertCanonicalDateRange, isCanonicalDate } from '../core/dateRange';
import { normalizeEntityText, normalizeTeamLookupText, resolveTeamReference } from '../core/entityResolver';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';
import type { HnlAiToolArgs } from '../tools/toolRegistry';

export type HnlAiIntent =
  | 'TEAM_SUMMARY'
  | 'CURRENT_TEAM_PROGRESS'
  | 'AUDIT_DEFECTS'
  | 'AUDIT_QUANTITY'
  | 'AUDIT_CREW'
  | 'AUDIT_PROJECT'
  | 'UNSUPPORTED';

export type HnlAiPlanStatus = 'ready' | 'needs-clarification' | 'unsupported';

export interface HnlAiQueryPlan {
  status: HnlAiPlanStatus;
  intent: HnlAiIntent;
  normalizedQuestion: string;
  toolCall?: HnlAiToolArgs;
  resolvedTeam?: { id: string; name: string };
  dateRange?: AiDateRange;
  clarifications: string[];
  warnings: string[];
}

export interface PlanHnlAiQuestionParams {
  question: string;
  context: AiQueryContext;
  teams: TeamInfo[];
  /** Project-local canonical date YYYY-MM-DD supplied by the caller. */
  referenceDate: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function canonicalDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${pad2(month)}-${pad2(day)}`;
  return isCanonicalDate(value) ? value : null;
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

function monthRange(referenceDate: string, offset: number): AiDateRange {
  const [y, m] = referenceDate.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 + offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return {
    from: `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-01`,
    to: `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`,
  };
}

function weekRange(referenceDate: string, offsetWeeks: number): AiDateRange {
  const [y, m, d] = referenceDate.split('-').map(Number);
  const current = new Date(Date.UTC(y, m - 1, d));
  const day = current.getUTCDay(); // 0 Sun ... 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = shiftDays(referenceDate, mondayOffset + offsetWeeks * 7);
  return { from, to: shiftDays(from, 6) };
}

function resolveNaturalDateRange(question: string, referenceDate: string): AiDateRange | null {
  assertCanonicalDateRange({ from: referenceDate, to: referenceDate });
  const normalized = normalizeEntityText(question);

  if (/\bhom nay\b/.test(normalized)) return { from: referenceDate, to: referenceDate };
  if (/\bhom qua\b/.test(normalized)) {
    const day = shiftDays(referenceDate, -1);
    return { from: day, to: day };
  }
  if (/\btuan truoc\b/.test(normalized)) return weekRange(referenceDate, -1);
  if (/\btuan nay\b/.test(normalized)) return weekRange(referenceDate, 0);
  if (/\bthang truoc\b/.test(normalized)) return monthRange(referenceDate, -1);
  if (/\bthang nay\b/.test(normalized)) return monthRange(referenceDate, 0);

  const canonicalRange = normalized.match(/(\d{4}-\d{2}-\d{2})\s*(?:den|toi|->|–|—|\s-\s)\s*(\d{4}-\d{2}-\d{2})/);
  if (canonicalRange && isCanonicalDate(canonicalRange[1]) && isCanonicalDate(canonicalRange[2])) {
    return assertCanonicalDateRange({ from: canonicalRange[1], to: canonicalRange[2] });
  }

  const slashRange = normalized.match(/(?:\btu\s+(?:ngay\s+)?)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\s*(?:den|toi|->|–|—|-)\s*(?:ngay\s+)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?/);
  if (slashRange) {
    const refYear = Number(referenceDate.slice(0, 4));
    const fromExplicitYear = slashRange[3] ? Number(slashRange[3]) : null;
    const toExplicitYear = slashRange[6] ? Number(slashRange[6]) : null;
    const fromYear = fromExplicitYear || refYear;
    let toYear = toExplicitYear || fromYear;
    const from = canonicalDate(fromYear, Number(slashRange[2]), Number(slashRange[1]));
    let to = canonicalDate(toYear, Number(slashRange[5]), Number(slashRange[4]));
    if (!from || !to) return null;
    if (!toExplicitYear && to < from) {
      toYear += 1;
      to = canonicalDate(toYear, Number(slashRange[5]), Number(slashRange[4]));
      if (!to) return null;
    }
    return assertCanonicalDateRange({ from, to });
  }

  const singleCanonical = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (singleCanonical && isCanonicalDate(singleCanonical[1])) {
    return { from: singleCanonical[1], to: singleCanonical[1] };
  }
  const singleSlash = normalized.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\b/);
  if (singleSlash) {
    const year = singleSlash[3] ? Number(singleSlash[3]) : Number(referenceDate.slice(0, 4));
    const date = canonicalDate(year, Number(singleSlash[2]), Number(singleSlash[1]));
    if (date) return { from: date, to: date };
  }

  return null;
}

function extractTeamReference(question: string, teams: TeamInfo[]): ReturnType<typeof resolveTeamReference> {
  const normalizedQuestion = normalizeEntityText(question);
  const activeTeams = teams.filter((team) => team.deletedAt === undefined || team.deletedAt === null);
  const matched = activeTeams
    .map((team) => ({ team, key: normalizeTeamLookupText(team.name) }))
    .filter(({ key }) => key && new RegExp(`(?:^|\\b)${escapeRegex(key)}(?:\\b|$)`).test(normalizedQuestion))
    .sort((a, b) => b.key.length - a.key.length);

  if (matched.length > 0) {
    const longestLength = matched[0].key.length;
    const longest = matched.filter((item) => item.key.length === longestLength);
    const uniqueIds = Array.from(new Set(longest.map((item) => item.team.id)));
    if (uniqueIds.length === 1) return resolveTeamReference(uniqueIds[0], activeTeams);
    return resolveTeamReference(longest[0].key, activeTeams);
  }

  const fallback = normalizedQuestion.match(/\b(?:doi|to)\s+(.+?)(?=\s+(?:tu|den|toi|ngay|trong|thang|tuan|hom|da|dang|lam|thi|co|bao|tong|kiem|audit|tren|tai|hien|duoc)\b|$)/);
  return resolveTeamReference(fallback?.[1]?.trim() || '', activeTeams);
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function detectIntent(question: string): HnlAiIntent {
  const q = normalizeEntityText(question);
  const auditSignal = hasAny(q, [/\bkiem tra\b/, /\baudit\b/, /\bra soat\b/, /\bbat thuong\b/, /\borphan\b/, /\bdu lieu loi\b/]);

  if (auditSignal && /\bdefect\b/.test(q)) return 'AUDIT_DEFECTS';
  if (auditSignal && hasAny(q, [/\bquan so\b/, /\bnhan cong\b/, /\bcong nhan\b/, /\bca sang\b/, /\bca chieu\b/, /\bca toi\b/])) return 'AUDIT_CREW';
  if (auditSignal && hasAny(q, [/\bkhoi luong\b/, /\bsan luong\b/, /\bprogress\b/, /\btien do >?\s*100/])) return 'AUDIT_QUANTITY';
  if (auditSignal || hasAny(q, [/\btoan bo logic\b/, /\btoan du an\b/, /\blien ket sai\b/, /\bdu lieu trung\b/])) return 'AUDIT_PROJECT';

  if (hasAny(q, [/\bdoi nao\b/, /\btop\s+\d+\s+doi\b/, /\bso sanh cac doi\b/])) return 'UNSUPPORTED';

  if (hasAny(q, [/\btong hop\b/, /\bnang suat\b/, /\bbao nhieu cong\b/, /\bbao nhieu m2\b/, /\bda lam\b/, /\bthi cong nhung hang muc\b/])) return 'TEAM_SUMMARY';
  if (hasAny(q, [/\bdang lam\b/, /\bhien tai\b/, /\btien do\b/, /\bdefect cua doi\b/])) return 'CURRENT_TEAM_PROGRESS';

  if (/\b(?:doi|to)\b/.test(q)) return 'CURRENT_TEAM_PROGRESS';
  return 'UNSUPPORTED';
}

/**
 * Deterministic pre-provider query planner for the initial whitelist. It does not call an
 * LLM and never invents IDs. Ambiguous team references or missing date ranges are returned
 * as explicit clarification requirements.
 */
export function planHnlAiQuestion(params: PlanHnlAiQuestionParams): HnlAiQueryPlan {
  const { question, context, teams, referenceDate } = params;
  const permission = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permission, context.projectId);
  assertCanonicalDateRange({ from: referenceDate, to: referenceDate });

  const normalizedQuestion = normalizeEntityText(question);
  if (!normalizedQuestion) {
    return {
      status: 'needs-clarification',
      intent: 'UNSUPPORTED',
      normalizedQuestion,
      clarifications: ['Vui lòng nhập câu hỏi.'],
      warnings: [],
    };
  }

  const intent = detectIntent(question);
  if (intent === 'AUDIT_DEFECTS') {
    return { status: 'ready', intent, normalizedQuestion, toolCall: { name: 'auditDefectLinks', args: {} }, clarifications: [], warnings: [] };
  }
  if (intent === 'AUDIT_QUANTITY') {
    return { status: 'ready', intent, normalizedQuestion, toolCall: { name: 'auditQuantityData', args: {} }, clarifications: [], warnings: [] };
  }
  if (intent === 'AUDIT_CREW') {
    return { status: 'ready', intent, normalizedQuestion, toolCall: { name: 'auditCrewData', args: {} }, clarifications: [], warnings: [] };
  }
  if (intent === 'AUDIT_PROJECT') {
    return { status: 'ready', intent, normalizedQuestion, toolCall: { name: 'auditProjectIntegrity', args: {} }, clarifications: [], warnings: [] };
  }

  if (intent === 'TEAM_SUMMARY' || intent === 'CURRENT_TEAM_PROGRESS') {
    const teamResolution = extractTeamReference(question, teams);
    if (teamResolution.status === 'ambiguous') {
      return {
        status: 'needs-clarification',
        intent,
        normalizedQuestion,
        clarifications: ['Có nhiều đội phù hợp. Hãy chọn đúng đội trước khi tiếp tục.'],
        warnings: [`Candidates: ${teamResolution.candidates.map((team) => `${team.name} (${team.id})`).join(', ')}`],
      };
    }
    if (teamResolution.status !== 'resolved' || !teamResolution.team) {
      return {
        status: 'needs-clarification',
        intent,
        normalizedQuestion,
        clarifications: ['Không xác định được đội thi công. Vui lòng nêu đúng tên đội trong dự án.'],
        warnings: [],
      };
    }

    const resolvedTeam = { id: teamResolution.team.id, name: teamResolution.team.name };
    if (intent === 'CURRENT_TEAM_PROGRESS') {
      return {
        status: 'ready',
        intent,
        normalizedQuestion,
        resolvedTeam,
        toolCall: { name: 'getCurrentTeamProgress', args: { teamRef: teamResolution.team.id } },
        clarifications: [],
        warnings: [],
      };
    }

    const dateRange = resolveNaturalDateRange(question, referenceDate);
    if (!dateRange) {
      return {
        status: 'needs-clarification',
        intent,
        normalizedQuestion,
        resolvedTeam,
        clarifications: ['Cần khoảng thời gian rõ ràng, ví dụ 01/08–15/08, tuần này hoặc tháng trước.'],
        warnings: [],
      };
    }

    return {
      status: 'ready',
      intent,
      normalizedQuestion,
      resolvedTeam,
      dateRange,
      toolCall: { name: 'getTeamSummary', args: { teamRef: teamResolution.team.id, dateRange } },
      clarifications: [],
      warnings: [],
    };
  }

  return {
    status: 'unsupported',
    intent: 'UNSUPPORTED',
    normalizedQuestion,
    clarifications: [],
    warnings: ['Câu hỏi chưa có deterministic tool tương ứng trong whitelist hiện tại; không được tự suy diễn hoặc tạo Firestore query.'],
  };
}
