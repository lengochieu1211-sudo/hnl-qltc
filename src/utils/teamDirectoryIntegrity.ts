import type { CrewRecord, TeamInfo } from '../types';

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
      displayName: existing?.displayName || String(team.name || '').trim(),
    });
  });
  return counts;
};

/**
 * Reject only duplicate-name ambiguity introduced or worsened by a proposed write.
 * Existing legacy duplicates are left untouched and can still be reduced progressively.
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

/** Collision-free, project-scoped ID for the automatic creation path.
 * Never rename an existing team ID or reuse a tombstone. */
export function crewAutoTeamId(name: string): string {
  const bytes = new TextEncoder().encode(normalizeTeamDirectoryName(name));
  if (!bytes.length || bytes.length > 700) throw new Error('Tên đội trống hoặc quá dài.');
  return 'team-auto-v1-' + Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

/** Form save planner. The cloud transaction is required if teams changes. */
export function planCrewLogTeamLink(
  teams: TeamInfo[], record: CrewRecord, previous: CrewRecord | undefined,
  allowCreate: boolean, candidateId: string, now: number,
): { ok: true; teams: TeamInfo[]; record: CrewRecord } | { ok: false; error: string } {
  const name = record.teamName.trim();
  const key = normalizeTeamDirectoryName(name);
  if (!key || !record.leaderName.trim()) return {ok:false,error:'Thiếu tên đội hoặc đội trưởng.'};
  if (previous && previous.teamId === record.teamId && normalizeTeamDirectoryName(previous.teamName) === key) {
    return {ok:true,teams,record}; // Do not silently relink historical logs.
  }
  const active = teams.filter(t=>t.deletedAt==null);
  const selected = record.teamId ? active.filter(t=>t.id===record.teamId) : active.filter(t=>normalizeTeamDirectoryName(t.name)===key);
  if (selected.length>1) return {ok:false,error:'Tên đội hoặc mã đội đang bị trùng. Hãy chọn đúng đội trong danh mục.'};
  if (selected.length===1) return {ok:true,teams,record:{...record,teamId:selected[0].id,teamName:selected[0].name}};
  if (record.teamId) return {ok:false,error:'Đội đã thay đổi hoặc không còn tồn tại. Hãy chọn lại đội.'};
  if (!allowCreate) return {ok:true,teams,record}; // EDITOR legacy flow; no directory write.
  if (!candidateId || teams.some(t=>t.id===candidateId)) return {ok:false,error:'Mã đội mới đã được sử dụng. Hãy kiểm tra danh mục đội.'};
  const count = record.workerCount;
  if (!Number.isFinite(count) || count<=0) return {ok:false,error:'Quân số phải lớn hơn 0.'};
  const team: TeamInfo = {id:candidateId,name,leader:record.leaderName.trim(),defaultCount:count,createdAt:now};
  return {ok:true,teams:[...teams,team],record:{...record,teamId:team.id,teamName:team.name}};
}
