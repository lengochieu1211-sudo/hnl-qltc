/** DEV opt-in only. Does not switch PROD or bypass Cloud vouchers. */
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { InventoryItem } from '../types';
const CLIENT_VOUCHER_FIELDS = new Set([
  'id','type','itemKind','materialId','materialName','unit','quantity','inputExpressions',
  'location','handler','date','notes','sourceType','issuePurpose',
  'sourceStructureGroupId','sourceRoomId','sourceFloorId','sourceTeamId',
  'sourceWorkCategoryId','sourceNormId','sourceIssueKey',
]);
function onlyVoucherFields(item: InventoryItem): Partial<InventoryItem> {
  return Object.fromEntries(Object.entries(item).filter(([key,value]) =>
    CLIENT_VOUCHER_FIELDS.has(key) && value !== undefined && value !== null));
}
import type { TrashSettings } from './trash';
import { APP_ENVIRONMENT, FIREBASE_EMULATOR_ENABLED, FIREBASE_EMULATOR_HOST, firebaseApp, WAREHOUSE_TRUSTED_WRITER_ENABLED } from './firebaseBase';
export { WAREHOUSE_TRUSTED_WRITER_ENABLED } from './firebaseBase';

const env = (import.meta as any).env || {};
const requested = String(env.VITE_WAREHOUSE_TRUSTED_WRITER || 'false').toLowerCase() === 'true';
// The flag itself is defined in firebaseBase so generic sync cannot bypass it.
if (requested && APP_ENVIRONMENT !== 'DEV') throw new Error('WAREHOUSE_TRUSTED_DEV_ONLY');
if (requested && !FIREBASE_EMULATOR_ENABLED && firebaseApp.options.projectId !== 'hnl-qltc-dev') {
  throw new Error('WAREHOUSE_TRUSTED_REFUSING_NON_DEV_PROJECT');
}
let installedEmulator = false;
export async function callTrustedWarehouseWriter(input: {
  projectId:string; action:'create'|'update'|'softDelete'|'restore'|'discard'; transactionId:string;
  item?:InventoryItem; expectedRevision?:number; trashSettings?:TrashSettings;
}):Promise<{transactionId:string;materialKey:string;onHand:number;duplicate:boolean}> {
  if (!WAREHOUSE_TRUSTED_WRITER_ENABLED) throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  const functions=getFunctions(firebaseApp,'asia-southeast1');
  if (FIREBASE_EMULATOR_ENABLED && !installedEmulator) {
    connectFunctionsEmulator(functions,FIREBASE_EMULATOR_HOST,5001);
    installedEmulator=true;
  }
  const callable=httpsCallable<typeof input,{transactionId:string;materialKey:string;onHand:number;duplicate:boolean}>(functions,'hnlWarehouseVoucherV1',{timeout:30000});
  // Do not fall back to old client Firestore transactions on server failure.
  // Firebase callable serializer must not receive undefined optional fields.
  const payload=Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined)) as typeof input;
  if(input.item)payload.item=onlyVoucherFields(input.item) as InventoryItem;
  const result=await callable(payload);
  return result.data;
}

/** Explicit ADMIN-only DEV repair; not automatically invoked by voucher transactions. */
export async function callTrustedWarehouseReconcile(input:{projectId:string;materialKey:string}):Promise<number>{
  if(!WAREHOUSE_TRUSTED_WRITER_ENABLED)throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  const fn=getFunctions(firebaseApp,'asia-southeast1');
  if(FIREBASE_EMULATOR_ENABLED && !installedEmulator){
    connectFunctionsEmulator(fn,FIREBASE_EMULATOR_HOST,5001);installedEmulator=true;
  }
  const callable=httpsCallable<typeof input&{approval:string},{onHand:number}>(fn,'hnlWarehouseReconcileDevV1',{timeout:60000});
  const response=await callable({...input,approval:'RECONCILE-COPIED-DEV-LEDGER'});
  return response.data.onHand;
}

/** One ADMIN-only DEV server transaction for up to 30 imported manual vouchers.
 * Unlike sequential client calls, an invalid row aborts the WHOLE import. */
