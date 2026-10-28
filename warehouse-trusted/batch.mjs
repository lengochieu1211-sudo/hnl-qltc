/** DEV-only ADMIN import. The complete voucher set and every affected balance
 * are validated in one Firestore read-before-write transaction. There is no
 * partial-success response and no client-side stock arithmetic. */
import {assertWarehouseRole} from './security.mjs';
import {validatedVoucher, warehouseKey} from './engine.mjs';
import {assertManualProvenance} from './manual-provenance.mjs';
const fail = code => { throw new Error(code); };
const id = x => typeof x==='string' && x.length>0 && x.length<=300 && x.trim()===x && !x.includes('/') && x!=='.' && x!=='..' && !x.startsWith('__');
const active = row => row && row.deleted!==true && row.deletedAt==null;
const sign = item => item.type==='in'?item.quantity:-item.quantity;
const near = n => Math.abs(n)<1e-8?0:n;
const same = (a,b) => JSON.stringify(a??null)===JSON.stringify(b);
const read = async(tx,ref) => {const s=await tx.get(ref);return {exists:s.exists,data:s.exists?s.data():null};};
const ref = (db,root,collection,name)=>db.doc(`${root}/${collection}/${name}`);
const normalizeUnit = value=>String(value||'').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export async function importWarehouseBatchAtomic({db,actor,projectId,operations}) {
  if(!db || !actor?.uid || !id(projectId) || !Array.isArray(operations) ||
    operations.length===0 || operations.length>30)fail('WAREHOUSE_BATCH_INVALID_REQUEST');
  // Validate everything before even starting the Cloud transaction.
  const incoming=operations.map(op=>{
    if(!op || typeof op!=='object' || Array.isArray(op) ||
       Object.keys(op).some(k=>!['action','transactionId','item','expectedRevision'].includes(k)) ||
       !['create','update'].includes(op.action) || !id(op.transactionId))
      fail('WAREHOUSE_BATCH_INVALID_OPERATION');
    const item=validatedVoucher(op.item,op.transactionId);
    if(op.action==='update' && (!Number.isSafeInteger(op.expectedRevision)||op.expectedRevision<1))
      fail('WAREHOUSE_BATCH_REVISION_REQUIRED');
    return {action:op.action,id:op.transactionId,item,expectedRevision:op.expectedRevision};
  });
  if(new Set(incoming.map(x=>x.id)).size!==incoming.length)fail('WAREHOUSE_BATCH_DUPLICATE_ID');
  const email=String(actor.email||'').trim().toLowerCase();
  if(!email)fail('WAREHOUSE_AUTH_REQUIRED');
  const root=`projects/${projectId}`;
  return db.runTransaction(async tx=>{
    const [project,memberEmail,memberUid,...oldDocs]=await Promise.all([
      read(tx,db.doc(root)),read(tx,ref(db,root,'members',email)),read(tx,ref(db,root,'members',actor.uid)),
      ...incoming.map(entry=>read(tx,ref(db,root,'inventory',entry.id))),
    ]);
    if(!project.exists)fail('WAREHOUSE_PROJECT_NOT_FOUND');
    assertWarehouseRole({project:project.data,emailMembership:memberEmail.exists?memberEmail.data:null,
      uidMembership:memberUid.exists?memberUid.data:null,actor,permission:'ADMIN'});
    // Any unsupported/forged source rejects the WHOLE batch.
    for (const entry of incoming) await assertManualProvenance({db,tx,root,item:entry.item});
    const changes=[],keys=new Set();
    for(let i=0;i<incoming.length;i++){
      const op=incoming[i],old=oldDocs[i].exists?oldDocs[i].data:null;
      if(old && old.materialKey && old.materialKey!==warehouseKey(old))
        fail('WAREHOUSE_BATCH_LEGACY_KEY_MISMATCH');
      if(old && !active(old))fail('WAREHOUSE_BATCH_TOMBSTONE_ID_RESERVED');
      if(op.action==='create' && old){
        if(Object.entries(op.item).some(([k,v])=>!same(old[k],v)))fail('WAREHOUSE_BATCH_ID_COLLISION');
        changes.push({...op,old,replay:true});continue;
      }
      if(op.action==='create' && oldDocs[i].exists)fail('WAREHOUSE_BATCH_ID_COLLISION');
      if(op.action==='update' && !old)fail('WAREHOUSE_BATCH_VOUCHER_MISSING');
      if(old?.sourceType && old.sourceType!=='manual')fail('WAREHOUSE_BATCH_SYSTEM_VOUCHER_DENIED');
      if(op.action==='update'){
        const replay=old.revision===op.expectedRevision+1 &&
          Object.entries(op.item).every(([k,v])=>same(old[k],v));
        if(Number(old.revision||0)!==op.expectedRevision && !replay)
          fail('WAREHOUSE_BATCH_REVISION_CONFLICT');
        if(replay){changes.push({...op,old,replay:true});continue;}
      }
      const oldKey=old?(old.materialKey||warehouseKey(old)):null;
      const newKey=warehouseKey(op.item);
      if(oldKey)keys.add(oldKey);
      keys.add(newKey);
      changes.push({...op,old,oldKey,newKey,replay:false});
    }
    const sortedKeys=[...keys].sort();
    const snaps=await Promise.all(sortedKeys.map(key=>read(tx,ref(db,root,'inventory_balances',key))));
    const balances=new Map(sortedKeys.map((key,i)=>[key,snaps[i]]));
    const totals=new Map();
    for(const key of sortedKeys){
      const b=balances.get(key);
      if(b.exists && (b.data.id!==key || b.data.projectId!==projectId || b.data.renamedTo ||
        !Number.isFinite(b.data.onHand) || b.data.onHand<0 || b.data.onHand>1e15 ||
        !Number.isSafeInteger(b.data.revision) || b.data.revision<1))
        fail('WAREHOUSE_BATCH_BALANCE_CORRUPT');
      totals.set(key,b.exists?b.data.onHand:0);
    }
    const sourceByKey=new Map();
    const canonicalUnitByKey=new Map();
    for(const change of changes){
      if(change.replay)continue;
      if(change.old && !balances.get(change.oldKey)?.exists)
        fail('WAREHOUSE_BATCH_LEGACY_BALANCE_MISSING');
      const unit=normalizeUnit(change.item.unit);
      if(canonicalUnitByKey.has(change.newKey) && canonicalUnitByKey.get(change.newKey)!==unit)
        fail('WAREHOUSE_BATCH_CONFLICTING_UNITS');
      canonicalUnitByKey.set(change.newKey,unit);
      const b=balances.get(change.newKey);
      if(b?.exists && b.data.unit && normalizeUnit(b.data.unit)!==unit)
        fail('WAREHOUSE_BATCH_UNIT_NOT_CANONICAL');
      if(change.old){
        totals.set(change.oldKey,totals.get(change.oldKey)-sign(change.old));
        sourceByKey.set(change.oldKey,change.old);
      }
      totals.set(change.newKey,totals.get(change.newKey)+sign(change.item));
      sourceByKey.set(change.newKey,change.item);
    }
    for(const value of totals.values()){
      if(!Number.isFinite(value) || value>1e15)fail('WAREHOUSE_BATCH_BALANCE_OVERFLOW');
      if(value<-1e-8)fail('WAREHOUSE_BATCH_INSUFFICIENT_STOCK');
    }
    // Writes happen ONLY after all source, role, revision, and stock reads/checks.
    const now=Date.now();
    for(const [key,item] of sourceByKey){
      const balance=balances.get(key),data=balance.data||{};
      tx.set(ref(db,root,'inventory_balances',key),{
        ...data,id:key,projectId,itemKind:item.itemKind==='equipment'?'equipment':'material',
        materialId:item.materialId||null,materialName:item.materialName,unit:item.unit,
        onHand:near(totals.get(key)),revision:Number(data.revision||0)+1,
        updatedAt:Math.max(now,Number(data.updatedAt||0)+1),updatedByUid:actor.uid,
      });
    }
    for(const change of changes){
      if(change.replay)continue;
      const previous=change.old,nowVoucher=Math.max(now,Number(previous?.updatedAt||0)+1);
      tx.set(ref(db,root,'inventory',change.id),{
        ...(previous||{}),...change.item,materialKey:change.newKey,
        revision:previous?change.expectedRevision+1:1,
        ...(previous?{}:{createdAt:nowVoucher,createdByUid:actor.uid,deleted:false,deletedAt:null,
          deletedBy:null,deletedByUid:null}),
        updatedAt:nowVoucher,updatedByUid:actor.uid,
      });
    }
    return {count:changes.length,written:changes.filter(c=>!c.replay).length,
      duplicates:changes.filter(c=>c.replay).length,materialKeys:sortedKeys};
  },{maxAttempts:5});
}
