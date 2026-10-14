import React from 'react';
import { createRoot } from 'react-dom/client';
import { CrewReportShareModal } from '../../../src/components/CrewReportShareModal';
import type { CrewReportProjectInput } from '../../../src/utils/crewReportUtils';
import '../../../src/index.css';
const projects: CrewReportProjectInput[]=[{
  projectId:'P0-DEV-CREW',projectName:'Công trình Golden',projectLocation:'Tầng 1',
  teams:[{id:'TA',name:'Đội A',leader:'An',defaultCount:12},{id:'TB',name:'Đội B',leader:'Bình',defaultCount:4}],
  records:[
    {id:'CREW-A',date:'2026-10-14',teamId:'TA',teamName:'Đội A',leaderName:'An',workerCount:12,morningCount:7,afternoonCount:12,eveningCount:8,floorName:'Tầng 1',taskDescription:'Thi công trần'},
    {id:'CREW-B',date:'2026-10-14',teamId:'TB',teamName:'Đội B',leaderName:'Bình',workerCount:4,morningCount:3,afternoonCount:4,eveningCount:0,floorName:'Tầng 1',taskDescription:'Lắp khung'},
  ],
}];
createRoot(document.getElementById('root')!).render(<CrewReportShareModal isOpen onClose={()=>{}} projects={projects}
 initialStartDate="2026-10-14" initialEndDate="2026-10-14" maxDate="2026-10-14" title="BÁO CÁO QUÂN SỐ"/>);
