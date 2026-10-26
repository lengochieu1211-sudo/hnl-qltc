/** DEV-only canonical equipment unit-label rename. Admin SDK transaction owns all writes.
 * Deliberately refuses orphan/legacy identity, trash, conflicting alias, and target tombstones.
 */
import {assertWarehouseRole} from './security.mjs';
import {warehouseKey} from './engine.mjs';
const fail=code=>{throw new Error(code);};
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=300&&v===v.trim()&&!v.includes('/')&&v!=='.'&&v!=='..'&&!v.startsWith('__');
const identity=v=>String(v||'').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g,' ');
const active=v=>v?.deleted!==true&&v?.deletedAt==null;
const revision=v=>Number.isSafeInteger(v?.revision)&&v.revision>=1;
const read=async(tx,ref)=>{const s=await tx.get(ref);return {exists:s.exists,data:s.exists?s.data():null};};
const records=(snapshot,label)=>{
  if(!Array.isArray(snapshot?.docs)||snapshot.docs.length>180)fail(`WAREHOUSE_EQUIPMENT_${label}_TOO_LARGE`);
  return snapshot.docs.map(s=>({id:s.id,data:s.data()}));
};
const metaFields=['displayName','category','brand','model','specifications','notes'];
const limits={displayName:180,category:120,brand:120,model:120,specifications:1200,notes:1200};
export const equipmentCatalogIdServer=name=>{
  const key=identity(name);
  if(!key||key.length>180)fail('WAREHOUSE_EQUIPMENT_NAME_INVALID');
  return 'EQ-'+Array.from(key).map(ch=>ch.codePointAt(0).toString(16).padStart(6,'0')).join('');
};
export async function renameTrustedEquipmentUnit({db,actor,projectId,kind,materialName,fromUnit,toUnit,equipmentMetadata}){
  if(!db||!actor||!validId(projectId)||kind!=='equipment'||typeof materialName!=='string'||
     !identity(materialName)||materialName.length>180||typeof fromUnit!=='string'||
     typeof toUnit!=='string'||!fromUnit.trim()||!toUnit.trim()||
     fromUnit.trim().length>80||toUnit.trim().length>80||fromUnit===toUnit)
    fail('WAREHOUSE_EQUIPMENT_INVALID_REQUEST');
  const name=materialName.trim(), oldUnit=fromUnit.trim(),newUnit=toUnit.trim();
  const metadata={};
  if(equipmentMetadata!==undefined){
    if(!equipmentMetadata||typeof equipmentMetadata!=='object'||Array.isArray(equipmentMetadata)||
       Object.keys(equipmentMetadata).some(k=>![...metaFields,'expectedRevision'].includes(k)))
      fail('WAREHOUSE_EQUIPMENT_METADATA_INVALID');
    for(const field of metaFields){
      const raw=equipmentMetadata[field];
      if(raw===undefined)continue;
      if(typeof raw!=='string'||raw.length>limits[field])fail('WAREHOUSE_EQUIPMENT_METADATA_INVALID');
      metadata[field]=raw.trim();
    }
    if(!metadata.displayName)fail('WAREHOUSE_EQUIPMENT_METADATA_INVALID');
    if(equipmentMetadata.expectedRevision!==undefined&&
       (!Number.isSafeInteger(equipmentMetadata.expectedRevision)||equipmentMetadata.expectedRevision<1))
      fail('WAREHOUSE_EQUIPMENT_METADATA_INVALID');
  }
  const root=`projects/${projectId}`;
  const email=String(actor.email||'').trim().toLowerCase();
  const catalogId=equipmentCatalogIdServer(name);
  const oldKey=warehouseKey({itemKind:'equipment',materialName:name,unit:oldUnit});
  const newKey=warehouseKey({itemKind:'equipment',materialName:name,unit:newUnit});
  if(oldKey===newKey)fail('WAREHOUSE_EQUIPMENT_KEY_COLLISION');
  return db.runTransaction(async tx=>{
    const [project,memberEmail,memberUid,catalogSnap,ledgerSnap,balanceSnap]=await Promise.all([
      read(tx,db.doc(root)),read(tx,db.doc(`${root}/members/${email}`)),read(tx,db.doc(`${root}/members/${actor.uid}`)),
      tx.get(db.collection(`${root}/equipment_catalog`)),tx.get(db.collection(`${root}/inventory`)),
      tx.get(db.collection(`${root}/inventory_balances`)),
    ]);
    if(!project.exists)fail('WAREHOUSE_PROJECT_NOT_FOUND');
    assertWarehouseRole({project:project.data,actor,
      emailMembership:memberEmail.exists?memberEmail.data:null,
      uidMembership:memberUid.exists?memberUid.data:null,permission:'ADMIN'});
    const catalogs=records(catalogSnap,'CATALOG'),ledger=records(ledgerSnap,'LEDGER'),balances=records(balanceSnap,'BALANCES');
    const cat=catalogs.find(row=>row.id===catalogId)?.data;
    if(!cat||!active(cat)||cat.id!==catalogId||cat.projectId!==projectId||
      identity(cat.name)!==identity(name)||cat.unit!==oldUnit||!revision(cat))
      fail('WAREHOUSE_EQUIPMENT_CATALOG_PARITY');
    if(equipmentMetadata?.expectedRevision!==undefined&&equipmentMetadata.expectedRevision!==cat.revision)
      fail('WAREHOUSE_EQUIPMENT_REVISION_CONFLICT');
    const nextLabel=identity(metadata.displayName||cat.displayName||cat.name);
    // Catalog labels cannot shadow another equipment's immutable identity or label.
    if(catalogs.some(row=>row.id!==catalogId&&active(row.data)&&
      [row.data.name,row.data.displayName].some(label=>identity(label)===nextLabel||identity(label)===identity(name))))
      fail('WAREHOUSE_EQUIPMENT_CATALOG_LABEL_COLLISION');
    // Every matching voucher, including deleted history, must be accounted for.
    const matching=ledger.filter(row=>row.data.itemKind==='equipment'&&identity(row.data.materialName)===identity(name));
    if(!matching.length)fail('WAREHOUSE_EQUIPMENT_LEDGER_MISSING');
    // Slug-based stock keys may collide for different display names (e.g. '/' vs space).
    // A collision must not let this migration consume another equipment's balance.
    if(ledger.some(row=>row.data.itemKind==='equipment' &&
      identity(row.data.materialName)!==identity(name) &&
      [oldKey,newKey].includes(row.data.materialKey||warehouseKey(row.data))))
      fail('WAREHOUSE_EQUIPMENT_KEY_ALIAS_COLLISION');
    if(matching.some(row=>!active(row.data)))fail('WAREHOUSE_EQUIPMENT_RESTORABLE_HISTORY');
    if(matching.some(row=>row.data.id!==row.id||row.data.unit!==oldUnit||!revision(row.data)||
      row.data.materialKey!==oldKey||!['in','out'].includes(row.data.type)||
      typeof row.data.quantity!=='number'||!Number.isFinite(row.data.quantity)||
      row.data.quantity<=0||row.data.quantity>1e12))
      fail('WAREHOUSE_EQUIPMENT_VOUCHER_PARITY');
    // Do not rename an equipment identity that overlaps another identity's display labels.
    if(ledger.some(row=>row.data.itemKind==='equipment'&&identity(row.data.materialName)===nextLabel&&
       identity(row.data.materialName)!==identity(name)))
      fail('WAREHOUSE_EQUIPMENT_LEDGER_LABEL_COLLISION');
    const total=matching.reduce((v,row)=>v+(row.data.type==='in'?row.data.quantity:-row.data.quantity),0);
    if(!Number.isFinite(total)||total<-1e-8||total>1e15)fail('WAREHOUSE_EQUIPMENT_LEDGER_NEGATIVE');
    const old=balances.find(row=>row.id===oldKey)?.data;
    if(!old||old.id!==oldKey||old.projectId!==projectId||old.itemKind!=='equipment'||
       identity(old.materialName)!==identity(name)||old.unit!==oldUnit||!revision(old)||old.renamedTo||
       typeof old.onHand!=='number'||!Number.isFinite(old.onHand)||Math.abs(total-old.onHand)>1e-6)
      fail('WAREHOUSE_EQUIPMENT_BALANCE_PARITY');
    // Never reuse a destination document or merge against a past renamed tombstone.
    if(balances.some(row=>row.id===newKey||
      (row.id!==oldKey&&row.data.itemKind==='equipment'&&identity(row.data.materialName)===identity(name))))
      fail('WAREHOUSE_EQUIPMENT_DESTINATION_OCCUPIED');
    if(matching.length+2>130)fail('WAREHOUSE_EQUIPMENT_TRANSACTION_LIMIT');
    const now=Date.now();
    const nextTime=row=>Math.max(now,Number(row?.updatedAt||0)+1);
    tx.set(db.doc(`${root}/equipment_catalog/${catalogId}`),{
      ...metadata,unit:newUnit,revision:cat.revision+1,updatedAt:nextTime(cat),updatedByUid:actor.uid,
    },{merge:true});
    for(const row of matching)tx.set(db.doc(`${root}/inventory/${row.id}`),{
      unit:newUnit,materialKey:newKey,revision:row.data.revision+1,
      updatedAt:nextTime(row.data),updatedByUid:actor.uid,
    },{merge:true});
    tx.set(db.doc(`${root}/inventory_balances/${oldKey}`),{
      onHand:0,renamedTo:newKey,renamedToUnit:newUnit,revision:old.revision+1,
      updatedAt:nextTime(old),updatedByUid:actor.uid,
    },{merge:true});
    tx.set(db.doc(`${root}/inventory_balances/${newKey}`),{
      id:newKey,projectId,itemKind:'equipment',materialId:null,materialName:name,unit:newUnit,
      onHand:Math.abs(total)<1e-8?0:total,revision:1,updatedAt:now,updatedByUid:actor.uid,
    });
    return {norms:0,vouchers:matching.length,materialKey:newKey,onHand:Math.abs(total)<1e-8?0:total};
  },{maxAttempts:5});
}