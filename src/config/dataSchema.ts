/**
 * App version and data schema version intentionally evolve independently.
 * V4 is the first release with an explicit, centralized, idempotent Cloud migration runner.
 */
export const CURRENT_DATA_SCHEMA_VERSION = 4;

export interface DataSchemaMigrationStep {
  version: number;
  name: string;
}

/**
 * Registry is intentionally append-only. A migration may be a marker-only migration,
 * but every future data-shape change must receive a new version here instead of adding
 * one-off legacy checks throughout business screens.
 */
export const DATA_SCHEMA_MIGRATIONS: readonly DataSchemaMigrationStep[] = Object.freeze([
  { version: 1, name: 'legacy-project-root' },
  { version: 2, name: 'firestore-subcollections' },
  { version: 3, name: 'cloud-project-identity-hardening' },
  { version: 4, name: 'realtime-stability-baseline' },
]);

export function readDataSchemaVersion(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function needsDataSchemaMigration(value: unknown): boolean {
  return readDataSchemaVersion(value) < CURRENT_DATA_SCHEMA_VERSION;
}

export function getPendingDataSchemaMigrations(value: unknown): readonly DataSchemaMigrationStep[] {
  const current = readDataSchemaVersion(value);
  return DATA_SCHEMA_MIGRATIONS.filter((step) => step.version > current && step.version <= CURRENT_DATA_SCHEMA_VERSION);
}
