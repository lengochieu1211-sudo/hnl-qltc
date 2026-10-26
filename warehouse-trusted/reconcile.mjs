/**
 * P12 DEV-only, ADMIN-authorized ledger -> balance repair.
 * The entire inventory query and target balance are read inside a single
 * Firestore transaction. Large projects FAIL CLOSED, rather than producing
 * a stale snapshot-based balance or doing partial/chunked repairs.
 * This does NOT verify historical voucher provenance or bless a ledger snapshot.
 */
import {assertWarehouseRole} from './security.mjs';
import {warehouseKey} from './engine.mjs';
const fail=code=>{throw new Error(code);};
const id=x=>typeof x==='string' && x && x.trim()===x && !x.includes('/') && x!=='.' && x!=='..' && x.length<=300;
const get=async(tx,r)=>{const s=await tx.get(r);return {exists:s.exists,data:s.exists?s.data():null};};
const delta=row=>{
  if(row.type!=='in' && row.type!=='out' || typeof row.quantity!=='number' ||
    !Number.isFinite(row.quantity)||row.quantity<=0||row.quantity>1e12)fail('WAREHOUSE_RECONCILE_INVALID_LEDGER');
  return row.type==='in'?row.quantity:-row.quantity;
};
export async function reconcileTrustedWarehouseBalance({db,actor,projectId,materialKey}){
  if(!db||!actor||!id(projectId)||!id(materialKey))fail('WAREHOUSE_RECONCILE_INVALID_INPUT');
  const root=`projects/${projectId}`;
  const email=String(actor.email||'').trim().toLowerCase();
  return db.runTransaction(async tx=>{
    const [project,memberEmail,memberUid,ledger,balance]=await Promise.all([
      get(tx,db.doc(root)),get(tx,db.doc(`${root}/members/${email}`)),
      get(tx,db.doc(`${root}/members/${actor.uid}`)),
      tx.get(db.collection(`${root}/inventory`)),
      get(tx,db.doc(`${root}/inventory_balances/${materialKey}`)),
    ]);
    if(!project.exists)fail('WAREHOUSE_PROJECT_NOT_FOUND');
    assertWarehouseRole({project:project.data,emailMembership:memberEmail.exists?memberEmail.data:null,
      uidMembership:memberUid.exists?memberUid.data:null,actor,permission:'ADMIN'});
    if(project.data.migrationSandbox!==true || project.data.migrationSource!=='DEV_COPY')
      fail('WAREHOUSE_RECONCILE_NOT_ISOLATED_DEV_COPY');
    // Limit heavy full-scan repairs. For larger ledgers a dedicated indexed
    // migration/maintenance job must be designed and independently certified.
    if(!Array.isArray(ledger.docs) || ledger.docs.length>500)fail('WAREHOUSE_RECONCILE_LEDGER_TOO_LARGE');
    if(balance.exists && (balance.data.renamedTo || balance.data.id!==materialKey ||
      balance.data.projectId!==projectId))fail('WAREHOUSE_RECONCILE_INVALID_BALANCE');
    let total=0,count=0,example=null;
    for(const snap of ledger.docs){
      const row=snap.data();
      if(!row || typeof row!=='object')fail('WAREHOUSE_RECONCILE_INVALID_LEDGER');
      // A forged/stale explicit key must never be used to reconcile a different
      // material. Do not bless a potentially corrupted ledger by repairing stock.
      const derivedKey=warehouseKey(row);
      if(row.materialKey && row.materialKey!==derivedKey)fail('WAREHOUSE_RECONCILE_VOUCHER_KEY_MISMATCH');
      if(derivedKey!==materialKey)continue;
      if(row.id!==snap.id)fail('WAREHOUSE_RECONCILE_INVALID_LEDGER');
      if(row.deleted===true || row.deletedAt!=null)continue;
      total+=delta(row);count++;
      if(!example)example=row;
    }
    if(count===0)fail('WAREHOUSE_RECONCILE_NO_ACTIVE_LEDGER');
    if(!Number.isFinite(total)||total<-1e-8||total>1e15)fail('WAREHOUSE_RECONCILE_INVALID_TOTAL');
    if(balance.exists && (
      !Number.isSafeInteger(balance.data.revision)||balance.data.revision<1||
      !Number.isFinite(balance.data.onHand)||balance.data.onHand<0
    ))fail('WAREHOUSE_RECONCILE_INVALID_BALANCE');
    const now=Math.max(Date.now(),Number(balance.data?.updatedAt||0)+1);
    const value={...balance.data,id:materialKey,projectId,
      itemKind:example.itemKind==='equipment'?'equipment':'material',
      materialId:example.materialId||null,materialName:example.materialName,unit:example.unit,
      onHand:Math.abs(total)<1e-8?0:total,
      revision:Number(balance.data?.revision||0)+1,updatedAt:now,updatedByUid:actor.uid};
    tx.set(db.doc(`${root}/inventory_balances/${materialKey}`),value);
    return {materialKey,onHand:value.onHand,revision:value.revision,activeVoucherCount:count};
  },{maxAttempts:5});
}