/**
 * DEV candidate: ADMIN-owned 1:1 material unit-label correction.
 * Reads canonical catalog, ALL stock vouchers and ALL balances from the SAME
 * Firestore transaction before writing. Never converts quantities, changes IDs,
 * migrates legacy names or permits deleted/restorable vouchers to be orphaned.
 * This is intentionally narrow: equipment and legacy aliases need separate proof.
 */
import { assertWarehouseRole } from './security.mjs';
import { warehouseKey } from './engine.mjs';

const deny = code => { throw new Error(code); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 300
  && value.trim() === value && !value.includes('/') && value !== '.' && value !== '..';
const cleanName = value => String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
const unit = value => String(value || '').trim();
const active = row => row?.deleted !== true && row?.deletedAt == null;
const signed = row => {
  if (!['in','out'].includes(row.type) || typeof row.quantity !== 'number'
    || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1e12)
    deny('WAREHOUSE_RENAME_LEDGER_INVALID');
  return row.type === 'in' ? row.quantity : -row.quantity;
};
const get = async (tx,ref) => { const s = await tx.get(ref); return {exists:s.exists,data:s.exists?s.data():null}; };
const rows = (snapshot,collection) => {
  if (!snapshot || !Array.isArray(snapshot.docs) || snapshot.docs.length > 200)
    deny(`WAREHOUSE_RENAME_${collection}_TOO_LARGE`);
  return snapshot.docs.map(doc => ({id:doc.id,ref:doc.ref || null,value:doc.data()}));
};
const revision = row => Number.isSafeInteger(row?.revision) && row.revision >= 1;

export async function renameTrustedMaterialUnit({db,actor,projectId,kind,materialId,materialName,fromUnit,toUnit}) {
  if (!db || !actor || !id(projectId) || kind !== 'material' || !id(materialId)
      || typeof materialName !== 'string' || !cleanName(materialName) || materialName.length > 180
      || !unit(fromUnit) || !unit(toUnit) || unit(fromUnit).length > 80 || unit(toUnit).length > 80)
    deny('WAREHOUSE_RENAME_INVALID_REQUEST');
  if (unit(fromUnit) === unit(toUnit)) deny('WAREHOUSE_RENAME_NO_CHANGE');
  const root=`projects/${projectId}`;
  const email=String(actor.email||'').trim().toLowerCase();
  return db.runTransaction(async tx => {
    const [project,emailMember,uidMember,normSnapshot,ledgerSnapshot,balanceSnapshot] = await Promise.all([
      get(tx,db.doc(root)),get(tx,db.doc(`${root}/members/${email}`)),get(tx,db.doc(`${root}/members/${actor.uid}`)),
      tx.get(db.collection(`${root}/material_norms`)),
      tx.get(db.collection(`${root}/inventory`)),
      tx.get(db.collection(`${root}/inventory_balances`)),
    ]);
    if(!project.exists)deny('WAREHOUSE_PROJECT_NOT_FOUND');
    assertWarehouseRole({project:project.data,actor,
      emailMembership:emailMember.exists?emailMember.data:null,
      uidMembership:uidMember.exists?uidMember.data:null,permission:'ADMIN'});
    const norms=rows(normSnapshot,'NORMS');
    const ledger=rows(ledgerSnapshot,'LEDGER');
    const balances=rows(balanceSnapshot,'BALANCES');
    const relevant=norms.filter(x=>active(x.value) && x.value.materialId===materialId);
    if(!relevant.length)deny('WAREHOUSE_RENAME_CANONICAL_NORM_NOT_FOUND');
    if(relevant.some(x=>x.value.unit !== fromUnit || cleanName(x.value.materialName)!==cleanName(materialName)
      || x.value.id!==x.id || !revision(x.value)))
      deny('WAREHOUSE_RENAME_NORM_PARITY_FAILED');
    if(norms.some(x=>active(x.value) && x.value.materialId!==materialId
      && cleanName(x.value.materialName)===cleanName(materialName) && x.value.unit===toUnit))
      deny('WAREHOUSE_RENAME_DESTINATION_IDENTITY_COLLISION');
    // Name-key fallback would otherwise silently split one physical material.
    const matching=ledger.filter(x=>x.value?.itemKind!=='equipment'
      && x.value?.materialId===materialId);
    if(matching.some(x=>!active(x.value))) deny('WAREHOUSE_RENAME_RESTORABLE_HISTORY_EXISTS');
    if(matching.some(x=>x.value.id!==x.id || !revision(x.value) || x.value.unit!==fromUnit
      || cleanName(x.value.materialName)!==cleanName(materialName)
      || (x.value.materialKey && x.value.materialKey!==warehouseKey(x.value))))
      deny('WAREHOUSE_RENAME_VOUCHER_PARITY_FAILED');
    // Other same-name/name-only or material-id collision rows must never be
    // silently rewritten, merged or left pointing to an obsolete unit.
    if(ledger.some(x=>x.value?.itemKind!=='equipment'
      && (cleanName(x.value.materialName)===cleanName(materialName)
        || warehouseKey(x.value)===warehouseKey({itemKind:'material',materialId,materialName,unit:fromUnit}))
      && x.value.materialId!==materialId))
      deny('WAREHOUSE_RENAME_LEGACY_OR_ALIAS_LEDGER');
    const key=warehouseKey({itemKind:'material',materialId,materialName,unit:fromUnit});
    const sameKey=balances.filter(x=>x.id===key);
    if(sameKey.length > 1) deny('WAREHOUSE_RENAME_DUPLICATE_BALANCE');
    const bal=sameKey[0];
    if(matching.length && !bal) deny('WAREHOUSE_RENAME_MISSING_BALANCE');
    const total=matching.reduce((sum,x)=>sum+signed(x.value),0);
    if(!Number.isFinite(total) || total < -1e-8)deny('WAREHOUSE_RENAME_NEGATIVE_LEDGER');
    if(bal && (bal.value.id!==key || bal.value.projectId!==projectId
      || !revision(bal.value) || bal.value.renamedTo
      || (bal.value.itemKind && bal.value.itemKind !== 'material')
      || cleanName(bal.value.materialName) !== cleanName(materialName)
      || typeof bal.value.onHand !== 'number' || !Number.isFinite(bal.value.onHand) || bal.value.onHand < 0
      || bal.value.unit!==fromUnit || bal.value.materialId!==materialId
      || Math.abs(bal.value.onHand-total)>1e-6))
      deny('WAREHOUSE_RENAME_BALANCE_LEDGER_MISMATCH');
    if(!matching.length && bal)deny('WAREHOUSE_RENAME_ORPHAN_BALANCE');
    if(relevant.length + matching.length + (bal?1:0) > 140)
      deny('WAREHOUSE_RENAME_TRANSACTION_LIMIT');
    const now=Date.now();
    for(const norm of relevant)tx.set(db.doc(`${root}/material_norms/${norm.id}`),{
      unit:toUnit,revision:norm.value.revision+1,
      updatedAt:Math.max(now,Number(norm.value.updatedAt||0)+1),updatedByUid:actor.uid,
    },{merge:true});
    for(const voucher of matching)tx.set(db.doc(`${root}/inventory/${voucher.id}`),{
      unit:toUnit,revision:voucher.value.revision+1,
      updatedAt:Math.max(now,Number(voucher.value.updatedAt||0)+1),updatedByUid:actor.uid,
    },{merge:true});
    if(bal)tx.set(db.doc(`${root}/inventory_balances/${key}`),{
      unit:toUnit,revision:bal.value.revision+1,
      updatedAt:Math.max(now,Number(bal.value.updatedAt||0)+1),updatedByUid:actor.uid,
    },{merge:true});
    return {norms:relevant.length,vouchers:matching.length,materialKey:key,onHand:total};
  },{maxAttempts:5});
}