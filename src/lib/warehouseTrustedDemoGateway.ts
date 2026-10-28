/**
 * P21.4: TEST ONLY. Client transport for trusted Cloud Functions on disposable
 * local Firebase Emulators. Never activate on live DEV/PROD without a verified
 * migration, all-client cutover, App Check, and backup/restore rehearsal.
 */
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import type { InventoryItem } from '../types';
import { firebaseApp, APP_ENVIRONMENT, FIREBASE_EMULATOR_ENABLED, FIREBASE_EMULATOR_HOST,
  FIREBASE_EMULATOR_PROJECT_ID } from './firebaseBase';

const explicitOptIn = String((import.meta as any).env?.VITE_P21_TRUSTED_WAREHOUSE_DEMO || '') === 'P21_LOCAL_EMULATOR_ONLY';
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const safeDemo = APP_ENVIRONMENT === 'DEV' && FIREBASE_EMULATOR_ENABLED
  && FIREBASE_EMULATOR_PROJECT_ID.startsWith('demo-') && localHosts.has(FIREBASE_EMULATOR_HOST);

// Do not silently fall back to direct Firestore writers after an explicitly
// requested trusted transport fails its environment guard.
if (explicitOptIn && !safeDemo) {
  throw new Error('P21_TRUSTED_WAREHOUSE_REFUSES_NONLOCAL_OR_PROD_FIREBASE');
}
export const TRUSTED_WAREHOUSE_DEMO_MODE = explicitOptIn && safeDemo;

import { strictManualVoucherPayload } from '../utils/warehouseTrustedPayload';
export { strictManualVoucherPayload } from '../utils/warehouseTrustedPayload';

let functionsInstance: ReturnType<typeof getFunctions> | null = null;
function emulatorFunctions() {
  if (!TRUSTED_WAREHOUSE_DEMO_MODE) throw new Error('P21_TRUSTED_WAREHOUSE_EMULATOR_ONLY');
  if (!functionsInstance) {
    functionsInstance = getFunctions(firebaseApp, 'asia-southeast1');
    connectFunctionsEmulator(functionsInstance, FIREBASE_EMULATOR_HOST, 5001);
  }
  return functionsInstance;
}

export interface TrustedVoucherReply { transactionId: string; materialKey: string; onHand: number; duplicate: boolean }
export async function trustedVoucherDemo(input: {
  projectId: string; transactionId: string; action: 'create'|'update'|'softDelete'|'restore'|'discard';
  item?: InventoryItem; expectedRevision?: number; trashSettings?: { enabled?: boolean; retentionDays?: number };
}): Promise<TrustedVoucherReply> {
  if (!TRUSTED_WAREHOUSE_DEMO_MODE) throw new Error('P21_TRUSTED_WAREHOUSE_EMULATOR_ONLY');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('P21_TRUSTED_WAREHOUSE_OFFLINE_DENIED');
  const item = input.item ? strictManualVoucherPayload(input.item) : undefined;
  if (input.action === 'update' && (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision || 0) < 1)) {
    throw new Error('P21_TRUSTED_WAREHOUSE_EXPECTED_REVISION_REQUIRED');
  }
  const callable = httpsCallable<unknown, TrustedVoucherReply>(emulatorFunctions(), 'hnlWarehouseVoucherV1', { timeout: 30000 });
  return (await callable({ projectId:input.projectId, transactionId:input.transactionId, action:input.action,
    ...(item ? {item} : {}), ...(input.expectedRevision === undefined ? {} : { expectedRevision:input.expectedRevision }),
    ...(input.trashSettings ? {trashSettings:input.trashSettings} : {}),
  })).data;
}

export async function trustedImportDemo(projectId: string, items: InventoryItem[], existing: Map<string, InventoryItem>): Promise<void> {
  if (!TRUSTED_WAREHOUSE_DEMO_MODE) throw new Error('P21_TRUSTED_WAREHOUSE_EMULATOR_ONLY');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('P21_TRUSTED_WAREHOUSE_OFFLINE_DENIED');
  if (!items.length) return;
  if (items.length > 30) throw new Error('P21_TRUSTED_IMPORT_MAX_30_ALL_OR_NOTHING');
  const ops = items.map(item => {
    const prior = existing.get(item.id);
    if (prior && (!Number.isSafeInteger(prior.revision) || (prior.revision || 0) < 1 || item.revision !== prior.revision)) {
      throw new Error('P21_TRUSTED_IMPORT_CONFLICT_RELOAD');
    }
    return { action:prior ? 'update' : 'create',transactionId:item.id,
      item:strictManualVoucherPayload(item), ...(prior ? {expectedRevision:prior.revision} : {}) };
  });
  const callable = httpsCallable(emulatorFunctions(), 'hnlWarehouseImportBatchDevV1', { timeout:60000 });
  await callable({projectId,operations:ops});
}

export async function trustedUnitRenameDemo(input: {
  projectId:string;kind:'material'|'equipment';materialId?:string;materialName:string;
  fromUnit:string;toUnit:string;equipmentMetadata?: { displayName:string;category:string;brand:string;model:string;specifications:string;notes:string;expectedRevision?:number };
}): Promise<{norms:number;vouchers:number}> {
  if (!TRUSTED_WAREHOUSE_DEMO_MODE) throw new Error('P21_TRUSTED_WAREHOUSE_EMULATOR_ONLY');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('P21_TRUSTED_WAREHOUSE_OFFLINE_DENIED');
  const name = input.kind==='equipment' ? 'hnlWarehouseRenameEquipmentUnitDevV1' : 'hnlWarehouseRenameMaterialUnitDevV1';
  const callable = httpsCallable<unknown,{norms:number;vouchers:number}>(emulatorFunctions(),name,{timeout:60000});
  return (await callable({ ...input })).data;
}
