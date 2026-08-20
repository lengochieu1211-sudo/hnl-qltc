import localforage from 'localforage';

const appDataStore = localforage.createInstance({
  name: 'ConstructionAppDB',
  storeName: 'app_data',
});

export const LEGACY_AUTOSAVE_RAW_KEY = '__legacy_construction_autosave_versions_raw__';

const LEGACY_DOMAIN_PREFIXES = [
  'construction_floor_plans',
  'construction_defects',
  'construction_crew_records',
  'construction_room_progress',
  'construction_checklist',
  'construction_material_norms',
  'construction_inventory',
  'construction_work_volumes',
  'construction_teams',
  'construction_tombstones',
  'construction_present',
];

function isLegacyDomainKey(key: string): boolean {
  return LEGACY_DOMAIN_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Move old business collections from localStorage to IndexedDB/localforage.
 * Removal happens ONLY after the value is confirmed in IndexedDB.
 *
 * `construction_autosave_versions` can be very large because historical releases
 * embedded complete snapshots. It is moved as a RAW string first so bootstrap does not
 * create another giant parsed copy in memory. backupDb imports it lazily later.
 */
export const migrateAndCleanLocalStorage = async (): Promise<{ migrated: number; freedApprox: number }> => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (isLegacyDomainKey(key) || key === 'construction_autosave_versions' || key.includes('construction_defect_draft_photoUrl'))) keys.push(key);
    }

    let migrated = 0;
    let freedApprox = 0;
    for (const key of keys) {
      const val = localStorage.getItem(key);
      if (val === null) continue;
      try {
        const targetKey = key === 'construction_autosave_versions' ? LEGACY_AUTOSAVE_RAW_KEY : key;
        const existing = await appDataStore.getItem(targetKey);
        if (existing === null || existing === undefined) {
          await appDataStore.setItem(targetKey, val);
        }
        const verify = await appDataStore.getItem(targetKey);
        if (verify !== null && verify !== undefined) {
          freedApprox += (key.length + val.length) * 2;
          localStorage.removeItem(key);
          migrated += 1;
        }
      } catch (itemErr) {
        console.warn(`[Storage migration] Kept ${key}; IndexedDB migration failed:`, itemErr);
      }
    }

    if (migrated > 0) {
      console.info(`[Storage migration] Moved ${migrated} legacy keys to IndexedDB, freed ~${Math.round(freedApprox / 1024)} KB.`);
    }
    return { migrated, freedApprox };
  } catch (err) {
    console.error('Migration error:', err);
    return { migrated: 0, freedApprox: 0 };
  }
};
