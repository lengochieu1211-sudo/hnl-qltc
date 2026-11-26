import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrewTab } from '../../../src/components/CrewTabBase';
import { DEFAULT_STRUCTURE_CONFIG } from '../../../src/utils/structureGroupUtils';
import type { FloorPlan, RoomProgressItem, TeamInfo, WorkVolume } from '../../../src/types';
import '../../../src/index.css';
import '../../../src/styles/desktopWorkspace.css';
import '../../../src/styles/desktopWorkspaceDeep.css';
import '../../../src/styles/desktopWorkspaceCompact.css';
import '../../../src/styles/desktopWorkspacePro.css';
import '../../../src/styles/desktopWorkspaceGeminiModules.css';

const teamA:TeamInfo={id:'TEAM-A',name:'Đội Golden A',leader:'Trưởng A',defaultCount:3};
const teamB:TeamInfo={id:'TEAM-B',name:'Đội Golden B',leader:'Trưởng B',defaultCount:2};
const categoryName='Trần thạch cao khung nổi 610x610 tấm tiêu chuẩn (NC+VT) – tên hạng mục dài cần hiển thị đầy đủ';
const stageName='Thi công khung xương trần thạch cao khung nổi và gia cố bổ sung theo bản vẽ shopdrawing';
const floor:FloorPlan={id:'F1',floorName:'Tầng 1',imageUrl:'',uploadedAt:'2026-11-26'};
const work:WorkVolume={id:'CAT-1',workCategoryId:'CAT-1',title:categoryName,floor:'Tầng 1',floorId:floor.id,floorIds:[floor.id],category:'Trần',unit:'m²',planned:19703.81,actual:0,unitPrice:0,status:'Chưa thi công'};
const room:RoomProgressItem={
 id:'R1',roomName:'Căn / Phòng 3',floorId:floor.id,floorName:floor.floorName,workCategory:categoryName,workCategoryId:work.id,
 categoryVolumes:{[work.id]:19703.81},categoryVolumeUnits:{[work.id]:'m²'},workVolume:19703.81,volumeUnit:'m²',
 assignedTeam:teamA.name,teamId:teamA.id,x:10,y:10,width:20,height:20,updatedAt:1,frameStatus:'Chưa làm',boardStatus:'Chưa làm',inspectionStatus:'Chưa nghiệm thu',
 subItems:[
  {id:'S1',name:stageName,workCategoryId:work.id,teamId:teamA.id,workVolume:120.25,volumeUnit:'m²',status:'Đang làm'},
  {id:'S2',name:'Thi công Tấm',workCategoryId:work.id,teamId:teamA.id,workVolume:115,volumeUnit:'m²',status:'Chưa làm'},
  {id:'S3',name:'Lắp đặt ty treo',workCategoryId:work.id,teamId:teamA.id,workVolume:0,volumeUnit:'Cái',status:'Chưa làm'},
  {id:'S4',name:'Chưa nhập KL',workCategoryId:work.id,teamId:teamA.id,status:'Chưa làm'},
  ...Array.from({length:8},(_,i)=>({id:'EXTRA-'+i,name:'Công đoạn bổ sung '+(i+1),workCategoryId:work.id,teamId:teamA.id,workVolume:i+1,status:'Chưa làm' as const})),
  {id:'OTHER',name:'Công đoạn đội khác',workCategoryId:work.id,teamId:teamB.id,assignedTeam:teamA.name,workVolume:77,volumeUnit:'md',status:'Đã hoàn thành',inspectionStatus:'Đạt nghiệm thu'},
 ]
};
if(new URLSearchParams(location.search).get('dark')==='1') document.documentElement.dataset.hnlTheme='dark';
const forbidden=()=>{throw new Error('Read-only fixture: writes forbidden');};
createRoot(document.getElementById('root')!).render(<CrewTab isActive quickEditEnabled={false} projectId="fixture-team-detail-dev" projectName="Golden" roleResolved userRole="VIEWER"
  crewRecords={[]} floorPlans={[floor]} structureConfig={DEFAULT_STRUCTURE_CONFIG} roomProgressList={[room]} defects={[]} workVolumes={[work]} inventory={[]} materialNorms={[]} teams={[teamA,teamB]}
  onAddCrewRecord={forbidden} onUpdateCrewRecord={forbidden} onDeleteCrewRecord={forbidden} onCopyCrewRecordsFromDate={forbidden}/>);
