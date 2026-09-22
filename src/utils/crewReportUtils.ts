import type { CrewRecord, TeamInfo } from '../types';
import { getCrewDailyHeadcount, getCrewShiftCounts } from './crewUtils';
import { formatDateDDMMYYYY } from './dateFormatter';

export interface CrewReportProjectInput {
  projectId: string;
  projectName: string;
  records: CrewRecord[];
  teams?: TeamInfo[];
}

export interface CrewReportRow {
  projectId: string;
  projectName: string;
  date: string;
  teamKey: string;
  teamId?: string;
  teamName: string;
  leaderName?: string;
  reported: boolean;
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  dailyHeadcount: number | null;
}

export interface CrewReportDailySummary {
  date: string;
  reportedTeams: number;
  missingTeams: number;
  dailyHeadcount: number;
  morning: number;
  afternoon: number;
  evening: number;
}

const normalizeKey = (value: unknown): string => String(value || '').trim().toLocaleLowerCase('vi-VN');

export const toCrewReportDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const listCrewReportDates = (startDate: string, endDate: string): string[] => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end && dates.length < 93; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(toCrewReportDateKey(cursor));
  }
  return dates;
};

const resolveRecordTeamKey = (record: CrewRecord): string => {
  const id = String(record.teamId || '').trim();
  if (id) return `id:${id}`;
  const name = normalizeKey(record.teamName);
  return name ? `name:${name}` : `record:${record.id}`;
};

const resolveTeamKey = (team: TeamInfo): string => {
  const id = String(team.id || '').trim();
  if (id) return `id:${id}`;
  return `name:${normalizeKey(team.name)}`;
};

const maxFinite = (values: number[]): number => values.reduce((max, value) => Number.isFinite(value) ? Math.max(max, value) : max, 0);

export function buildCrewReportRows(
  projects: CrewReportProjectInput[],
  startDate: string,
  endDate: string,
): CrewReportRow[] {
  const dates = listCrewReportDates(startDate, endDate);
  if (dates.length === 0) return [];
  const dateSet = new Set(dates);
  const rows: CrewReportRow[] = [];

  for (const project of projects) {
    const records = (project.records || []).filter((record) => dateSet.has(String(record.date || '').slice(0, 10)));
    const teamDirectory = new Map<string, { teamId?: string; teamName: string; leaderName?: string }>();
    const teamNameToKey = new Map<string, string>();

    for (const team of project.teams || []) {
      if (team.deletedAt) continue;
      const key = resolveTeamKey(team);
      if (!key || key.endsWith('name:')) continue;
      const teamName = String(team.name || '').trim() || 'Đội chưa đặt tên';
      teamDirectory.set(key, {
        teamId: team.id || undefined,
        teamName,
        leaderName: String(team.leader || '').trim() || undefined,
      });
      const normalizedName = normalizeKey(teamName);
      if (normalizedName) teamNameToKey.set(normalizedName, key);
    }
    const canonicalRecordTeamKey = (record: CrewRecord): string => {
      const recordId = String(record.teamId || '').trim();
      if (recordId) return `id:${recordId}`;
      const normalizedName = normalizeKey(record.teamName);
      return teamNameToKey.get(normalizedName) || resolveRecordTeamKey(record);
    };
    for (const record of records) {
      if (record.deletedAt) continue;
      const key = canonicalRecordTeamKey(record);
      if (!teamDirectory.has(key)) {
        const teamName = String(record.teamName || '').trim() || 'Đội chưa đặt tên';
        teamDirectory.set(key, {
          teamId: record.teamId || undefined,
          teamName,
          leaderName: String(record.leaderName || '').trim() || undefined,
        });
        const normalizedName = normalizeKey(teamName);
        if (normalizedName) teamNameToKey.set(normalizedName, key);
      }
    }

    const recordsByDateTeam = new Map<string, CrewRecord[]>();
    for (const record of records) {
      if (record.deletedAt) continue;
      const date = String(record.date || '').slice(0, 10);
      const teamKey = canonicalRecordTeamKey(record);
      const key = `${date}|${teamKey}`;
      const bucket = recordsByDateTeam.get(key) || [];
      bucket.push(record);
      recordsByDateTeam.set(key, bucket);
    }

    const teams = Array.from(teamDirectory.entries()).sort((a, b) =>
      a[1].teamName.localeCompare(b[1].teamName, 'vi-VN', { numeric: true, sensitivity: 'base' })
    );

    for (const date of dates) {
      for (const [teamKey, team] of teams) {
        const bucket = recordsByDateTeam.get(`${date}|${teamKey}`) || [];
        if (bucket.length === 0) {
          rows.push({
            projectId: project.projectId,
            projectName: project.projectName,
            date,
            teamKey,
            teamId: team.teamId,
            teamName: team.teamName,
            leaderName: team.leaderName,
            reported: false,
            morning: null,
            afternoon: null,
            evening: null,
            dailyHeadcount: null,
          });
          continue;
        }

        const shifts = bucket.map(getCrewShiftCounts);
        rows.push({
          projectId: project.projectId,
          projectName: project.projectName,
          date,
          teamKey,
          teamId: team.teamId,
          teamName: team.teamName,
          leaderName: team.leaderName || bucket.find((record) => record.leaderName)?.leaderName,
          reported: true,
          morning: maxFinite(shifts.map((item) => item.morning)),
          afternoon: maxFinite(shifts.map((item) => item.afternoon)),
          evening: maxFinite(shifts.map((item) => item.evening)),
          dailyHeadcount: maxFinite(bucket.map(getCrewDailyHeadcount)),
        });
      }
    }
  }

  return rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byProject = a.projectName.localeCompare(b.projectName, 'vi-VN', { numeric: true, sensitivity: 'base' });
    if (byProject !== 0) return byProject;
    return a.teamName.localeCompare(b.teamName, 'vi-VN', { numeric: true, sensitivity: 'base' });
  });
}

