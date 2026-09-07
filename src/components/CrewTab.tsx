import React from 'react';
import { CrewTab as CrewTabBase } from './CrewTabBase';
import { prepareCrewRecordForPersistence } from '../utils/crewPersistence';
import { sanitizeCrewTaskDescriptionText } from '../utils/crewTaskDescription';

type CrewTabProps = React.ComponentProps<typeof CrewTabBase>;

export const CrewTab: React.FC<CrewTabProps> = (props) => {
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

  return (
    <CrewTabBase
      {...props}
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