export async function callTrustedWarehouseImportBatch(input: {
  projectId: string;
  operations: Array<{ action: 'create'|'update'; transactionId: string;
    item: InventoryItem; expectedRevision?: number }>;
}): Promise<{count:number;written:number;duplicates:number;materialKeys:string[]}> {
  if (!WAREHOUSE_TRUSTED_WRITER_ENABLED) throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 30)
    throw new Error('WAREHOUSE_BATCH_INVALID_REQUEST');
  const functions = getFunctions(firebaseApp, 'asia-southeast1');
  if (FIREBASE_EMULATOR_ENABLED && !installedEmulator) {
    connectFunctionsEmulator(functions, FIREBASE_EMULATOR_HOST, 5001);
    installedEmulator = true;
  }
  const callable = httpsCallable<typeof input, {count:number;written:number;duplicates:number;materialKeys:string[]}>(
    functions, 'hnlWarehouseImportBatchDevV1', {timeout:60000});
  const operations = input.operations.map(({action,transactionId,item,expectedRevision}) => ({
    action,transactionId,item:onlyVoucherFields(item) as InventoryItem,
    ...(action === 'update' ? {expectedRevision} : {}),
  }));
  const result = await callable({projectId:input.projectId,operations});
  return result.data;
}

/** Admin material unit-label rename, one DEV server-side atomic transaction. */
export async function callTrustedMaterialUnitRename(input: {
  projectId:string; kind:'material'; materialId:string; materialName:string;
  fromUnit:string; toUnit:string;
}):Promise<{norms:number;vouchers:number;materialKey:string;onHand:number}> {
  if(!WAREHOUSE_TRUSTED_WRITER_ENABLED)throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if(typeof navigator!=='undefined' && navigator.onLine===false)
    throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  const fn=getFunctions(firebaseApp,'asia-southeast1');
  if(FIREBASE_EMULATOR_ENABLED && !installedEmulator){
    connectFunctionsEmulator(fn,FIREBASE_EMULATOR_HOST,5001);installedEmulator=true;
  }
  const callable=httpsCallable<typeof input,{norms:number;vouchers:number;materialKey:string;onHand:number}>(
    fn,'hnlWarehouseRenameMaterialUnitDevV1',{timeout:60000});
  return (await callable(input)).data;
}

/** ADMIN-only DEV equipment unit-label migration; old balance becomes a tombstone. */
export async function callTrustedEquipmentUnitRename(input: {
  projectId:string; kind:'equipment'; materialName:string; fromUnit:string; toUnit:string;
  equipmentMetadata?: {
    displayName:string; category:string; brand:string; model:string;
    specifications:string; notes:string; expectedRevision?:number;
  };
}):Promise<{norms:number;vouchers:number;materialKey:string;onHand:number}> {
  if(!WAREHOUSE_TRUSTED_WRITER_ENABLED)throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if(typeof navigator!=='undefined' && navigator.onLine===false)
    throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  const fn=getFunctions(firebaseApp,'asia-southeast1');
  if(FIREBASE_EMULATOR_ENABLED && !installedEmulator){
    connectFunctionsEmulator(fn,FIREBASE_EMULATOR_HOST,5001);installedEmulator=true;
  }
  const callable=httpsCallable<typeof input,{norms:number;vouchers:number;materialKey:string;onHand:number}>(
    fn,'hnlWarehouseRenameEquipmentUnitDevV1',{timeout:60000});
  return (await callable(input)).data;
}

/** Atomic canonical room material issue. Quantities are recalculated by server
 * from Firestore snapshots; the browser NEVER supplies quantity or norm payload. */
export async function callTrustedWarehouseRoomAutoIssue(input:{
  projectId:string;roomId:string;expectedRoomRevision:number;expectedRoomUpdatedAt:number;
}):Promise<{roomId:string;count:number;issued:number;duplicate:boolean}>{
  if(!WAREHOUSE_TRUSTED_WRITER_ENABLED)throw new Error('WAREHOUSE_TRUSTED_NOT_CONFIGURED');
  if(typeof navigator!=='undefined'&&navigator.onLine===false)
    throw new Error('WAREHOUSE_STRICT_STOCK_OFFLINE_BLOCKED');
  const fn=getFunctions(firebaseApp,'asia-southeast1');
  if(FIREBASE_EMULATOR_ENABLED&&!installedEmulator){
    connectFunctionsEmulator(fn,FIREBASE_EMULATOR_HOST,5001);installedEmulator=true;
  }
  const callable=httpsCallable<typeof input,{roomId:string;count:number;issued:number;duplicate:boolean}>(
    fn,'hnlWarehouseRoomAutoIssueDevV1',{timeout:60000});
  return (await callable(input)).data;
}
