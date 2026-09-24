import type { CrewRecord, FloorPlan, TeamInfo } from '../types';
import { getCrewDailyHeadcount, getCrewShiftCounts } from './crewUtils';
import { formatDateDDMMYYYY } from './dateFormatter';
import {
  getStructureGroupName,
  normalizeStructureGroupConfig,
  resolveFloorStructureGroupId,
  type ProjectStructureConfig,
} from './structureGroupUtils';

export interface CrewReportProjectInput {
  projectId: string;
  projectName: string;
  projectLocation?: string;
  records: CrewRecord[];
  teams?: TeamInfo[];
  floorPlans?: FloorPlan[];
  structureConfig?: ProjectStructureConfig;
}

export interface CrewReportRow {
  projectId: string;
  projectName: string;
  projectLocation?: string;
  date: string;
  structureGroupId: string;
  structureGroupName: string;
  structureGroupOrder: number;
  teamKey: string;
  teamId?: string;
  teamName: string;
  leaderName?: string;
  reported: boolean;
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  dailyHeadcount: number | null;
  floorSummary?: string;
  workCategorySummary?: string;
  workSubItemSummary?: string;
  notesSummary?: string;
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

const uniqueJoined = (values: unknown[]): string => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean)
)).join(', ');

const buildCrewWorkSummaries = (records: CrewRecord[]) => {
  const floorNames: string[] = [];
  const categories: string[] = [];
  const subItems: string[] = [];
  const notes: string[] = [];
  records.forEach((record) => {
    if (record.floorName) floorNames.push(record.floorName);
    if (record.notes) notes.push(record.notes);
    (record.floorWorks || []).forEach((work) => {
      if (work.floorName) floorNames.push(work.floorName);
      (work.categories || []).forEach((category) => {
        if (category.categoryName) categories.push(category.categoryName);
        (category.subItems || []).forEach((item) => subItems.push(item));
      });
    });
  });
  return {
    floorSummary: uniqueJoined(floorNames),
    workCategorySummary: uniqueJoined(categories),
    workSubItemSummary: uniqueJoined(subItems),
    notesSummary: uniqueJoined(notes),
  };
};

type ReportGroup = {
  id: string;
  name: string;
  order: number;
};

const PROJECT_SCOPE_GROUP: ReportGroup = { id: '__project__', name: 'Toàn dự án', order: 0 };
const MULTI_GROUP: ReportGroup = { id: '__multi__', name: 'Nhiều Khu/Khối', order: 9998 };
const UNASSIGNED_GROUP: ReportGroup = { id: '__unassigned__', name: 'Chưa xác định Khu/Khối', order: 9999 };

