/** QA-only React component harness: actual PR492 RoomHighlightModal with in-memory callbacks. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {RoomHighlightModal} from '../src/components/RoomHighlightModal';
import {createFloorMetricCalibration} from '../src/utils/floorMetricGeometry';
import '../src/index.css';
const scenario=new URL(location.href).searchParams.get('scenario')||'area';
const name=scenario==='wall'?'Vách QA':'Trần QA';
const catId='qa-category-id';
const floorBase={id:'qa-floor',floorName:'Tầng QA',imageRevision:1,imageAssetId:'asset-qa',imageUrl:'https://example.invalid/test-image.png',uploadedAt:'2026-11-24'};
const image={width:1000,height:500};
const calibration=createFloorMetricCalibration(floorBase as any,image,{x:0,y:0},{x:10,y:0},10,123456789);
if(!calibration) throw Error('QA calibration construction failed');
const floor={...floorBase,...(scenario==='noScale'?{}:{highlightMetricCalibration:calibration})};
const room={id:'qa-room',floorId:'qa-floor',floorName:'Tầng QA',roomName:'Phòng QA',x:10,y:20,width:10,height:20,
  ...(scenario==='line'?{isPolyline:true,points:[{x:10,y:20},{x:20,y:20}]}:{}),
  workCategory:name,workVolume:7,volumeUnit:scenario==='line'?'m':'m²',
  categoryVolumes:{[name]:7,...(scenario==='legacy'?{[catId]:8}:{})},
  categoryVolumeUnits:{[name]:scenario==='line'?'m':'m²'},
  inspectionStatus:scenario==='accepted'?'Đạt nghiệm thu':'Chưa nghiệm thu',positionLocked:scenario==='locked',
  frameStatus:'Chưa làm',boardStatus:'Chưa làm',subItems:[{id:'stage-qa',name:'Thi công khung',category:name,status:'Chưa làm',inspectionStatus:'Chưa nghiệm thu'}],
  updatedAt:1234,
};
const volumes=[{id:catId,title:name,unit:scenario==='line'?'m':'m²',workCategoryId:catId}];
(window as any).__qa={scenario,baseRoom:room,savedRooms:[],closed:0};
function Harness(){const [open,setOpen]=React.useState(true);
 return <><div data-hnl-qa-ready="true" data-scenario={scenario} className="absolute left-0 top-0 z-[9999] bg-green-200 p-1 text-[10px]">PR492 FIXTURE</div>
 <RoomHighlightModal isOpen={open} onClose={()=>{(window as any).__qa.closed++;setOpen(false)}} roomItem={room as any} floorPlan={floor as any}
   floorId="qa-floor" floorName="Tầng QA" workVolumes={volumes as any} existingRoomNames={[]}
   structureReadOnly={scenario==='readonly'}
   onSaveRoom={async (next)=>{(window as any).__qa.savedRooms.push(next)}} />
 </>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
