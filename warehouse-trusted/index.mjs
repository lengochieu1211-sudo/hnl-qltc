/** Cloud Function candidate for DEV only. NEVER deploy this service to PROD. */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { executeVoucher } from './engine.mjs';
import { importWarehouseBatchAtomic } from './batch.mjs';
import { migrateDevCopiedRoom } from './room-migrate.mjs';
import { reconcileTrustedWarehouseBalance } from './reconcile.mjs';
import { renameTrustedMaterialUnit } from './unit-rename.mjs';
import { renameTrustedEquipmentUnit } from './equipment-unit-rename.mjs';
import { issueTrustedRoomMaterials } from './room-auto.mjs';
initializeApp();
const expectedDev = 'hnl-qltc-dev';
const activeDev = () => {
  const project = String(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '');
  return project === expectedDev || (process.env.FUNCTIONS_EMULATOR === 'true' && project.startsWith('demo-'));
};
export const hnlWarehouseVoucherV1 = onCall({
  region: 'asia-southeast1', timeoutSeconds: 30, maxInstances: 3, memory: '256MiB',
  // AppCheck must be enabled before PROD. DEV Auth is still mandatory below.
  enforceAppCheck: false,
}, async request => {
  if (!activeDev()) throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if (!request.auth?.uid || !request.auth?.token?.email) throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument','WAREHOUSE_INVALID_REQUEST');
  if (JSON.stringify(input).length > 25000) throw new HttpsError('invalid-argument','WAREHOUSE_REQUEST_TOO_LARGE');
  try {
    return await executeVoucher({
      db: getFirestore(),actor:{uid:request.auth.uid,email:request.auth.token.email,emailVerified:request.auth.token.email_verified === true},
      projectId:input.projectId,action:input.action,transactionId:input.transactionId,
      item:input.item,expectedRevision:input.expectedRevision,trashSettings:input.trashSettings,
    });
  } catch(error) {
    // Explicit business errors without stack traces / private record content.
    const code=String(error?.message||'WAREHOUSE_SERVICE_ERROR');
    if (code.startsWith('WAREHOUSE_')) {
      const permission=code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition';
      throw new HttpsError(permission,code);
    }
    console.error('warehouse trusted server failure',error);
    throw new HttpsError('internal','WAREHOUSE_INTERNAL_ERROR');
  }
});

/** NEVER invoked automatically; project MUST be a verified DEV copy. */
export const hnlRoomMigrateDevV1 = onCall({
  region:'asia-southeast1',timeoutSeconds:30,maxInstances:1,memory:'256MiB',enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','ROOM_MIGRATION_DEV_ONLY');
  if(!request.auth?.uid || !request.auth?.token?.email || request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','ROOM_MIGRATION_AUTH_REQUIRED');
  const input=request.data;
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!['projectId','roomId','approval'].includes(k)))
    throw new HttpsError('invalid-argument','ROOM_MIGRATION_INVALID_REQUEST');
  try {
    return await migrateDevCopiedRoom({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},
      projectId:input.projectId,roomId:input.roomId,approval:input.approval});
  }catch(error){
    const code=String(error?.message||'ROOM_MIGRATION_FAILED');
    if(code.startsWith('ROOM_MIGRATION_')||code.startsWith('WAREHOUSE_'))throw new HttpsError(
      code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('DEV room migration failure',error);
    throw new HttpsError('internal','ROOM_MIGRATION_INTERNAL_ERROR');
  }
});

