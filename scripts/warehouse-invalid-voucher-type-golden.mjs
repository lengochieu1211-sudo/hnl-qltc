import assert from 'node:assert/strict';
import { getWarehouseSignedDelta, calculateWarehouseLedgerOnHand, getWarehouseMaterialKey } from '../src/utils/warehouseLedgerMath.ts';
const voucher = {id:'V1',materialName:'Tấm',unit:'Tấm',type:'in',quantity:10};
const key = getWarehouseMaterialKey(voucher);
assert.equal(getWarehouseSignedDelta({type:'in',quantity:10}),10);
assert.equal(getWarehouseSignedDelta({type:'out',quantity:10}),-10);
assert.equal(calculateWarehouseLedgerOnHand([voucher,{...voucher,id:'V2',type:'out',quantity:3}],key),7);
for (const invalidType of ['withdraw','IN','',null,undefined,0,false]) {
  assert.throws(()=>getWarehouseSignedDelta({type:invalidType,quantity:2}),/INVENTORY_LEDGER_INVALID_TYPE/);
  assert.throws(()=>calculateWarehouseLedgerOnHand([{...voucher,type:invalidType}],key),/INVENTORY_LEDGER_INVALID_TYPE/);
}
assert.throws(()=>getWarehouseSignedDelta({type:'in',quantity:0}),/INVENTORY_LEDGER_INVALID_QUANTITY/);
console.log('WAREHOUSE INVALID VOUCHER TYPE GOLDEN: PASS (7 bad types denied, legacy valid IN/OUT preserved)');
