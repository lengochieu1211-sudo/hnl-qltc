import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CrewTab} from '../../../src/components/CrewTab';
import {DEFAULT_STRUCTURE_CONFIG} from '../../../src/utils/structureGroupUtils';
import {crewAutoTeamId,planCrewLogTeamLink} from '../../../src/utils/teamDirectoryIntegrity';
import {db,FIREBASE_EMULATOR_ENABLED,APP_ENVIRONMENT,signInWithEmulatorTestAccount,commitNewCrewTeamAndLog} from '../../../src/lib/firebaseBase';
import {doc,setDoc,getDocsFromServer,collection} from 'firebase/firestore';
import type {TeamInfo,CrewRecord,FloorPlan,WorkVolume} from '../../../src/types';
import '../../../src/index.css';
import '../../../src/styles/desktopWorkspace.css';
import '../../../src/styles/desktopWorkspaceCompact.css';
if (!FIREBASE_EMULATOR_ENABLED || APP_ENVIRONMENT!=='DEV' || location.hostname!=='127.0.0.1') throw Error('Fixture requires local DEV emulator');
const projectId='crew-auto-team-fixture-'+new URLSearchParams(location.search).get('profile');
const user=await signInWithEmulatorTestAccount('ADMIN');
await setDoc(doc(db,'projects',projectId),{id:projectId,name:'Fixture',ownerUid:user.uid,ownerEmail:user.email,createdAt:Date.now(),updatedAt:Date.now()});
const existing:TeamInfo={id:'T-EXIST',name:'Đội có sẵn',leader:'Trưởng có sẵn',defaultCount:5};
await setDoc(doc(db,'projects',projectId,'teams',existing.id),{...existing,createdAt:Date.now(),updatedAt:Date.now(),revision:1,deleted:false,deletedAt:null,createdByUid:user.uid});
const floors:FloorPlan[]=[{id:'F1',floorName:'Tầng 1',imageUrl:'',uploadedAt:'2026-11-26'}];
const catalog:WorkVolume[]=[];
const forbidden=()=>{throw Error('Fixture form must call new save callback');};
function Fixture(){
 const [teams,setTeams]=useState<TeamInfo[]>([existing]);
 const [records,setRecords]=useState<CrewRecord[]>([]);
 const [failure,setFailure]=useState(false);
 const [ack,setAck]=useState(0);
 const save=async(record:CrewRecord,editing:boolean)=>{
  const p=planCrewLogTeamLink(teams,record,editing?records.find(r=>r.id===record.id):undefined,true,crewAutoTeamId(record.teamName),Date.now());
  if(p.ok===false)throw Error(p.error);
  if(failure)throw Error('Fixture deliberately rejects save');
  if(p.teams!==teams){
    const pair=await commitNewCrewTeamAndLog(projectId,p.teams.find(t=>t.id===p.record.teamId)!,p.record);
    setTeams(prev=>[...prev,pair.team]);setRecords(prev=>[...prev,pair.record]);
  }else{setRecords(prev=>[...prev,p.record]);}
  const teamDocs=await getDocsFromServer(collection(db,'projects',projectId,'teams'));
  const crewDocs=await getDocsFromServer(collection(db,'projects',projectId,'crew_records'));
  (window as any).__fixtureCloud={teams:teamDocs.docs.map(d=>d.data()),records:crewDocs.docs.map(d=>d.data())};
  setAck(n=>n+1);return true;
 };
 return <><button data-fixture-failure onClick={()=>setFailure(v=>!v)}>Toggle test failure</button><output data-fixture-ack>{ack}</output><output data-fixture-local>{JSON.stringify({teams,records})}</output><CrewTab isActive projectId={projectId} projectName="Fixture" roleResolved userRole="ADMIN" currentUserUid={user.uid} crewRecords={records} floorPlans={floors} structureConfig={DEFAULT_STRUCTURE_CONFIG} roomProgressList={[]} defects={[]} workVolumes={catalog} inventory={[]} materialNorms={[]} teams={teams} onAddCrewRecord={forbidden} onUpdateCrewRecord={forbidden} onSaveCrewLogWithTeam={save} onDeleteCrewRecord={forbidden} onCopyCrewRecordsFromDate={forbidden}/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