export function summarizeCrewReportRows(rows: CrewReportRow[]): CrewReportDailySummary[] {
  const byDate = new Map<string, CrewReportDailySummary>();
  for (const row of rows) {
    const summary = byDate.get(row.date) || {
      date: row.date,
      reportedTeams: 0,
      missingTeams: 0,
      dailyHeadcount: 0,
      morning: 0,
      afternoon: 0,
      evening: 0,
    };
    if (row.reported) {
      summary.reportedTeams += 1;
      summary.dailyHeadcount += row.dailyHeadcount || 0;
      summary.morning += row.morning || 0;
      summary.afternoon += row.afternoon || 0;
      summary.evening += row.evening || 0;
    } else {
      summary.missingTeams += 1;
    }
    byDate.set(row.date, summary);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function filterCrewReportRows(
  rows: CrewReportRow[],
  projectId = 'all',
  teamKey = 'all',
): CrewReportRow[] {
  return rows.filter((row) =>
    (projectId === 'all' || row.projectId === projectId)
    && (teamKey === 'all' || row.teamKey === teamKey)
  );
}

const formatCount = (value: number | null, reported: boolean) => reported ? String(value ?? 0) : 'Chưa báo';

export function buildCrewReportText(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title?: string;
}): string {
  const rows = params.rows;
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort();
  const projects = Array.from(new Set(rows.map((row) => row.projectName)));
  const lines: string[] = [
    params.title || 'HNL QLTC – Báo cáo quân số',
    `Phạm vi: ${params.startDate === params.endDate ? formatDateDDMMYYYY(params.startDate) : `${formatDateDDMMYYYY(params.startDate)} → ${formatDateDDMMYYYY(params.endDate)}`}`,
    projects.length > 1 ? `Dự án: ${projects.join(' · ')}` : projects.length === 1 ? `Dự án: ${projects[0]}` : '',
    '',
  ].filter((line) => line !== '');

  for (const date of dates) {
    lines.push(`Ngày ${formatDateDDMMYYYY(date)}`);
    const dateRows = rows.filter((row) => row.date === date);
    const projectNames = Array.from(new Set(dateRows.map((row) => row.projectName)));
    for (const projectName of projectNames) {
      if (projects.length > 1) lines.push(`• ${projectName}`);
      for (const row of dateRows.filter((item) => item.projectName === projectName)) {
        if (!row.reported) {
          lines.push(`  - ${row.teamName}: Chưa báo`);
          continue;
        }
        lines.push(
          `  - ${row.teamName}: Sáng ${formatCount(row.morning, true)} | Chiều ${formatCount(row.afternoon, true)} | Tối ${formatCount(row.evening, true)} | Quân số ngày ${formatCount(row.dailyHeadcount, true)}`
        );
      }
    }
    const summary = summarizeCrewReportRows(dateRows)[0];
    if (summary) {
      lines.push(`Tổng ngày: ${summary.dailyHeadcount} người | Sáng ${summary.morning} | Chiều ${summary.afternoon} | Tối ${summary.evening} | Đã báo ${summary.reportedTeams} đội${summary.missingTeams ? ` | Chưa báo ${summary.missingTeams} đội` : ''}`);
    }
    lines.push('');
  }

  lines.push('Lưu ý: Sáng/Chiều/Tối là quân số theo ca; Quân số ngày lấy mức cao nhất của từng đội, không cộng chồng các ca.');
  return lines.join('\n').trim();
}
