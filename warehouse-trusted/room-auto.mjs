/** DEV-only trusted room issue. Supports ONLY canonical unambiguous rooms; rejects
 * legacy/ambiguous layouts BEFORE any voucher or balance write. Never accept a
 * client-computed quantity, material, norm, category, or deterministic receipt ID.
 */
import {assertWarehouseRole} from './security.mjs';
import {warehouseKey} from './engine.mjs';
const fail = code => {throw new Error(code);};
const active = x => x && x.deleted !== true && x.deletedAt == null;
const id = x => typeof x==='string' && x.length>0 && x.length<=300 && x.trim()===x && !x.includes('/') && x!=='.' && x!=='..' && !x.startsWith('__');
const epsilon=1e-8;
const snapRow = async(tx,r) => {const s=await tx.get(r);return s.exists?s.data():null;};
const rows = async(tx,db,p,max) => {
  // Server-side LIMIT prevents accidentally reading the entire large project.
  const s=await tx.get(db.collection(p).limit(max+1));
  if(s.docs.length>max)fail('WAREHOUSE_ROOM_LEDGER_TOO_LARGE');
  return s.docs.map(x=>x.data());
};
const stableHash = val => {let h=0x811c9dc5;for(const c of String(val)){h^=c.charCodeAt(0);h=Math.imul(h,0x01000193);}return (h>>>0).toString(36).toUpperCase().padStart(7,'0');};
const normUnit=x=>String(x||'').trim().normalize('NFKC').toLowerCase();
const sameUnit=(a,b)=>normUnit(a)===normUnit(b);
const money=x=>Math.round(x*1e8)/1e8;
export const autoReceiptId = (roomId,materialKey)=>`AUTO-XK-${stableHash(`${roomId}|${materialKey}`)}`;
export const stableIssueId = key=>`AUTO-XK-${stableHash(key)}`;
export async function issueTrustedRoomMaterials({db,actor,projectId,roomId,expectedRoomRevision,expectedRoomUpdatedAt}) {
  if(!Number.isSafeInteger(expectedRoomRevision)||expectedRoomRevision<0||
      !Number.isSafeInteger(expectedRoomUpdatedAt)||expectedRoomUpdatedAt<0)
    fail('WAREHOUSE_AUTO_INVALID_REQUEST');
  if(!db || !actor?.uid || !id(projectId) || !id(roomId))fail('WAREHOUSE_ROOM_INVALID_REQUEST');
  const email=String(actor.email||'').trim().toLowerCase();if(!email)fail('WAREHOUSE_AUTH_REQUIRED');
  const root=`projects/${projectId}`;
  return db.runTransaction(async tx=>{
    const [project,memberEmail,memberUid,room,work,norms,allVouchers]=await Promise.all([
      snapRow(tx,db.doc(root)),snapRow(tx,db.doc(`${root}/members/${email}`)),
      snapRow(tx,db.doc(`${root}/members/${actor.uid}`)),
      snapRow(tx,db.doc(`${root}/rooms/${roomId}`)),
      rows(tx,db,`${root}/work_volumes`,300),rows(tx,db,`${root}/material_norms`,300),rows(tx,db,`${root}/inventory`,3000),
    ]);
    if(!project || !active(room) || room.id!==roomId || !id(room.floorId))fail('WAREHOUSE_ROOM_NOT_FOUND');
    assertWarehouseRole({project,emailMembership:memberEmail,uidMembership:memberUid,actor,permission:'EDITOR'});
    if(Number(room.revision||0)!==expectedRoomRevision || Number(room.updatedAt||0)!==expectedRoomUpdatedAt)
      fail('WAREHOUSE_AUTO_ROOM_REVISION_CHANGED');
    // Bound reads/writes; unsupported large ledgers must use a paginated server
    // strategy after audit, NOT an incomplete scan that would over-issue stock.
    if(work.length>300 || norms.length>300 || allVouchers.length>3000)fail('WAREHOUSE_ROOM_LEDGER_TOO_LARGE');
    const floor=await snapRow(tx,db.doc(`${root}/floor_plans/${room.floorId}`));
    if(!active(floor) || floor.id!==room.floorId)fail('WAREHOUSE_ROOM_FLOOR_MISMATCH');
    if(!room.categoryVolumes || typeof room.categoryVolumes!=='object' || Array.isArray(room.categoryVolumes))
      fail('WAREHOUSE_ROOM_CANONICAL_VOLUMES_REQUIRED');
    const volumes=Object.entries(room.categoryVolumes).filter(([,v])=>v!==0);
    if(!volumes.length || volumes.length>12)fail('WAREHOUSE_ROOM_CANONICAL_VOLUMES_REQUIRED');
    const plans=new Map();
    for(const [categoryId,volume] of volumes){
      if(!id(categoryId) || typeof volume!=='number' || !Number.isFinite(volume) || volume<=0 || volume>1e9)
        fail('WAREHOUSE_ROOM_UNSAFE_VOLUME');
      const matches=work.filter(w=>active(w) && w.id===categoryId);
      if(matches.length!==1 || !id(matches[0].id) || !matches[0].unit)
        fail('WAREHOUSE_ROOM_CANONICAL_CATEGORY_REQUIRED');
      const w=matches[0];
      if(room.categoryVolumeUnits?.[categoryId] && !sameUnit(room.categoryVolumeUnits[categoryId],w.unit))
        fail('WAREHOUSE_ROOM_VOLUME_UNIT_MISMATCH');
      if(w.floorId && w.floorId!==room.floorId && !(Array.isArray(w.floorIds)&&w.floorIds.includes(room.floorId)))
        fail('WAREHOUSE_ROOM_CATEGORY_FLOOR_MISMATCH');
      const linked=norms.filter(n=>active(n) && n.workCategoryId===categoryId &&
        (!n.workCategoryIds || (n.workCategoryIds.length===1 && n.workCategoryIds[0]===categoryId)));
      // If a norm can apply by a legacy multi-category/name link we cannot
      // prove this catalog complete; refuse, do not silently omit materials.
      if(norms.some(n=>active(n) && (n.workCategoryIds||[]).includes(categoryId) && !linked.includes(n)))
        fail('WAREHOUSE_ROOM_AMBIGUOUS_NORM');
      if(norms.some(n=>active(n) && !linked.includes(n) && (!n.workCategoryId) &&
           (n.workCategory===w.title || (n.workCategories||[]).includes(w.title))))
        fail('WAREHOUSE_ROOM_LEGACY_NORM_REVIEW_FIRST');
      if(!linked.length)fail('WAREHOUSE_ROOM_NORM_MISSING');
      for(const n of linked){
        if(!id(n.id) || !id(n.materialId) || !n.materialName || !n.unit || n.workCategoryNorms && Object.keys(n.workCategoryNorms).length ||
          (n.workCategories && n.workCategories.length>0))fail('WAREHOUSE_ROOM_UNSAFE_NORM');
        const byId=n.workCategoryNormsById;
        if(byId && Object.keys(byId).some(k=>k!==categoryId))fail('WAREHOUSE_ROOM_UNSAFE_NORM');
        const factor=byId && Object.hasOwn(byId,categoryId)?byId[categoryId]:n.unitNormPerM2;
        if(typeof factor!=='number' || !Number.isFinite(factor) || factor<=0 || factor>1e9 ||
          !sameUnit(n.normBasisUnit||w.unit,w.unit))fail('WAREHOUSE_ROOM_UNSAFE_NORM');
        const quantity=money(volume*factor);
        if(quantity<=0 || quantity>1e12)fail('WAREHOUSE_ROOM_UNSAFE_QUANTITY');
        const item={itemKind:'material',materialId:n.materialId,materialName:n.materialName,unit:n.unit};
        const key=warehouseKey(item);
        // Multiple norms for the same material require a different provenance
        // representation than one stable receipt; refuse rather than drop a norm.
        if(plans.has(key))fail('WAREHOUSE_ROOM_MULTIPLE_NORMS_PER_MATERIAL');
        plans.set(key,{key,item,quantity,normId:n.id,categoryId,recordId:autoReceiptId(roomId,key)});
      }
    }
    // Preserve durable team provenance only when one server-verifiable team
    // applies to the entire room. Never guess a Team ID from display text.
    const teamIds=[...new Set([room.teamId,...(room.subItems||[]).map(s=>s?.teamId)].filter(Boolean))];
    if(teamIds.length>1 || (room.assignedTeam && teamIds.length===0))
      fail('WAREHOUSE_ROOM_AMBIGUOUS_TEAM');
    const sourceTeamId=teamIds[0];
    if(sourceTeamId){
      if(!id(sourceTeamId))fail('WAREHOUSE_ROOM_AMBIGUOUS_TEAM');
      const team=await snapRow(tx,db.doc(`${root}/teams/${sourceTeamId}`));
      if(!active(team) || team.id!==sourceTeamId)fail('WAREHOUSE_ROOM_TEAM_NOT_FOUND');
    }
    const byKey=new Map(), manualIssued=new Map(), ledgerByKey=new Map();
    for(const plan of plans.values()){
      manualIssued.set(plan.key,0);ledgerByKey.set(plan.key,0);
    }
    for(const v of allVouchers){
      if(!v?.id)fail('WAREHOUSE_ROOM_LEDGER_CORRUPT');
      // Even deleted deterministic receipts permanently reserve IDs.
      const stableKey=[...plans.values()].find(p=>p.recordId===v.id);
      if(stableKey && !active(v))fail('WAREHOUSE_AUTO_DELETED_RECEIPT_RESERVED');
      if(stableKey && warehouseKey(v)!==stableKey.key)fail('WAREHOUSE_AUTO_ID_COLLISION');
      if(!active(v))continue;
      if(!['in','out'].includes(v.type)||typeof v.quantity!=='number'||
        !Number.isFinite(v.quantity)||v.quantity<=0)fail('WAREHOUSE_ROOM_LEDGER_CORRUPT');
      const key=warehouseKey(v);
      // Never silently ignore alias/legacy vouchers which may belong to this material.
      if(!v.materialId && [...plans.values()].some(p=>
        p.item.materialName===v.materialName && sameUnit(p.item.unit,v.unit)))
        fail('WAREHOUSE_ROOM_LEGACY_ALIAS_RECONCILE_FIRST');
      if(plans.has(key)){
        if(v.materialKey && v.materialKey!==key)fail('WAREHOUSE_ROOM_VOUCHER_KEY_MISMATCH');
        ledgerByKey.set(key,ledgerByKey.get(key)+(v.type==='in'?v.quantity:-v.quantity));
      }
      const legacyAuto=typeof v.notes==='string' && v.notes.startsWith('Tự động xuất kho dự toán tổng hợp cho [') &&
        v.location===`${floor.floorName} - ${room.roomName}` && !v.sourceRoomId;
      if(legacyAuto)fail('WAREHOUSE_ROOM_LEGACY_ISSUES_REVIEW_FIRST');
      if(v.sourceRoomId!==roomId || v.type!=='out')continue;
      if(!plans.has(key))continue;
      if(v.sourceFloorId!==room.floorId || (v.issuePurpose&&v.issuePurpose!=='project-work'))
        fail('WAREHOUSE_ROOM_ISSUE_PROVENANCE_INVALID');
      if(v.sourceType==='room-auto'){
        if(v.sourceIssueKey!==`${roomId}|${key}` || v.id!==autoReceiptId(roomId,key) ||
          !plans.has(key) || byKey.has(key))fail('WAREHOUSE_ROOM_DUPLICATE_AUTO_RECEIPT');
        byKey.set(key,v);
      }else if(v.sourceType==='manual' || !v.sourceType){
        manualIssued.set(key,manualIssued.get(key)+v.quantity);
      }else fail('WAREHOUSE_ROOM_ISSUE_PROVENANCE_INVALID');
    }
    const entries=[];
    for(const plan of plans.values()){
      const prior=byKey.get(plan.key);
      if(prior && (prior.id!==plan.recordId || prior.materialKey!==plan.key || prior.sourceNormId!==plan.normId ||
        prior.sourceFloorId!==room.floorId || prior.sourceWorkCategoryId!==plan.categoryId ||
        prior.materialId!==plan.item.materialId || !sameUnit(prior.unit,plan.item.unit) ||
        !Number.isFinite(prior.quantity) || prior.quantity<0 || !Number.isSafeInteger(prior.revision) || prior.revision<1))
          fail('WAREHOUSE_ROOM_PREVIOUS_RECEIPT_INVALID');
      if(prior && prior.quantity>plan.quantity+epsilon)fail('WAREHOUSE_ROOM_PREVIOUS_OVERISSUE');
      const expected=money(plan.quantity-manualIssued.get(plan.key));
      if(expected < (prior?.quantity||0)-epsilon)fail('WAREHOUSE_ROOM_PREVIOUS_OVERISSUE');
      entries.push({...plan,prior,delta:money(Math.max(0,expected-(prior?.quantity||0))),
        nextQuantity:money(Math.max(0,expected))});
    }
    const balanceRefs=entries.map(x=>db.doc(`${root}/inventory_balances/${x.key}`));
    const stocks=await Promise.all(balanceRefs.map(r=>snapRow(tx,r)));
    const toWrite=[];
    for(let i=0;i<entries.length;i++){
      const e=entries[i],b=stocks[i];
      if(!b || b.id!==e.key || b.projectId!==projectId || b.renamedTo ||
        !Number.isSafeInteger(b.revision) || b.revision<1 || typeof b.onHand!=='number' ||
        !Number.isFinite(b.onHand) || b.onHand<0 || b.onHand>1e15 ||
        (b.materialId && b.materialId!==e.item.materialId) ||
        !sameUnit(b.unit,e.item.unit))fail('WAREHOUSE_ROOM_BALANCE_UNVERIFIED');
      if(!Number.isFinite(ledgerByKey.get(e.key)) ||
        Math.abs(b.onHand-ledgerByKey.get(e.key))>epsilon*Math.max(1,Math.abs(b.onHand)))
          fail('WAREHOUSE_ROOM_LEDGER_BALANCE_MISMATCH');
      if(b.onHand+epsilon<e.delta)fail('WAREHOUSE_ROOM_INSUFFICIENT_STOCK');
      if(e.delta>epsilon)toWrite.push({...e,balance:b,balanceRef:balanceRefs[i]});
    }
    // No writes until every source, role, norm, ledger and stock check passes.
    const now=Date.now();
    for(const e of toWrite){
      tx.set(e.balanceRef,{...e.balance,onHand:money(e.balance.onHand-e.delta),revision:e.balance.revision+1,
        updatedAt:now,updatedByUid:actor.uid});
      const v={...e.prior,id:e.recordId,type:'out',itemKind:'material',...e.item,quantity:e.nextQuantity,
        location:`${floor.floorName} - ${room.roomName}`,handler:room.assignedTeam||'Đội thi công Căn / Phòng',
        date:new Date(now).toISOString().slice(0,10),notes:`Tự động xuất kho dự toán tổng hợp cho [${room.roomName}]`,
        sourceType:'room-auto',issuePurpose:'project-work',sourceRoomId:roomId,sourceFloorId:room.floorId,
        sourceNormId:e.normId,sourceWorkCategoryId:e.categoryId,sourceIssueKey:`${roomId}|${e.key}`,
        ...(sourceTeamId?{sourceTeamId}:{}),
        materialKey:e.key,revision:(e.prior?.revision||0)+1,
        ...(e.prior?{}:{createdAt:now,createdByUid:actor.uid,deleted:false,deletedAt:null}),
        updatedAt:now,updatedByUid:actor.uid};
      // Clearing a stale team link is required when the authoritative room no
      // longer has a single verified team; do not preserve old voucher hints.
      if(!sourceTeamId)delete v.sourceTeamId;
      tx.set(db.doc(`${root}/inventory/${e.recordId}`),v);
    }
    return {roomId,count:toWrite.length,issued:money(toWrite.reduce((sum,e)=>sum+e.delta,0)),duplicate:toWrite.length===0};
  },{maxAttempts:5});
}
