import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrewTab } from '../../../src/components/CrewTab';
import { WarehouseTab } from '../../../src/components/WarehouseTab';
import { DEFAULT_STRUCTURE_CONFIG } from '../../../src/utils/structureGroupUtils';
import type { InventoryItem, TeamInfo } from '../../../src/types';
import type { WarehouseOrderSync } from '../../../src/hooks/useWarehouseOrderSync';
import '../../../src/index.css';

const projectId = 'demo-hnl-voucher-return';
const mobile = new URLSearchParams(location.search).has('mobile');
const teams: TeamInfo[] = [{ id: 'TEAM-RETURN-1', name: 'Đội kiểm tra Quay lại', leader: 'Người thử', defaultCount: 5 }];
const inventory: InventoryItem[] = [
  { id: 'RETURN-MAT-OUT-1', type: 'out', itemKind: 'material', materialName: 'Ty ren M8', unit: 'Cây',
    quantity: 12, date: '2026-11-19', sourceTeamId: teams[0].id, issuePurpose: 'project-work',
    location: 'Tầng 1', handler: 'Người giao' },
  { id: 'RETURN-EQUIP-OUT-1', type: 'out', itemKind: 'equipment', materialName: 'Máy bắn vít', unit: 'Cái',
    quantity: 2, date: '2026-11-19', sourceTeamId: teams[0].id, issuePurpose: 'project-work',
    location: 'Tầng 1', handler: 'Người giao' },
];
const orderSync = {
  draft: {}, expectedDate: '', cloudState: 'ready', cloudError: '', saveError: '',
  pendingCount: 0, conflicts: [], eligibleLegacyCount: 0, canEdit: false,
  setValue: () => {}, updateExpectedDate: () => {}, flushPending: () => {},
  importLocalDraft: () => {}, acceptCloudConflicts: () => {},
} as unknown as WarehouseOrderSync;
const readOnly = () => { throw Error('Fixture must never mutate inventory or crew records'); };

function Fixture() {
  const [active, setActive] = React.useState<'crew' | 'warehouse'>('crew');
  const [focusVoucher, setFocusVoucher] = React.useState<{ id: string; projectId: string; token: number } | null>(null);
  const token = React.useRef(0);
  const openVoucher = (id: string) => {
    if (!inventory.some(item => item.id === id && item.sourceTeamId === teams[0].id)) return;
    setFocusVoucher({ id, projectId, token: ++token.current });
    setActive('warehouse');
  };
  const returnToCrew = () => {
    const raw = sessionStorage.getItem('qlct_crew_detail_return_v1');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.projectId === projectId) sessionStorage.setItem('qlct_crew_detail_return_v1', JSON.stringify({ ...saved, restore: true }));
    }
    setFocusVoucher(null);
    setActive('crew');
  };
  return <div data-hnl-return-browser-mode={mobile ? 'phone' : 'pc'}>
    {(!mobile || active === 'crew') && <div style={{ display: active === 'crew' ? 'block' : 'none' }}>
      <CrewTab isActive={active === 'crew'} projectId={projectId} quickEditEnabled={false}
        roleResolved userRole="VIEWER" projectName="Công trình Golden" crewRecords={[]}
        floorPlans={[]} structureConfig={DEFAULT_STRUCTURE_CONFIG}
        roomProgressList={[]} defects={[]} workVolumes={[]} inventory={inventory} materialNorms={[]}
        teams={teams} onAddCrewRecord={readOnly} onUpdateCrewRecord={readOnly} onDeleteCrewRecord={readOnly}
        onCopyCrewRecordsFromDate={readOnly} onOpenWarehouseVoucher={openVoucher} />
    </div>}
    {active === 'warehouse' && <WarehouseTab isActive projectName="Công trình Golden" currentProjectId={projectId}
      orderSync={orderSync} quickEditEnabled={false} inventory={inventory} roleResolved userRole="VIEWER"
      materialNorms={[]} structureConfig={DEFAULT_STRUCTURE_CONFIG}
      onAddInventory={readOnly} onDeleteInventory={readOnly} onOpenNormModal={() => {}}
      focusVoucher={focusVoucher} onReturnFromSourceVoucher={returnToCrew} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
