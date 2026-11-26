import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import type { CrewRecord, TeamInfo } from '../types';

/** Narrow transaction for the automatic team creation route. Both writes commit
 * or neither does. An existing ID (including a tombstone) is never overwritten. */
export async function commitCrewAutoTeamPair(db:Firestore,projectId:string,team:TeamInfo,record:CrewRecord,original?:CrewRecord):Promise<{team:TeamInfo;record:CrewRecord}> {
  if (!projectId || !team.id || !record.id || record.teamId!==team.id || record.teamName!==team.name) throw new Error('Liên kết đội/quân số không hợp lệ.');
  const teamRef=doc(db,'projects',projectId,'teams',team.id);
  const crewRef=doc(db,'projects',projectId,'crew_records',record.id);
  return runTransaction(db,async tx=>{
    const t=await tx.get(teamRef);
    const c=await tx.get(crewRef);
    if(t.exists()) throw new Error('Mã đội đã tồn tại hoặc đã xóa. Chưa lưu; hãy kiểm tra danh mục.');
    if(original) {
      const current=c.data() as CrewRecord|undefined;
      if(!current || current.deletedAt!=null || current.id!==original.id ||
          Number(current.revision||0)!==Number(original.revision||0) || Number(current.updatedAt||0)!==Number(original.updatedAt||0)) throw new Error('Ghi nhận đã thay đổi trên thiết bị khác. Chưa lưu đội hoặc quân số.');
    } else if(c.exists()) throw new Error('Mã ghi nhận đã tồn tại. Chưa tạo đội.');
    tx.set(teamRef,team);
    tx.set(crewRef,record,{merge:!!original});
    return {team,record};
  },{maxAttempts:3});
}
