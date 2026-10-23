import { collection, doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebaseBase';
import {
  cloudOrderRecord, normalizedDraftValue, type CloudOrderEntry, type DraftValue,
} from '../utils/warehouseOrderSyncCore';

const PATH = 'warehouse_order_drafts';
export class WarehouseOrderRevisionConflict extends Error {
  constructor(){ super('Dòng đặt hàng đã được sửa trên thiết bị khác. Đang giữ bản nhập của máy này để đối chiếu.'); this.name='WarehouseOrderRevisionConflict'; }
}
export function subscribeWarehouseOrderCloud(
  projectId:string,
  onRows:(records:Record<string,CloudOrderEntry>,fromCache:boolean,skippedInvalid:number)=>void,
  onError:(error:Error)=>void,
):Unsubscribe {
  if(!projectId){onRows({},false);return ()=>{};}
  return onSnapshot(collection(db,'projects',projectId,PATH),{includeMetadataChanges:true},snapshot=>{
    const rows:Record<string,CloudOrderEntry>={};
    let invalidCount = 0;
    snapshot.forEach(item=>{
      const row=cloudOrderRecord(item.data(),item.id,projectId);
      // Skip ONLY the malformed identity; other valid revisions remain visible.
      // Local pending edits are retained in the hook and never overwritten.
      if(!row || rows[row.itemKey]){ invalidCount += 1; return; }
      rows[row.itemKey]=row;
    });
    onRows(rows,snapshot.metadata.fromCache,invalidCount);
  },onError);
}
/**
 * Server-side optimistic compare-and-swap: never overwrite another editor's row.
 * Firestore transactions require network connectivity and cannot silently commit offline.
 */
export async function saveWarehouseOrderCloudRow(
  projectId:string,itemKey:string,value:DraftValue,baseRevision:number|null,
):Promise<void>{
  const actor=auth.currentUser;
  if(!actor)throw new Error('Cần đăng nhập Firebase để đồng bộ phiếu đặt hàng.');
  if(!projectId||!itemKey||itemKey.length>500||typeof baseRevision!=='number'&&baseRevision!==null)
    throw new Error('Thiếu dự án hoặc mã dòng đặt hàng.');
  const clean=normalizedDraftValue(value);
  if(!clean)throw new Error('Dữ liệu đặt hàng hoặc ngày dự kiến không hợp lệ.');
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Đang offline; thay đổi vẫn giữ trên máy.');
  const ref=doc(db,'projects',projectId,PATH,encodeURIComponent(itemKey));
  await runTransaction(db,async tx=>{
    const snapshot=await tx.get(ref);
    const revision=snapshot.exists()?Number(snapshot.data().revision):null;
    if(revision!==baseRevision)throw new WarehouseOrderRevisionConflict();
    tx.set(ref,{
      projectId,itemKey,...clean,
      revision:(revision??0)+1,
      updatedAt:Date.now(),updatedByUid:actor.uid,
    });
  },{maxAttempts:3});
}
