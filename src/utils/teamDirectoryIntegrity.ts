import type { TeamInfo } from '../types';

export interface TeamNameConflict {
  normalizedName: string;
  displayName: string;
  previousCount: number;
  nextCount: number;
}

export const normalizeTeamDirectoryName = (value?: string): string =>
  String(value || '').trim().toLocaleLowerCase('vi-VN');

const countTeamNames = (teams: TeamInfo[]): Map<string, { count: number; displayName: string }> => {
  const counts = new Map<string, { count: number; displayName: string }>();
  teams.forEach((team) => {
    const normalizedName = normalizeTeamDirectoryName(team.name);
    if (!normalizedName) return;
    const existing = counts.get(normalizedName);
    counts.set(normalizedName, {
      count: (existing?.count || 0) + 1,
      displayName: existing?.displayName || team.name.trim(),
    });
  });
  return counts;
};

/**
 * Reject only conflicts introduced or worsened by the proposed update.
 * Existing legacy duplicates are not silently rewritten or deleted; users can reduce
 * them progressively, while new writes can no longer create additional ambiguity.
 */
export function findWorsenedTeamNameConflict(
  previousTeams: TeamInfo[],
  nextTeams: TeamInfo[],
): TeamNameConflict | null {
  const previousCounts = countTeamNames(previousTeams);
  const nextCounts = countTeamNames(nextTeams);

  for (const [normalizedName, next] of nextCounts.entries()) {
    if (next.count <= 1) continue;
    const previousCount = previousCounts.get(normalizedName)?.count || 0;
    if (next.count > previousCount) {
      return {
        normalizedName,
        displayName: next.displayName,
        previousCount,
        nextCount: next.count,
      };
    }
  }
  return null;
}

/** Resolve a legacy display name only when it identifies exactly one current team. */
export function resolveUniqueTeamByDirectoryName(
  teams: TeamInfo[],
  displayName?: string,
): TeamInfo | undefined {
  const key = normalizeTeamDirectoryName(displayName);
  if (!key) return undefined;
  const matches = teams.filter((team) => normalizeTeamDirectoryName(team.name) === key);
  return matches.length === 1 ? matches[0] : undefined;
}
