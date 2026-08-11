/**
 * Utility to normalize imported JSON data from any version of the app,
 * storage dumps, legacy structures, or nested wrappers.
 */

export function normalizeImportedData(rawInput: any): any {
  if (!rawInput) return {};

  let obj = rawInput;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return {};
    }
  }

  if (typeof obj !== 'object' || obj === null) return {};

  // Unwrap nested structures like { data: { ... } }, { backup: { ... } }, { payload: { ... } }
  let targetObj = { ...obj };
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    targetObj = { ...targetObj, ...obj.data };
  }
  if (obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)) {
    targetObj = { ...targetObj, ...obj.payload };
  }
  if (obj.projectData && typeof obj.projectData === 'object' && !Array.isArray(obj.projectData)) {
    targetObj = { ...targetObj, ...obj.projectData };
  }

  // Helper to extract array from multiple candidate keys or stringified JSON
  const extractArray = (candidateKeys: string[]): any[] | null => {
    // 1. Direct match on candidate keys
    for (const key of candidateKeys) {
      if (key in targetObj && targetObj[key] !== undefined && targetObj[key] !== null) {
        let val = targetObj[key];
        if (typeof val === 'string') {
          try {
            val = JSON.parse(val);
          } catch (e) {
            // ignore
          }
        }
        if (Array.isArray(val)) {
          return val;
        }
      }
    }

    // 2. Fuzzy / substring match on keys (for keys like construction_defects_proj_123 or Defects)
    for (const k of Object.keys(targetObj)) {
      const lowerK = k.toLowerCase();
      for (const cand of candidateKeys) {
        const lowerCand = cand.toLowerCase();
        if (lowerK === lowerCand || lowerK.endsWith(lowerCand) || lowerK.includes(lowerCand)) {
          let val = targetObj[k];
          if (typeof val === 'string') {
            try {
              val = JSON.parse(val);
            } catch (e) {}
          }
          if (Array.isArray(val)) {
            return val;
          }
        }
      }
    }
    return null;
  };

  // Helper to extract string
  const extractString = (candidateKeys: string[]): string | null => {
    for (const key of candidateKeys) {
      if (key in targetObj && targetObj[key] !== undefined && targetObj[key] !== null) {
        const val = targetObj[key];
        if (typeof val === 'string' && val.trim()) {
          return val.trim();
        }
      }
    }
    for (const k of Object.keys(targetObj)) {
      const lowerK = k.toLowerCase();
      for (const cand of candidateKeys) {
        const lowerCand = cand.toLowerCase();
        if (lowerK.includes(lowerCand)) {
          const val = targetObj[k];
          if (typeof val === 'string' && val.trim()) {
            return val.trim();
          }
        }
      }
    }
    return null;
  };

  const normalized: any = { ...targetObj };

  // Collection normalization
  const defects = extractArray(['defects', 'defectList', 'defectsList', 'construction_defects']);
  if (defects !== null) normalized.defects = defects;

  const inventory = extractArray(['inventory', 'inventoryList', 'construction_inventory']);
  if (inventory !== null) normalized.inventory = inventory;

  const workVolumes = extractArray(['workVolumes', 'work_volumes', 'volumes', 'workVolumeList', 'construction_work_volumes']);
  if (workVolumes !== null) normalized.workVolumes = workVolumes;

  const floorPlans = extractArray(['floorPlans', 'floor_plans', 'floors', 'construction_floor_plans']);
  if (floorPlans !== null) normalized.floorPlans = floorPlans;

  const roomProgressList = extractArray(['roomProgressList', 'roomProgress', 'room_progress', 'rooms', 'construction_room_progress']);
  if (roomProgressList !== null) normalized.roomProgressList = roomProgressList;

  const checklist = extractArray(['checklist', 'checklists', 'checklistItems', 'construction_checklist']);
  if (checklist !== null) normalized.checklist = checklist;

  const crewRecords = extractArray(['crewRecords', 'crew_records', 'construction_crew_records']);
  if (crewRecords !== null) normalized.crewRecords = crewRecords;

  const teams = extractArray(['teams', 'teamList', 'construction_teams']);
  if (teams !== null) normalized.teams = teams;

  const materialNorms = extractArray(['materialNorms', 'material_norms', 'norms', 'construction_material_norms']);
  if (materialNorms !== null) normalized.materialNorms = materialNorms;

  // Metadata normalization
  const projectName = extractString(['projectName', 'project_name', 'name', 'construction_project_name']);
  if (projectName !== null) normalized.projectName = projectName;

  const contractorName = extractString(['contractorName', 'contractor_name', 'contractor', 'construction_contractor']);
  if (contractorName !== null) normalized.contractorName = contractorName;

  const inspectorName = extractString(['inspectorName', 'inspector_name', 'inspector', 'construction_inspector']);
  if (inspectorName !== null) normalized.inspectorName = inspectorName;

  return normalized;
}
