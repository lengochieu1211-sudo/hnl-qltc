import React from 'react';
import { CrewTab as CrewTabBase } from './CrewTabBase';
import { sanitizeCrewTaskDescriptionText } from '../utils/crewTaskDescription';

type CrewTabProps = React.ComponentProps<typeof CrewTabBase>;

const sanitizeRecordTask = <T extends { taskDescription?: string }>(record: T): T => {
  if (!record.taskDescription) return record;
  const taskDescription = sanitizeCrewTaskDescriptionText(record.taskDescription);
  if (taskDescription === record.taskDescription) return record;
  return { ...record, taskDescription };
};

export const CrewTab: React.FC<CrewTabProps> = (props) => (
  <CrewTabBase
    {...props}
    onAddCrewRecord={(record) => props.onAddCrewRecord(sanitizeRecordTask(record))}
    onUpdateCrewRecord={(id, record) => props.onUpdateCrewRecord(id, sanitizeRecordTask(record))}
  />
);
