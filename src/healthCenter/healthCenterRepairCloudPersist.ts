import { getCurrentRealFirebaseUser, saveProjectDiffsToCloud } from '../lib/firebase';
import type { HealthCenterRepairPreview } from './healthCenterRepair';
import { buildHealthCenterRepairPersistencePlan } from './healthCenterRepairPersistence';

export async function persistHealthCenterRepairToCloud<TData extends Record<string, any>>(input: {
  projectId: string;
  projectName?: string;
  beforeData: TData;
  appliedData: TData;
  preview: HealthCenterRepairPreview;
}): Promise<TData> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Health Center Repair cần online để Firestore kiểm tra revision và ghi an toàn.');
  }
  const actor = getCurrentRealFirebaseUser();
  if (!actor || actor.isAnonymous) {
    throw new Error('Không có Firebase user đã xác thực để áp dụng Health Center Repair.');
  }

  const plan = buildHealthCenterRepairPersistencePlan({
    beforeData: input.beforeData,
    appliedData: input.appliedData,
    preview: input.preview,
    actorUid: actor.uid,
  });

  await saveProjectDiffsToCloud(
    input.projectId,
    input.projectName || String(input.beforeData?.projectName || ''),
    String(input.beforeData?.contractorName || ''),
    String(input.beforeData?.inspectorName || ''),
    {
      addedOrModified: plan.addedOrModified,
      deletedIds: plan.deletedIds,
    },
    {
      touchProjectMetadata: false,
      allowRootMetadataWrite: false,
      rootTouchIntervalMs: 60000,
      auditDetailLimit: 20,
    },
  );

  return plan.nextData;
}
