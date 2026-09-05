import type { TeamInfo } from '../../types';

export type EntityResolutionStatus = 'resolved' | 'ambiguous' | 'not-found';

export interface TeamResolutionResult {
  status: EntityResolutionStatus;
  normalizedQuery: string;
  team?: TeamInfo;
  candidates: TeamInfo[];
  strategy?: 'id' | 'exact-normalized';
}

export function normalizeEntityText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Team lookup may omit a leading Vietnamese "Đội"/"Tổ" in natural language.
 * We intentionally do not do fuzzy or substring auto-resolution after normalization.
 */
export function normalizeTeamLookupText(value: unknown): string {
  return normalizeEntityText(value).replace(/^(doi|to)\s+/, '').trim();
}

export function resolveTeamReference(
  query: string,
  teams: TeamInfo[],
): TeamResolutionResult {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) {
    return { status: 'not-found', normalizedQuery: '', candidates: [] };
  }

  const byId = teams.find((team) => team.id === rawQuery);
  if (byId) {
    return {
      status: 'resolved',
      normalizedQuery: normalizeTeamLookupText(byId.name),
      team: byId,
      candidates: [byId],
      strategy: 'id',
    };
  }

  const normalizedQuery = normalizeTeamLookupText(rawQuery);
  const exact = teams.filter((team) => normalizeTeamLookupText(team.name) === normalizedQuery);
  if (exact.length === 1) {
    return {
      status: 'resolved',
      normalizedQuery,
      team: exact[0],
      candidates: exact,
      strategy: 'exact-normalized',
    };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', normalizedQuery, candidates: exact };
  }

  // Prefix/contains candidates are suggestions only. Never auto-pick a near match.
  const candidates = teams.filter((team) => {
    const name = normalizeTeamLookupText(team.name);
    return name.startsWith(normalizedQuery) || normalizedQuery.startsWith(name);
  });

  return {
    status: candidates.length > 0 ? 'ambiguous' : 'not-found',
    normalizedQuery,
    candidates,
  };
}
