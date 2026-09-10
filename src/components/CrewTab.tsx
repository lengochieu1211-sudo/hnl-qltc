import React from 'react';
import { CrewTab as CrewTabBase } from './CrewTabBase';
import { prepareCrewRecordForPersistence } from '../utils/crewPersistence';
import { sanitizeCrewTaskDescriptionText } from '../utils/crewTaskDescription';
import { findWorsenedTeamNameConflict } from '../utils/teamDirectoryIntegrity';

type CrewTabProps = React.ComponentProps<typeof CrewTabBase>;

export const CrewTab: React.FC<CrewTabProps> = (props) => {
  const [teamDirectoryGuardRevision, setTeamDirectoryGuardRevision] = React.useState(0);

  // Keep the original sanitizer invariant as a final defense after the stronger
  // floorWorks/category validator. This also makes add/update persistence behavior
  // explicit for RBAC/source regression tooling.
  const sanitizeRecordTask = <T extends { taskDescription?: string }>(record: T): T => ({
    ...record,
    taskDescription: sanitizeCrewTaskDescriptionText(String(record.taskDescription || '')).trim(),
  });

  const prepare = <T extends { taskDescription?: string; floorWorks?: any[] }>(record: T): T | null => {
    const result = prepareCrewRecordForPersistence(record);
    if (!result.ok || !result.record) {
      alert(result.error || 'Nhật ký quân số chưa hợp lệ.');
      return null;
    }
    return sanitizeRecordTask(result.record);
  };

  const handleUpdateTeams: NonNullable<CrewTabProps['onUpdateTeams']> = (nextTeams) => {
    const conflict = findWorsenedTeamNameConflict(props.teams || [], nextTeams);
    if (conflict) {
      alert(
        `Không thể lưu vì tên đội “${conflict.displayName}” bị trùng. ` +
        'Mỗi tên đội phải đại diện cho một teamId duy nhất. Hãy đổi tên một đội rồi lưu lại.'
      );
      // CrewTabBase owns temporary form/list state. Remount it from authoritative props
      // so a rejected duplicate never remains visible as if it had been persisted.
      setTeamDirectoryGuardRevision((value) => value + 1);
      return;
    }
    props.onUpdateTeams?.(nextTeams);
  };

  return (
    <CrewTabBase
      key={`crew-directory-${teamDirectoryGuardRevision}`}
      {...props}
      onUpdateTeams={handleUpdateTeams}
      onAddCrewRecord={(record) => {
        const next = prepare(record);
        if (next) props.onAddCrewRecord(next);
      }}
      onUpdateCrewRecord={(id, record) => {
        const next = prepare(record);
        if (next) props.onUpdateCrewRecord(id, next);
      }}
    />
  );
};
