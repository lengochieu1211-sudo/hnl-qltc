import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrewTab, type CrewVoucherOrigin, type CrewVoucherReturnRequest } from '../../../src/components/CrewTabBase';
import { WarehouseTab } from '../../../src/components/WarehouseTab';
import { DEFAULT_STRUCTURE_CONFIG } from '../../../src/utils/structureGroupUtils';
import type { InventoryItem, MaterialNorm, TeamInfo } from '../../../src/types';
import type { WarehouseOrderSync } from '../../../src/hooks/useWarehouseOrderSync';
import '../../../src/index.css';

const projectId='test-source-return-dev';
const team:TeamInfo={id:'TEAM-RETURN-001',name:'Đội HNL Golden',leader:'Trưởng đội Golden',defaultCount:3};
const norms:MaterialNorm[]=[{id:'NORM-RETURN',materialId:'MAT-RETURN',materialName:'Tấm thạch cao Golden Return',category:'Tấm thạch cao',unit:'Tấm',quotaQuantity:100}];
const inventory:InventoryItem[]=[
 {id:'FLOW-OUT-MAT-001',itemKind:'material',type:'out',materialId:'MAT-RETURN',materialName:'Tấm thạch cao Golden Return',unit:'Tấm',quantity:7,date:'2026-11-17',location:'Tầng 2',handler:'Người xuất',sourceTeamId:team.id,issuePurpose:'project-work'},
 {id:'FLOW-OUT-EQUIP-002',itemKind:'equipment',type:'out',materialName:'Máy bắn vít Golden Return',unit:'Cái',quantity:2,date:'2026-11-18',location:'Tầng 2',handler:'Người xuất',sourceTeamId:team.id,issuePurpose:'project-work'},
];
const orderSync={
 draft:{},expectedDate:'',cloudState:'ready',cloudError:'',saveError:'',pendingCount:0,conflicts:[],eligibleLegacyCount:0,canEdit:false,
 setValue:()=>{},updateExpectedDate:()=>{},flushPending:()=>{},importLocalDraft:()=>{},acceptCloudConflicts:()=>{},
} as unknown as WarehouseOrderSync;
const forbidden=()=>{throw new Error('Fixture is read-only: no stock or crew writes permitted');};

function ReturnFixture(){
 const mobile=window.innerWidth<500;
 const [tab,setTab]=React.useState<'crew'|'warehouse'>('crew');
 const [origin,setOrigin]=React.useState<CrewVoucherOrigin|null>(null);
 const [returnRequest,setReturnRequest]=React.useState<CrewVoucherReturnRequest|null>(null);
 const [focus,setFocus]=React.useState<{id:string;projectId:string;token:number}|null>(null);
 const openVoucher=(id:string,source:CrewVoucherOrigin)=>{
   if(source.projectId!==projectId || source.teamId!==team.id || !inventory.some(row=>row.id===id&&row.type==='out'&&row.sourceTeamId===team.id))return;
   setOrigin(source);setReturnRequest(null);setFocus({id,projectId,token:Date.now()});setTab('warehouse');
 };
 const returnToCrew=()=>{
   if(!origin || origin.projectId!==projectId)return;
   setFocus(null);
   setReturnRequest(prev=>({...origin,token:(prev?.token||0)+1}));
   setTab('crew');
 };
 return <div>
  <div data-hnl-fixture-active-tab={tab} className="p-1 text-xs">{tab}</div>
  {(tab==='crew'||!mobile)&&<div style={{display:tab==='crew'?'block':'none'}} data-hnl-fixture-crew="true">
   <CrewTab isActive={tab==='crew'} quickEditEnabled={false} projectId={projectId} roleResolved userRole="VIEWER"
    crewRecords={[]} floorPlans={[]} structureConfig={DEFAULT_STRUCTURE_CONFIG}
    roomProgressList={[]} defects={[]} workVolumes={[]} inventory={inventory} materialNorms={norms}
    teams={[team]} onAddCrewRecord={forbidden} onUpdateCrewRecord={forbidden} onDeleteCrewRecord={forbidden}
    onCopyCrewRecordsFromDate={forbidden} onOpenWarehouseVoucher={openVoucher}
    voucherReturnRequest={returnRequest} onVoucherReturnRestored={token=>setReturnRequest(prev=>prev?.token===token?null:prev)} />
  </div>}
  {tab==='warehouse'&&<div data-hnl-fixture-warehouse="true">
   <WarehouseTab isActive currentProjectId={projectId} quickEditEnabled={false}
    orderSync={orderSync} inventory={inventory} materialNorms={norms} structureConfig={DEFAULT_STRUCTURE_CONFIG}
    userRole="VIEWER" roleResolved onAddInventory={forbidden} onDeleteInventory={forbidden}
    onOpenNormModal={forbidden} focusVoucher={focus} onReturnFromSourceVoucher={returnToCrew}/>
  </div>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<ReturnFixture/>);