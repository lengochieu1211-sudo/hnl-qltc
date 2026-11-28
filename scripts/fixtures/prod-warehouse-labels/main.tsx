import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { collection, doc, setDoc, updateDoc, getDocsFromServer, onSnapshot, disableNetwork, enableNetwork } from 'firebase/firestore';
import { db, APP_ENVIRONMENT, FIREBASE_EMULATOR_ENABLED, signInWithEmulatorTestAccount } from '../../../src/lib/firebaseBase';
import { commitWarehouseTransactionAtomic } from '../../../src/lib/warehouseTransactions';
import { equipmentCatalogId, saveEquipmentCatalogBatch } from '../../../src/lib/equipmentCatalog';
import { useProjectEquipmentLabels } from '../../../src/hooks/useProjectEquipmentLabels';
import { WarehouseTab } from '../../../src/components/WarehouseTab';
import { exportWarehouseUpdateTemplate } from '../../../src/utils/excelExport';
import { DEFAULT_STRUCTURE_CONFIG } from '../../../src/utils/structureGroupUtils';
import type { InventoryItem, MaterialNorm } from '../../../src/types';
import type { WarehouseOrderSync } from '../../../src/hooks/useWarehouseOrderSync';
import '../../../src/index.css';
if (!FIREBASE_EMULATOR_ENABLED || APP_ENVIRONMENT !== 'DEV' || location.hostname !== '127.0.0.1') throw Error('Local demo emulator only');
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'viewer' ? 'VIEWER' : 'ADMIN';
const projectId = 'warehouse-label-fixture-' + (params.get('test') || 'default');
const user = await signInWithEmulatorTestAccount(role);
const originalMaterial = 'Tấm cũ kiểm thử';
const originalEquipment = 'Máy khoan cũ kiểm thử';
const materialId = 'MAT-LABEL';
const normId = 'NORM-LABEL';
const equipmentId = equipmentCatalogId(originalEquipment);
const normRef = doc(db, 'projects', projectId, 'material_norms', normId);
const equipmentRef = doc(db, 'projects', projectId, 'equipment_catalog', equipmentId);
const base = {date:'2026-11-28',location:'Kho thử',handler:'Người thử'};
const fixtures: InventoryItem[] = [
  {...base,id:'LABEL-MAT-IN',itemKind:'material',materialId,materialName:originalMaterial,unit:'Tấm',type:'in',quantity:12},
  {...base,id:'LABEL-MAT-OUT',itemKind:'material',materialId,materialName:originalMaterial,unit:'Tấm',type:'out',quantity:5},
  {...base,id:'LABEL-EQ-IN',itemKind:'equipment',materialName:originalEquipment,unit:'Cái',type:'in',quantity:3},
  {...base,id:'LABEL-EQ-OUT',itemKind:'equipment',materialName:originalEquipment,unit:'Cái',type:'out',quantity:1}
];
const equipmentInput = {name:originalEquipment,unit:'Cái',category:'Thiết bị',brand:'',model:'',specifications:'',notes:''};
if(role === 'ADMIN'){
  const now=Date.now();
  await setDoc(doc(db,'projects',projectId), {id:projectId,name:'Warehouse fixture',ownerUid:user.uid,ownerEmail:user.email,createdAt:now,updatedAt:now});
  await setDoc(doc(db,'projects',projectId,'members','viewer@hnl.test'), {email:'viewer@hnl.test',role:'VIEWER',active:true,assignedAt:now});
  await setDoc(normRef, {id:normId,materialId,materialName:originalMaterial,unit:'Tấm',category:'Tấm',quotaQuantity:100,revision:1,createdAt:now,updatedAt:now,deleted:false,deletedAt:null});
  for (const voucher of fixtures) await commitWarehouseTransactionAtomic(projectId,voucher);
  await saveEquipmentCatalogBatch(projectId,[equipmentInput]);
}
const snapshotLedger = async () => {
  const read = async (name:string) => (await getDocsFromServer(collection(db,'projects',projectId,name))).docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id.localeCompare(b.id));
  return {inventory:await read('inventory'),balances:await read('inventory_balances')};
};
const fixtureActions = {
  snapshotLedger,
  rename: async (round:number) => {
    if(role !== 'ADMIN') throw Error('Fixture rename requires admin');
    await updateDoc(normRef,{materialName:'Tấm mới kiểm thử '+round,revision:round+1,updatedAt:Date.now()});
    await saveEquipmentCatalogBatch(projectId,[{...equipmentInput,id:equipmentId,revision:round,displayName:'Máy khoan mới kiểm thử '+round}]);
  },
  denyViewer: async () => {
    if(role !== 'VIEWER') throw Error('Fixture requires viewer');
    const results=await Promise.allSettled([
      updateDoc(normRef,{materialName:'Sai quyền',revision:9,updatedAt:Date.now()}),
      updateDoc(equipmentRef,{displayName:'Sai quyền',revision:9,updatedAt:Date.now()})
    ]);
    return results.every(result=>result.status==='rejected' && (result.reason as {code?:string}).code==='permission-denied');
  },
  offline:()=>disableNetwork(db), online:()=>enableNetwork(db)
};
(window as any).__warehouseLabelFixture=fixtureActions;
const orderSync={draft:{},expectedDate:'',cloudState:'ready',cloudError:'',saveError:'',pendingCount:0,conflicts:[],eligibleLegacyCount:0,canEdit:false,setValue:()=>{},updateExpectedDate:()=>{},flushPending:()=>{},importLocalDraft:()=>{},acceptCloudConflicts:()=>{}} as unknown as WarehouseOrderSync;
const forbidden=()=>{throw Error('Presentation fixture must not mutate vouchers');};
function Fixture(){
  const [inventory,setInventory]=useState<InventoryItem[]>([]);
  const [norms,setNorms]=useState<MaterialNorm[]>([]);
  const [ready,setReady]=useState(false);
  const equipment=useProjectEquipmentLabels(projectId,true);
  useEffect(()=>{
    const unsubA=onSnapshot(collection(db,'projects',projectId,'inventory'), snap=>setInventory(snap.docs.map(d=>d.data() as InventoryItem)));
    const unsubB=onSnapshot(collection(db,'projects',projectId,'material_norms'), snap=>{setNorms(snap.docs.map(d=>d.data() as MaterialNorm));setReady(true);});
    return()=>{unsubA();unsubB();};
  },[]);
  return <>
    <output data-fixture-ready>{ready && inventory.length===4 && equipment.length===1?'ready':'loading'}</output>
    <button data-fixture-export onClick={()=>exportWarehouseUpdateTemplate(norms,[],inventory,'Test',{equipmentMaster:equipment})}>Export workbook</button>
    <WarehouseTab isActive quickEditEnabled={false} orderSync={orderSync} currentProjectId={projectId} projectName="Warehouse label fixture"
      inventory={inventory} materialNorms={norms} userRole={role} roleResolved={true} structureConfig={DEFAULT_STRUCTURE_CONFIG}
      onAddInventory={forbidden} onDeleteInventory={forbidden} onOpenNormModal={forbidden}/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
