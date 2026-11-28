import { useEffect, useState } from 'react';
import { subscribeEquipmentCatalog, type EquipmentCatalogRecord } from '../lib/equipmentCatalog';

const EMPTY: EquipmentCatalogRecord[] = [];
/** Read-only project-scoped label subscription for other screens. */
export function useProjectEquipmentLabels(projectId: string | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ projectId: string; rows: EquipmentCatalogRecord[] } | null>(null);
  useEffect(() => {
    setSnapshot(null);
    if (!enabled || !projectId) return;
    let active = true;
    const unsubscribe = subscribeEquipmentCatalog(projectId, rows => {
      if (active) setSnapshot({ projectId, rows: rows.filter(row => row.projectId === projectId) });
    }, () => { if (active) setSnapshot(null); });
    return () => { active = false; unsubscribe(); };
  }, [projectId, enabled]);
  return enabled && projectId && snapshot && snapshot.projectId === projectId ? snapshot.rows : EMPTY;
}
