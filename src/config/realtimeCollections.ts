/**
 * V6.2.27 Stability Gate: single source of truth for the nine business-data
 * collections that participate in Firestore realtime sync.
 */
export const REALTIME_COLLECTIONS = [
  { cloudName: 'rooms', stateKey: 'roomProgressList' },
  { cloudName: 'inventory', stateKey: 'inventory' },
  { cloudName: 'defects', stateKey: 'defects' },
  { cloudName: 'work_volumes', stateKey: 'workVolumes' },
  { cloudName: 'floor_plans', stateKey: 'floorPlans' },
  { cloudName: 'checklist', stateKey: 'checklist' },
  { cloudName: 'crew_records', stateKey: 'crewRecords' },
  { cloudName: 'teams', stateKey: 'teams' },
  { cloudName: 'material_norms', stateKey: 'materialNorms' },
] as const;

export type RealtimeStateKey = (typeof REALTIME_COLLECTIONS)[number]['stateKey'];
export type RealtimeCloudName = (typeof REALTIME_COLLECTIONS)[number]['cloudName'];

export const REALTIME_STATE_KEYS = REALTIME_COLLECTIONS.map((item) => item.stateKey) as RealtimeStateKey[];
export const STATE_KEY_TO_CLOUD_NAME = Object.freeze(
  Object.fromEntries(REALTIME_COLLECTIONS.map((item) => [item.stateKey, item.cloudName])) as Record<RealtimeStateKey, RealtimeCloudName>,
);