function buildProjectGroupResolver(project: CrewReportProjectInput) {
  const normalized = normalizeStructureGroupConfig(project.structureConfig);
  const structureEnabled = Boolean(project.structureConfig && normalized.enabled);
  const floorPlans = project.floorPlans || [];
  const floorById = new Map(floorPlans.map((floor) => [floor.id, floor] as const));
  const floorNameMap = new Map<string, FloorPlan[]>();
  floorPlans.forEach((floor) => {
    const key = normalizeKey(floor.floorName);
    const bucket = floorNameMap.get(key) || [];
    bucket.push(floor);
    floorNameMap.set(key, bucket);
  });

  const groupMeta = (id: string): ReportGroup => {
    const group = normalized.groups.find((item) => item.id === id);
    if (!group) return UNASSIGNED_GROUP;
    return {
      id: group.id,
      name: group.name,
      order: Number.isFinite(Number(group.order)) ? Number(group.order) : normalized.groups.indexOf(group),
    };
  };

  const resolveFloorGroup = (floorId?: string, floorName?: string): string | null => {
    const floor = floorId ? floorById.get(floorId) : undefined;
    if (floor) return resolveFloorStructureGroupId(floor, normalized);
    const candidates = floorName ? (floorNameMap.get(normalizeKey(floorName)) || []) : [];
    if (candidates.length === 1) return resolveFloorStructureGroupId(candidates[0], normalized);
    return null;
  };

  const resolveRecordGroup = (record: CrewRecord): ReportGroup => {
    if (!structureEnabled) return PROJECT_SCOPE_GROUP;
    const floorGroupIds = new Set<string>();
    const direct = resolveFloorGroup(record.floorId, record.floorName);
    if (direct) floorGroupIds.add(direct);
    for (const work of record.floorWorks || []) {
      const id = resolveFloorGroup(work.floorId, work.floorName);
      if (id) floorGroupIds.add(id);
    }
    if (floorGroupIds.size === 1) return groupMeta(Array.from(floorGroupIds)[0]);
    if (floorGroupIds.size > 1) return MULTI_GROUP;
    const explicit = String(record.structureGroupId || '').trim();
    if (explicit && normalized.groups.some((group) => group.id === explicit)) return groupMeta(explicit);
    return groupMeta(normalized.defaultGroupId);
  };

  return {
    normalized,
    structureEnabled,
    resolveRecordGroup,
  };
}

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
    const { structureEnabled, resolveRecordGroup } = buildProjectGroupResolver(project);
    const baseTeamDirectory = new Map<string, { teamId?: string; teamName: string; leaderName?: string }>();
    const teamNameToBaseKey = new Map<string, string>();

    for (const team of project.teams || []) {
      if (team.deletedAt) continue;
      const key = resolveTeamKey(team);
      if (!key || key.endsWith('name:')) continue;
      const teamName = String(team.name || '').trim() || 'Đội chưa đặt tên';
      baseTeamDirectory.set(key, {
        teamId: team.id || undefined,
        teamName,
        leaderName: String(team.leader || '').trim() || undefined,
      });
      const normalizedName = normalizeKey(teamName);
      if (normalizedName) teamNameToBaseKey.set(normalizedName, key);
    }

    const canonicalRecordTeamKey = (record: CrewRecord): string => {
      const recordId = String(record.teamId || '').trim();
      if (recordId) return `id:${recordId}`;
      const normalizedName = normalizeKey(record.teamName);
      return teamNameToBaseKey.get(normalizedName) || resolveRecordTeamKey(record);
    };

    type GroupTeamDirectoryValue = {
      group: ReportGroup;
      teamId?: string;
      teamName: string;
      leaderName?: string;
      baseTeamKey: string;
    };
    const groupTeamDirectory = new Map<string, GroupTeamDirectoryValue>();
    const baseTeamsWithRecords = new Set<string>();
    const recordsByDateGroupTeam = new Map<string, CrewRecord[]>();

    for (const record of records) {
      if (record.deletedAt) continue;
      const baseTeamKey = canonicalRecordTeamKey(record);
      const group = resolveRecordGroup(record);
      const scopedTeamKey = structureEnabled ? `${group.id}|${baseTeamKey}` : baseTeamKey;
      baseTeamsWithRecords.add(baseTeamKey);

      const baseTeam = baseTeamDirectory.get(baseTeamKey);
      if (!groupTeamDirectory.has(scopedTeamKey)) {
        const teamName = baseTeam?.teamName || String(record.teamName || '').trim() || 'Đội chưa đặt tên';
        groupTeamDirectory.set(scopedTeamKey, {
          group,
          baseTeamKey,
          teamId: baseTeam?.teamId || record.teamId || undefined,
          teamName,
          leaderName: baseTeam?.leaderName || String(record.leaderName || '').trim() || undefined,
        });
      }

      const date = String(record.date || '').slice(0, 10);
      const key = `${date}|${scopedTeamKey}`;
      const bucket = recordsByDateGroupTeam.get(key) || [];
      bucket.push(record);
      recordsByDateGroupTeam.set(key, bucket);
    }

    // Keep directory teams with no report in the selected range visible once, but never
    // clone them into every Khu/Khối because TeamInfo has no authoritative group field.
    for (const [baseTeamKey, team] of baseTeamDirectory.entries()) {
      if (baseTeamsWithRecords.has(baseTeamKey)) continue;
      const group = structureEnabled ? UNASSIGNED_GROUP : PROJECT_SCOPE_GROUP;
      const scopedTeamKey = structureEnabled ? `${group.id}|${baseTeamKey}` : baseTeamKey;
      groupTeamDirectory.set(scopedTeamKey, {
        group,
        baseTeamKey,
        teamId: team.teamId,
        teamName: team.teamName,
        leaderName: team.leaderName,
      });
    }

    const teams = Array.from(groupTeamDirectory.entries()).sort((a, b) => {
      const orderCmp = a[1].group.order - b[1].group.order;
      if (orderCmp !== 0) return orderCmp;
      const groupCmp = a[1].group.name.localeCompare(b[1].group.name, 'vi-VN', { numeric: true, sensitivity: 'base' });
      if (groupCmp !== 0) return groupCmp;
      return a[1].teamName.localeCompare(b[1].teamName, 'vi-VN', { numeric: true, sensitivity: 'base' });
    });

    for (const date of dates) {
      for (const [teamKey, team] of teams) {
        const bucket = recordsByDateGroupTeam.get(`${date}|${teamKey}`) || [];
        const base = {
          projectId: project.projectId,
          projectName: project.projectName,
          projectLocation: project.projectLocation,
          date,
          structureGroupId: team.group.id,
          structureGroupName: team.group.name,
          structureGroupOrder: team.group.order,
          teamKey,
          teamId: team.teamId,
          teamName: team.teamName,
          leaderName: team.leaderName,
        };
        if (bucket.length === 0) {
          rows.push({
            ...base,
            reported: false,
            morning: null,
            afternoon: null,
            evening: null,
            dailyHeadcount: null,
          });
          continue;
        }

        const shifts = bucket.map(getCrewShiftCounts);
        const workSummaries = buildCrewWorkSummaries(bucket);
        rows.push({
          ...base,
          ...workSummaries,
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
    const byGroupOrder = a.structureGroupOrder - b.structureGroupOrder;
    if (byGroupOrder !== 0) return byGroupOrder;
    const byGroup = a.structureGroupName.localeCompare(b.structureGroupName, 'vi-VN', { numeric: true, sensitivity: 'base' });
    if (byGroup !== 0) return byGroup;
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

export interface CrewReportMatrixTeam {
  teamKey: string;
  teamName: string;
  structureGroupId: string;
  structureGroupName: string;
  structureGroupOrder: number;
}

export interface CrewReportMatrixGroup {
  structureGroupId: string;
  structureGroupName: string;
  structureGroupOrder: number;
  teams: CrewReportMatrixTeam[];
}

export interface CrewReportMatrixTeamTotal {
  morning: number;
  afternoon: number;
  evening: number;
  dailyHeadcount: number;
}

export interface CrewReportMatrixDateRow {
  date: string;
  cells: Record<string, CrewReportRow>;
  totalDailyHeadcount: number;
}

export interface CrewReportProjectMatrix {
  projectId: string;
  projectName: string;
  projectLocation?: string;
  groups: CrewReportMatrixGroup[];
  teams: CrewReportMatrixTeam[];
  dates: CrewReportMatrixDateRow[];
  teamTotals: Record<string, CrewReportMatrixTeamTotal>;
  grandDailyHeadcount: number;
}

export function buildCrewReportMatrices(rows: CrewReportRow[]): CrewReportProjectMatrix[] {
  const projectOrder: string[] = [];
  const byProject = new Map<string, CrewReportRow[]>();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) projectOrder.push(row.projectId);
    const bucket = byProject.get(row.projectId) || [];
    bucket.push(row);
    byProject.set(row.projectId, bucket);
  }

  return projectOrder.map((projectId) => {
    const projectRows = byProject.get(projectId) || [];
    const first = projectRows[0];
    const teamMap = new Map<string, CrewReportMatrixTeam>();
    const dateSet = new Set<string>();
    projectRows.forEach((row) => {
      teamMap.set(row.teamKey, {
        teamKey: row.teamKey,
        teamName: row.teamName,
        structureGroupId: row.structureGroupId,
        structureGroupName: row.structureGroupName,
        structureGroupOrder: row.structureGroupOrder,
      });
      dateSet.add(row.date);
    });
    const teams = Array.from(teamMap.values()).sort((a, b) => {
      const orderCmp = a.structureGroupOrder - b.structureGroupOrder;
      if (orderCmp !== 0) return orderCmp;
      const groupCmp = a.structureGroupName.localeCompare(b.structureGroupName, 'vi-VN', { numeric: true, sensitivity: 'base' });
      if (groupCmp !== 0) return groupCmp;
      return a.teamName.localeCompare(b.teamName, 'vi-VN', { numeric: true, sensitivity: 'base' });
    });

    const groupMap = new Map<string, CrewReportMatrixGroup>();
    for (const team of teams) {
      const existing = groupMap.get(team.structureGroupId) || {
        structureGroupId: team.structureGroupId,
        structureGroupName: team.structureGroupName,
        structureGroupOrder: team.structureGroupOrder,
        teams: [],
      };
      existing.teams.push(team);
      groupMap.set(team.structureGroupId, existing);
    }
    const groups = Array.from(groupMap.values()).sort((a, b) =>
      (a.structureGroupOrder - b.structureGroupOrder)
      || a.structureGroupName.localeCompare(b.structureGroupName, 'vi-VN', { numeric: true, sensitivity: 'base' })
    );

    const teamTotals: Record<string, CrewReportMatrixTeamTotal> = {};
    for (const team of teams) {
      teamTotals[team.teamKey] = { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
    }
    for (const row of projectRows) {
      if (!row.reported) continue;
      const total = teamTotals[row.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
      total.morning += row.morning || 0;
      total.afternoon += row.afternoon || 0;
      total.evening += row.evening || 0;
      total.dailyHeadcount += row.dailyHeadcount || 0;
      teamTotals[row.teamKey] = total;
    }
    const dates = Array.from(dateSet).sort().map((date) => {
      const cells: Record<string, CrewReportRow> = {};
      projectRows.filter((row) => row.date === date).forEach((row) => { cells[row.teamKey] = row; });
      const totalDailyHeadcount = Object.values(cells).reduce(
        (sum, row) => sum + (row.reported ? (row.dailyHeadcount || 0) : 0),
        0,
      );
      return { date, cells, totalDailyHeadcount };
    });
    const grandDailyHeadcount = dates.reduce((sum, item) => sum + item.totalDailyHeadcount, 0);
    return {
      projectId,
      projectName: first?.projectName || projectId,
      projectLocation: first?.projectLocation,
      groups,
      teams,
      dates,
      teamTotals,
      grandDailyHeadcount,
    };
  });
}

const formatCount = (value: number | null, reported: boolean) => reported ? String(value ?? 0) : 'Chưa báo';

export function buildCrewReportText(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title?: string;
  includeSerial?: boolean;
  includeDetails?: boolean;
}): string {
  const matrices = buildCrewReportMatrices(params.rows);
  const lines: string[] = [];
  const multiProject = matrices.length > 1;

  matrices.forEach((matrix, projectIndex) => {
    const heading = multiProject
      ? `${params.title || 'Báo cáo quân số'} – ${matrix.projectName}`
      : `${params.title || 'Báo cáo quân số'}${matrix.projectName ? ` – ${matrix.projectName}` : ''}`;
    lines.push(heading);
    if (matrix.projectLocation) lines.push(`Địa điểm: ${matrix.projectLocation}`);
    lines.push(params.startDate === params.endDate
      ? `Ngày ${formatDateDDMMYYYY(params.startDate)}`
      : `Từ ${formatDateDDMMYYYY(params.startDate)} đến ${formatDateDDMMYYYY(params.endDate)}`);
    lines.push('');

    for (const [dateIndex, dateRow] of matrix.dates.entries()) {
      lines.push(`${params.includeSerial ? `${dateIndex + 1}. ` : ''}Ngày ${formatDateDDMMYYYY(dateRow.date)}`);
      for (const group of matrix.groups) {
        if (group.structureGroupName) lines.push(`  ${group.structureGroupName}`);
        for (const team of group.teams) {
          const row = dateRow.cells[team.teamKey];
          if (!row?.reported) {
            lines.push(`    - ${team.teamName}: Chưa báo`);
            continue;
          }
          const detailParts = params.includeDetails
            ? [
                row.floorSummary ? `Tầng: ${row.floorSummary}` : '',
                row.workCategorySummary ? `Hạng mục: ${row.workCategorySummary}` : '',
                row.workSubItemSummary ? `HM con: ${row.workSubItemSummary}` : '',
                row.notesSummary ? `Ghi chú: ${row.notesSummary}` : '',
              ].filter(Boolean)
            : [];
          lines.push(`    - ${team.teamName}: Sáng ${formatCount(row.morning, true)} | Chiều ${formatCount(row.afternoon, true)} | Tối ${formatCount(row.evening, true)} | QS ngày ${formatCount(row.dailyHeadcount, true)}${detailParts.length ? ` | ${detailParts.join(' | ')}` : ''}`);
        }
      }
      const dayRows = Object.values(dateRow.cells);
      const summary = summarizeCrewReportRows(dayRows)[0];
      if (summary) {
        lines.push(`Tổng QS/ngày: ${dateRow.totalDailyHeadcount} người | Sáng ${summary.morning} | Chiều ${summary.afternoon} | Tối ${summary.evening} | Đã báo ${summary.reportedTeams} đội${summary.missingTeams ? ` | Chưa báo ${summary.missingTeams} đội` : ''}`);
      }
      lines.push('');
    }

    lines.push('TỔNG');
    for (const group of matrix.groups) {
      if (group.structureGroupName) lines.push(`  ${group.structureGroupName}`);
      for (const team of group.teams) {
        const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
        lines.push(`    - ${team.teamName}: Sáng ${total.morning} | Chiều ${total.afternoon} | Tối ${total.evening} | Tổng QS ngày ${total.dailyHeadcount}`);
      }
    }
    lines.push(`Tổng lượt người-ngày: ${matrix.grandDailyHeadcount}`, '');

    if (projectIndex < matrices.length - 1) lines.push('--------------------', '');
  });

  lines.push('Lưu ý: QS ngày của mỗi đội = ca đông nhất. Tổng ngày = cộng QS các đội. Hàng TỔNG = cộng từng cột; ô cuối = tổng lượt người-ngày.');
  return lines.join('\n').trim();
}