/** DEV-only ADMIN emergency repair for legacy derived balances; no PROD deployment. */
export const hnlWarehouseReconcileDevV1 = onCall({
  region:'asia-southeast1',timeoutSeconds:60,maxInstances:1,memory:'256MiB',enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if(!request.auth?.uid || !request.auth.token.email || request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if(!input || typeof input!=='object'||Array.isArray(input) ||
      Object.keys(input).some(k=>!['projectId','materialKey','approval'].includes(k))||
      input.approval!=='RECONCILE-COPIED-DEV-LEDGER')
    throw new HttpsError('invalid-argument','WAREHOUSE_RECONCILE_NOT_APPROVED');
  try{
    return await reconcileTrustedWarehouseBalance({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},projectId:input.projectId,materialKey:input.materialKey});
  }catch(error){
    const code=String(error?.message||'WAREHOUSE_RECONCILE_FAILED');
    if(code.startsWith('WAREHOUSE_')) throw new HttpsError(code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('DEV warehouse reconciliation failed',error);
    throw new HttpsError('internal','WAREHOUSE_RECONCILE_INTERNAL_ERROR');
  }
});

/** Admin-only DEV import. All vouchers + balances commit or NONE commit. */
export const hnlWarehouseImportBatchDevV1 = onCall({
  region:'asia-southeast1',timeoutSeconds:60,maxInstances:2,memory:'512MiB',enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if(!request.auth?.uid || !request.auth.token.email || request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     Object.keys(input).some(k=>!['projectId','operations'].includes(k)) ||
     JSON.stringify(input).length>130000)
    throw new HttpsError('invalid-argument','WAREHOUSE_BATCH_INVALID_REQUEST');
  try{
    return await importWarehouseBatchAtomic({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},projectId:input.projectId,operations:input.operations});
  }catch(error){
    const code=String(error?.message||'WAREHOUSE_BATCH_FAILED');
    if(code.startsWith('WAREHOUSE_'))throw new HttpsError(
      code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('warehouse batch DEV failure',error);
    throw new HttpsError('internal','WAREHOUSE_BATCH_INTERNAL_ERROR');
  }
});

/** ADMIN-only DEV canonical material unit-label rename. Never use for equipment or legacy aliases. */
export const hnlWarehouseRenameMaterialUnitDevV1 = onCall({
  region:'asia-southeast1', timeoutSeconds:60, maxInstances:1, memory:'512MiB', enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if(!request.auth?.uid || !request.auth?.token?.email || request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).some(k=>!['projectId','kind','materialId','materialName','fromUnit','toUnit'].includes(k)))
    throw new HttpsError('invalid-argument','WAREHOUSE_RENAME_INVALID_REQUEST');
  try{
    return await renameTrustedMaterialUnit({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},...input});
  }catch(error){
    const code=String(error?.message||'WAREHOUSE_RENAME_FAILED');
    if(code.startsWith('WAREHOUSE_'))throw new HttpsError(code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('warehouse material unit rename DEV error',error);
    throw new HttpsError('internal','WAREHOUSE_RENAME_INTERNAL_ERROR');
  }
});


/** Separate ADMIN-only DEV equipment unit transaction; no PROD deployment. */
export const hnlWarehouseRenameEquipmentUnitDevV1 = onCall({
  region:'asia-southeast1',timeoutSeconds:60,maxInstances:1,memory:'512MiB',enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if(!request.auth?.uid||!request.auth?.token?.email||request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>8000||
     Object.keys(input).some(k=>!['projectId','kind','materialName','fromUnit','toUnit','equipmentMetadata'].includes(k)))
    throw new HttpsError('invalid-argument','WAREHOUSE_EQUIPMENT_INVALID_REQUEST');
  try{
    return await renameTrustedEquipmentUnit({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},...input});
  }catch(error){
    const code=String(error?.message||'WAREHOUSE_EQUIPMENT_FAILED');
    if(code.startsWith('WAREHOUSE_'))throw new HttpsError(
      code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('DEV equipment unit rename failure',error);
    throw new HttpsError('internal','WAREHOUSE_EQUIPMENT_INTERNAL_ERROR');
  }
});

/** DEV-only automation: reads room, norm catalog, all ledger vouchers + balance,
 * then computes issue quantities on the SERVER. No client-submitted quantity. */
export const hnlWarehouseRoomAutoIssueDevV1 = onCall({
  region:'asia-southeast1',timeoutSeconds:60,maxInstances:2,memory:'512MiB',enforceAppCheck:false,
},async request=>{
  if(!activeDev())throw new HttpsError('failed-precondition','WAREHOUSE_DEV_ONLY_PROJECT_GUARD');
  if(!request.auth?.uid||!request.auth?.token?.email||request.auth.token.email_verified!==true)
    throw new HttpsError('unauthenticated','WAREHOUSE_AUTH_REQUIRED');
  const input=request.data;
  if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>3000||
     Object.keys(input).some(k=>!['projectId','roomId','expectedRoomRevision','expectedRoomUpdatedAt'].includes(k)))
    throw new HttpsError('invalid-argument','WAREHOUSE_AUTO_INVALID_REQUEST');
  try{
    return await issueTrustedRoomMaterials({db:getFirestore(),actor:{uid:request.auth.uid,
      email:request.auth.token.email,emailVerified:true},...input});
  }catch(error){
    const code=String(error?.message||'WAREHOUSE_AUTO_FAILED');
    if(code.startsWith('WAREHOUSE_'))throw new HttpsError(
      code.includes('ROLE_DENIED')?'permission-denied':'failed-precondition',code);
    console.error('warehouse auto issue DEV failure',error);
    throw new HttpsError('internal','WAREHOUSE_AUTO_INTERNAL_ERROR');
  }
});