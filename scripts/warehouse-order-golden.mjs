#!/usr/bin/env node
import './warehouse-report-format-golden.mjs';
/** Runs on CI without Firebase/network. No mutation of inventory or cloud state. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {warehouseOrderKey,parseOrderNumber,parseOrderQuantity,parseOrderWeight,orderWeightSummary,loadWarehouseOrderDraft,saveWarehouseOrderDraft,evaluateWarehouseOrderInput,isWarehouseOrderExpression} from '../src/utils/warehouseCatalogOrder.ts';
const key=(kind,name,unit)=>warehouseOrderKey(kind,name,unit);
assert.notEqual(key('material','Móc treo','cái'),key('material','Móc treo','kg'));
assert.notEqual(key('material','Móc treo','cái'),key('equipment','Móc treo','cái'));
assert.notEqual(key('material','A|B','cái'),key('material','A','B|cái'));
assert.equal(key('material',' Móc treo ','cái'),key('material','móc treo','cái'));
assert.equal(parseOrderNumber('20.000'),20000);
assert.equal(parseOrderQuantity('20,000'),20000);
assert.equal(parseOrderQuantity('1,234,567'),1234567);
assert.equal(parseOrderQuantity('1.234.567'),1234567);
assert.equal(parseOrderQuantity('1,5'),1.5);
assert.equal(parseOrderNumber('0,030'),0.03); // Per-unit kg stays decimal.
assert.equal(parseOrderNumber('0,03'),0.03);
assert.equal(parseOrderWeight('0.030'),0.03);
assert.equal(parseOrderWeight('0,030'),0.03);
assert.equal(parseOrderWeight('0.001'),0.001);
assert.equal(parseOrderWeight('1.000'),1000);
assert.equal(parseOrderWeight('-0.03'),null);
assert.equal(parseOrderNumber('1.234,5'),1234.5);
assert.equal(parseOrderNumber(''),null);
assert.equal(parseOrderNumber('-1'),null);
assert.equal(parseOrderNumber('1+2'),null);
assert.equal(parseOrderNumber('Infinity'),null);
// User formulas are evaluated safely, but the original expression is persisted.
assert.equal(isWarehouseOrderExpression('=12*5'),true);
assert.equal(isWarehouseOrderExpression('(20+10)/2'),true);
assert.equal(isWarehouseOrderExpression('0,030'),false);
assert.equal(evaluateWarehouseOrderInput('=12*5','quantity'),60);
assert.equal(evaluateWarehouseOrderInput('(20+10)/2','quantity'),15);
assert.equal(evaluateWarehouseOrderInput('20,000/2','quantity'),10000);
assert.equal(evaluateWarehouseOrderInput('0.030*2','kgPerUnit'),0.06);
assert.equal(evaluateWarehouseOrderInput('=0.001*3','kgPerUnit'),0.003);
assert.equal(evaluateWarehouseOrderInput('=1.234,5*2','quantity'),2469);
assert.equal(evaluateWarehouseOrderInput('2x(3+4)','quantity'),14);
assert.equal(evaluateWarehouseOrderInput('5:2','kgPerUnit'),2.5);
assert.equal(evaluateWarehouseOrderInput('3/0','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('1+','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('alert(1)','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('Math.max(2,3)','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('(-4)+2','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('10**10','quantity'),null);
assert.equal(evaluateWarehouseOrderInput('=1/3','quantity') !== null,true);

const s=orderWeightSummary([
  {quantity:20000,kgPerUnit:0.03}, // 600kg
  {quantity:300,kgPerUnit:1.5}, // 450kg
  {quantity:20,kgPerUnit:null},
  {quantity:0,kgPerUnit:null},
]);
assert.deepEqual(s,{kilograms:1050,tonnes:1.05,missing:1,selected:3,complete:false});
assert.equal(orderWeightSummary([{quantity:2,kgPerUnit:15}]).complete,true);
const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const first={ [key('material','Móc treo','cái')]:{quantity:100,kgPerUnit:0.02} };
assert.equal(saveWarehouseOrderDraft('project-A',first),true);
assert.deepEqual(loadWarehouseOrderDraft('project-A'),first);
assert.deepEqual(loadWarehouseOrderDraft('project-B'),{});
const formulaKey=key('equipment','Động cơ','bộ');
const formulaDraft={ [formulaKey]:{
  quantity:60,kgPerUnit:0.06,
  quantityExpression:'=12*5',kgPerUnitExpression:'0.030*2',
}};
assert.equal(saveWarehouseOrderDraft('project-B',formulaDraft),true);
assert.deepEqual(loadWarehouseOrderDraft('project-B'),formulaDraft);
store.set('hnl-qltc-order-draft-v1:project-B',JSON.stringify({[formulaKey]:{
  quantity:60,kgPerUnit:0.06,quantityExpression:'=12*0',kgPerUnitExpression:'0.030*2'
}}));
assert.deepEqual(loadWarehouseOrderDraft('project-B'),{[formulaKey]:{
  quantity:60,kgPerUnit:0.06,kgPerUnitExpression:'0.030*2'
}}); // stale expression is dropped, valid numbers never lost.

store.set('hnl-qltc-order-draft-v1:project-A','{"unexpected":{"quantity":-4,"kgPerUnit":1},"a":{"quantity":2,"kgPerUnit":null}}');
assert.deepEqual(loadWarehouseOrderDraft('project-A'),{a:{quantity:2,kgPerUnit:null}});
store.set('hnl-qltc-order-draft-v1:project-A','not JSON');
assert.deepEqual(loadWarehouseOrderDraft('project-A'),{});
for(const file of ['src/components/WarehouseTab.tsx','src/components/WarehouseOrderSheet.tsx','src/components/WarehouseReportActions.tsx','src/utils/warehouseCatalogReport.ts']) {
  const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert(!/\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/.test(text),`${file}: order/report must not write to Firestore`);
}
const orderUI=readFileSync(new URL('../src/components/WarehouseOrderSheet.tsx',import.meta.url),'utf8');
const catalogUI=readFileSync(new URL('../src/components/WarehouseTab.tsx',import.meta.url),'utf8');
assert.match(orderUI,/parseValue=\{parseOrderWeight\}/, 'Per-unit kg must use the weight-specific decimal parser');
assert.match(orderUI,/onFocus=\{\(\)=>\{focused\.current=true;setError\(false\);setText\(expression\|\|format\(value\)\);\}\}/,
  'Focusing an order input must reveal its saved formula');
assert.match(orderUI,/setText\(format\(number\)\)/, 'Blurring a valid formula must show its calculated number');
assert.match(orderUI,/quantityExpression/, 'Order UI must persist quantity formula separately from evaluated number');
assert.match(orderUI,/kgPerUnitExpression/, 'Order UI must persist weight formula separately from evaluated number');

assert.match(catalogUI,/initialKind=\{warehouseCatalogTab\}/, 'Order must open on same material/equipment tab as Catalog');
assert.match(catalogUI,/WarehouseOrderSheet key=\{currentProjectId\}/, 'Switching projects must remount draft state');
const shareUI=readFileSync(new URL('../src/components/WarehouseReportActions.tsx',import.meta.url),'utf8');
// Desktop buttons should be content-sized, never 1/3 or 100% of a wide PC sheet.
// Preserve mobile full-width touch layouts below 960px.
assert.match(shareUI, /data-hnl-warehouse-report-buttons="formats"/, 'Warehouse exports need a stable desktop layout marker');
assert.match(shareUI, /min-\[960px\]:inline-grid min-\[960px\]:grid-cols-\[repeat\(3,112px\)\]/, 'PC export actions must stay compact rather than stretching');
assert.match(catalogUI, /data-hnl-warehouse-open-order="true"[\s\S]{0,430}min-\[960px\]:w-auto/, 'PC order launcher must be content-width');
assert.match(orderUI, /data-hnl-warehouse-order-kind-tabs="true"[^>]*min-\[960px\]:inline-grid min-\[960px\]:grid-cols-\[repeat\(2,160px\)\]/, 'PC order kind tabs must not stretch across the sheet');

assert.match(shareUI,/result\.sharedFiles\s*<\s*prepared\.files\.length/, 'Partial native Android shares must be disclosed to user');
console.log('Warehouse order golden: PASS — unit identity, numeric validation, weights, missing warning, project-scoped draft, no direct Firestore writes');
