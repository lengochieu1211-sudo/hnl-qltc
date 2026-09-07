import React from 'react';
import { CrewTab as CrewTabBase } from './CrewTabBase';
import { prepareCrewRecordForPersistence } from '../utils/crewPersistence';

type CrewTabProps = React.ComponentProps<typeof CrewTabBase>;

export const CrewTab: React.FC<CrewTabProps> = (props) => {
  const prepare = <T extends { taskDescription?: string; floorWorks?: any[] }>(record: T): T | null => {
    const result = prepareCrewRecordForPersistence(record);
    if (!result.ok || !result.record) {
      alert(result.error || 'Nhật ký quân số chưa hợp lệ.');
      return null;
    }
    return result.record;
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
