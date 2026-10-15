import React from 'react';
import { createRoot } from 'react-dom/client';
import { WarehouseTab } from '../../../src/components/WarehouseTab';
import { MaterialNormModal } from '../../../src/components/MaterialNormModal';
import { DEFAULT_STRUCTURE_CONFIG } from '../../../src/utils/structureGroupUtils';
import type { InventoryItem, MaterialNorm } from '../../../src/types';
import '../../../src/index.css';
const name='Tấm thạch cao Golden P0';
const materialNorms:MaterialNorm[]=[{id:'NORM-P0-001',materialId:'MAT-P0-001',materialName:name,category:'Tấm thạch cao',unit:'Tấm',quotaQuantity:100}];
const inventory:InventoryItem[]=[
{id:'P0-IN-20261013-001',itemKind:'material',materialId:'MAT-P0-001',type:'in',materialName:name,unit:'Tấm',quantity:12,date:'2026-10-13',location:'Kho A',handler:'Người nhập P0'},
{id:'P0-IN-20261013-005',itemKind:'material',materialId:'MAT-P0-002',type:'in',materialName:'Ty ren M8 – quy cách 4m',unit:'Cây',quantity:35,date:'2026-10-13',location:'Kho A',handler:'Người nhập P0',notes:'Kiểm tra đủ số lượng trước khi giao'},
{id:'P0-IN-20261012-002',itemKind:'material',materialId:'MAT-P0-001',type:'in',materialName:name,unit:'Tấm',quantity:8,date:'2026-10-12',location:'Kho A',handler:'Người nhập P0'},
{id:'P0-OUT-20261013-003',itemKind:'material',materialId:'MAT-P0-001',type:'out',materialName:name,unit:'Tấm',quantity:5,date:'2026-10-13',location:'Tầng 2',handler:'Người xuất P0'},
{id:'P0-EQUIP-IN-004',itemKind:'equipment',type:'in',materialName:'Máy bắn vít Golden P0',unit:'Cái',quantity:3,date:'2026-10-11',location:'Kho A',handler:'Người nhập P0'}];
function NormLayoutFixture() {
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<'VIEWER' | 'ADMIN'>('ADMIN');
  const [tab, setTab] = React.useState<'material' | 'equipment'>('material');
  const [target, setTarget] = React.useState<{name:string;unit:string}>();
  const [fromCatalog, setFromCatalog] = React.useState(false);
  const [catalogReturnToken, setCatalogReturnToken] = React.useState(0);
  const [duplicate, setDuplicate] = React.useState(false);
  const norms = React.useMemo(() => duplicate
    ? [...materialNorms, {...materialNorms[0],id:'NORM-P0-002',category:'Phụ kiện & Vít',workCategory:'Trần khác'}]
    : materialNorms, [duplicate]);
  const openMaster = (nextTab:'material'|'equipment'='material', nextTarget?:{name:string;unit:string}, returnToCatalog=false) => {
    setTab(nextTab);
    setTarget(nextTarget);
    setFromCatalog(returnToCatalog);
    setOpen(true);
  };
  return <>
    <button type="button" data-hnl-open-norm-fixture="true" onClick={() => openMaster()} className="rounded-xl bg-indigo-700 px-3 py-2 text-white">Kiểm tra form định mức</button>
    <button type="button" data-hnl-fixture-admin="true" onClick={() => setRole('ADMIN')}>Chế độ ADMIN kiểm thử</button>
    <button type="button" data-hnl-fixture-viewer="true" onClick={() => setRole('VIEWER')}>Chế độ VIEWER kiểm thử</button>
    <button type="button" data-hnl-fixture-duplicate="true" onClick={() => setDuplicate(value => !value)}>Định mức trùng tên/ĐVT</button>
    {open && <MaterialNormModal
      isOpen={true} onClose={() => setOpen(false)}
      onReturnToWarehouseCatalog={fromCatalog ? () => {setOpen(false);setCatalogReturnToken(v=>v+1);} : undefined}
      initialTab={tab} initialTarget={target} currentProjectId=""
      userRole={role} roleResolved={true}
      materialNorms={norms} inventory={inventory}
      onAddNorm={() => {}} onUpdateNorm={() => {}} onDeleteNorm={() => {}}
    />}
    <WarehouseTab isActive quickEditEnabled={false} currentProjectId=""
      projectName="Công trình Trung tâm Kiểm thử QLTC"
      projectLocation="123 Đường Thử Nghiệm, Quận 1, TP.HCM"
      contractorName="Công ty Thi công Kiểm thử"
      inventory={inventory} userRole={role} roleResolved
      materialNorms={norms} structureConfig={DEFAULT_STRUCTURE_CONFIG}
      catalogReturnToken={catalogReturnToken}
      onAddInventory={()=>{throw new Error('Read-only fixture');}}
      onDeleteInventory={()=>{throw new Error('Read-only fixture');}}
      onOpenNormModal={openMaster}/>
  </>;
}
createRoot(document.getElementById('root')!).render(<div className="min-h-screen bg-slate-100 p-4">
 <NormLayoutFixture />
</div>);
