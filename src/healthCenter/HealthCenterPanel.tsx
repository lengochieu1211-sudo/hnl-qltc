import React from 'react';
import { HealthCenterPanel as HealthCenterPanelBase } from './HealthCenterPanelBase';

// The panel owns the single canonical navigation flow and source context.
// A second capture-phase handler here used to skip saving the return state.
type HealthCenterPanelProps = React.ComponentProps<typeof HealthCenterPanelBase>;
export const HealthCenterPanel: React.FC<HealthCenterPanelProps> = (props) => (
  <HealthCenterPanelBase {...props} />
);
