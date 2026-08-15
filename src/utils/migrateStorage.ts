import localforage from 'localforage';

export const migrateAndCleanLocalStorage = async () => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('construction_floor_plans') || key.startsWith('construction_defects') || key.startsWith('construction_crew_records'))) {
        const val = localStorage.getItem(key);
        if (val) {
          const existingInIdb = await localforage.getItem(key);
          if (!existingInIdb) {
            await localforage.setItem(key, val);
          }
          localStorage.removeItem(key);
          i--; // adjust index since we removed an item
        }
      }
    }
    console.log('Migration to localforage completed.');
  } catch (err) {
    console.error('Migration error:', err);
  }
};
