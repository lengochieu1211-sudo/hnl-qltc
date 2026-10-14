import React from 'react';
import { createRoot } from 'react-dom/client';
import { WarehouseTab } from '../../../src/components/WarehouseTab';
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
createRoot(document.getElementById('root')!).render(<div className="min-h-screen bg-slate-100 p-4">
<WarehouseTab isActive quickEditEnabled={false} currentProjectId="" inventory={inventory} userRole="VIEWER" roleResolved
materialNorms={materialNorms} structureConfig={DEFAULT_STRUCTURE_CONFIG}
onAddInventory={()=>{throw new Error('Read-only fixture');}}
onDeleteInventory={()=>{throw new Error('Read-only fixture');}}
onOpenNormModal={()=>{throw new Error('Read-only fixture');}}/>
</div>);
