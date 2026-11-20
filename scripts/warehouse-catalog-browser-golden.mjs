import assert from 'node:assert/strict';
import fs from 'node:fs';import net from 'node:net';import {spawn} from 'node:child_process';import {chromium} from 'playwright';
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const url=`http://127.0.0.1:${port}/scripts/fixtures/warehouse-catalog/index.html`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'}});
let log='';for(const stream of [server.stdout,server.stderr])stream.on('data',d=>log+=String(d));
const checks=[],errors=[];fs.mkdirSync('runtime-evidence',{recursive:true});let browser;
try{
let running=false;for(let i=0;i<120;i++){try{if((await fetch(url)).ok){running=true;break;}}catch{}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}assert(running,'Vite failed: '+log.slice(-2000));
browser=await chromium.launch({headless:true});
for(const size of [{width:1280,height:800},{width:393,height:852},{width:360,height:640}]){
const label=`${size.width}x${size.height}`;
const ctx=await browser.newContext({viewport:size,locale:'vi-VN',isMobile:size.width<500,hasTouch:size.width<500});const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+': '+e.message));
await page.goto(url,{waitUntil:'domcontentloaded'});
// Warehouse history and no-edit checks exercise VIEWER; norm add/edit fixture defaults to ADMIN.
await page.locator('[data-hnl-fixture-viewer]').click();
const catalogOpener=page.getByRole('button',{name:/Danh mục kho|Danh mục/}).first();
try{await catalogOpener.waitFor({state:'visible',timeout:12000});}catch(error){
  const html=await page.locator('body').innerText().catch(()=>'<no body>');
  const markup=await page.locator('body').innerHTML().catch(()=>'<no body html>');
  console.error('FIXTURE_DIAGNOSTIC',JSON.stringify({label,errors,body:html.slice(0,2500),markup:markup.slice(0,1500),url:page.url()}));
  await page.screenshot({path:`runtime-evidence/catalog-click-error-${label}.png`}).catch(()=>{});
  throw error;
}
await catalogOpener.click();
const sheet=page.locator('[data-hnl-settings-sheet="warehouse-catalog"]');await sheet.waitFor({state:'visible'});
const button=sheet.locator('[data-hnl-catalog-in-history^="material:"]').first();await button.waitFor({state:'visible'});
// Exports and order launcher must fill a narrow touch sheet, but stay compact on PC.
const exportGroup=sheet.locator('[data-hnl-warehouse-report-buttons="formats"]');
await exportGroup.waitFor({state:'visible'});
const exportRect=await exportGroup.boundingBox();
const orderOpener=sheet.locator('[data-hnl-warehouse-open-order="true"]');
const orderRect=await orderOpener.boundingBox();
const sheetRect=await sheet.boundingBox();
assert(exportRect&&orderRect&&sheetRect,label+': missing warehouse export/order controls');
const optionsRect=await sheet.locator('[data-hnl-warehouse-export-options="toggle"]').boundingBox();
assert(optionsRect,label+': options button missing');
if(size.width>=960){
  assert(Math.abs(orderRect.y-optionsRect.y)<=2,label+': PC order launcher should share row with Tùy chọn');
  assert(orderRect.x>=optionsRect.x+optionsRect.width-2,label+': PC order launcher must sit right of Tùy chọn');
}else{
  assert(orderRect.y>=optionsRect.y+optionsRect.height-2,label+': mobile order launcher stays below export actions');
}
if(size.width>=960){
  assert(exportRect.width<=480,label+': PC four-button export group stretched beyond compact design');
  assert(orderRect.width<=300,label+': PC order launcher stretched across entire sheet');
  assert(exportRect.width<sheetRect.width*0.7&&orderRect.width<sheetRect.width*0.7,label+': PC buttons consume most of sheet width');
}else{
  assert(exportRect.width>=sheetRect.width*0.65,label+': touch export group became too narrow');
  assert(orderRect.width>=sheetRect.width*0.65,label+': touch order launcher became too narrow');
}
const catalogTable=sheet.locator('[data-hnl-warehouse-catalog-table="auto-width"]');
assert.equal(await catalogTable.count(),1,label+': auto-width catalog table missing');
const layout=await catalogTable.evaluate(el=>({width:el.scrollWidth,viewport:el.parentElement.clientWidth,whiteSpace:getComputedStyle(el).whiteSpace,rows:[...el.tBodies[0].rows].map(row=>row.getBoundingClientRect().height)}));
assert.equal(layout.whiteSpace,'nowrap',label+': warehouse names must not wrap');
assert(layout.rows.every(height=>height>=31 && height<=33),label+': warehouse catalog rows must stay 32px on PC and mobile');

const rect=await button.boundingBox();assert(rect && rect.height>=31 && rect.height<=33 && rect.width>=40,label+': compact 32px row action on all viewports');await button.click();
const history=sheet.locator('[data-hnl-catalog-history="readonly"]');await history.waitFor({state:'visible'});
await history.getByText('Mã phiếu: P0-IN-20261013-001').waitFor({state:'visible'});
await history.getByText('13/10/2026',{exact:false}).first().waitFor({state:'visible'});
assert((await history.innerText()).includes('12 Tấm'),label+': IN count');
assert(!(await history.innerText()).includes('P0-OUT-20261013-003'),label+': IN/OUT mixed');
const r=await history.boundingBox();assert(r&&r.y<size.height-90,label+': offscreen');
assert.equal(await sheet.locator('[data-hnl-catalog-in-history]').count(),0,label+': catalog still obscures history');

// Actual button click + return (not a source-regex mock). Verify the right entry,
// not just the presence of a Back label. Run at PC, standard phone and small phone.
const inboundVoucherId='P0-IN-20261013-001';
await sheet.locator('[data-hnl-catalog-open-voucher="'+inboundVoucherId+'"]').click();
await sheet.waitFor({state:'hidden'});
const voucherIdButton=page.locator('[data-hnl-warehouse-voucher-id="'+inboundVoucherId+'"]');
await voucherIdButton.waitFor({state:'visible'});
const catalogReturn=page.locator('[data-hnl-voucher-return-origin="catalog-history"]');
await catalogReturn.waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-context-back-button="true"]').count(),1,label+': duplicate inbound voucher Back');
assert.match(await catalogReturn.innerText(),/Quay lại Chi tiết nhập kho/,label+': incorrect Back source');
await catalogReturn.locator('[data-hnl-context-back-button="true"]').click();
await sheet.waitFor({state:'visible'});
await sheet.locator('[data-hnl-catalog-history="readonly"]').waitFor({state:'visible'});
await sheet.locator('[data-hnl-catalog-open-voucher="'+inboundVoucherId+'"]').waitFor({state:'visible'});
assert((await sheet.locator('[data-hnl-catalog-history="readonly"]').innerText()).includes('Mã phiếu: '+inboundVoucherId),
  label+': Back did not restore the exact inbound detail');
assert.equal(await sheet.locator('[data-hnl-catalog-in-history]').count(),0,label+': Back incorrectly returned to catalog table');
checks.push({viewport:label,flow:'catalog-in-voucher-return',result:'PASS'});

await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.locator('[data-hnl-catalog-out-history^="material:"]').first().click();
await history.getByText('Mã phiếu: P0-OUT-20261013-003').waitFor({state:'visible'});
assert((await history.innerText()).includes('5 Tấm'),label+': OUT count');
await sheet.locator('[data-hnl-catalog-open-voucher="P0-OUT-20261013-003"]').click();
await sheet.waitFor({state:'hidden'});
const outBack=page.locator('[data-hnl-voucher-return-origin="catalog-history"]');
await outBack.waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-context-back-button="true"]').count(),1,label+': duplicate outbound voucher Back');
assert.match(await outBack.innerText(),/Quay lại Chi tiết xuất kho/,label+': incorrect OUT Back source');
await outBack.locator('[data-hnl-context-back-button="true"]').click();
await sheet.waitFor({state:'visible'});
await sheet.locator('[data-hnl-catalog-open-voucher="P0-OUT-20261013-003"]').waitFor({state:'visible'});
checks.push({viewport:label,flow:'catalog-out-voucher-return',result:'PASS'});
await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.getByRole('button',{name:'Thiết bị',exact:true}).click();
await sheet.locator('[data-hnl-catalog-in-history^="equipment:"]').first().click();
await history.getByText('Mã phiếu: P0-EQUIP-IN-004').waitFor({state:'visible'});
assert((await history.innerText()).includes('3 Cái'),label+': equipment unit');

// Test the new name-only navigation, without any added icon next to item names.
// In VIEWER role the matching catalog is opened read-only; no edit form is mounted.
await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.getByRole('button',{name:'Vật tư',exact:true}).click();
const preservedSearch='Golden P0';
await sheet.locator('input[type="search"]').fill(preservedSearch);
const materialName=sheet.locator('[data-hnl-catalog-open-master^="material:"]').first();
assert.equal(await materialName.locator('svg').count(),0,label+': no extra icon beside material name');
await materialName.click();
await page.locator('[data-hnl-master-catalog-tab="material"]').waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-norm-editor]').count(),0,label+': VIEWER cannot edit a norm');
const back=page.locator('[data-hnl-back-to-warehouse-catalog="true"]');
await back.waitFor({state:'visible'});
await back.click();
await sheet.waitFor({state:'visible'});
assert.equal(await sheet.locator('input[type="search"]').inputValue(),preservedSearch,
  label+': back must preserve catalog search and filters');
assert.equal(await sheet.getByRole('button',{name:'Vật tư',exact:true}).count(),1,
  label+': returned to Material catalog');

// Close the sheet before changing a fixture-only role control behind its
// backdrop, then reopen with the normal Warehouse button.
await sheet.getByRole('button',{name:'Đóng Danh mục kho'}).click();
await sheet.waitFor({state:'hidden'});
// ADMIN with exactly one matching name+unit lands in the existing edit form.
await page.locator('[data-hnl-fixture-admin]').click();
await catalogOpener.click();
await sheet.locator('input[type="search"]').fill(preservedSearch);
await sheet.locator('[data-hnl-catalog-open-master^="material:"]').first().click();
await page.locator('[data-hnl-norm-editor]').waitFor({state:'visible'});
assert((await page.locator('[data-hnl-norm-editor]').innerText()).includes('Cập nhật định mức vật tư'),
  label+': ADMIN should open existing edit form for the correct material');
await back.click();
await sheet.waitFor({state:'visible'});
assert.equal(await sheet.locator('input[type="search"]').inputValue(),preservedSearch,
  label+': admin back should preserve catalog search');

// Two norms may share a warehouse name/unit but belong to different categories.
// Never auto-select and overwrite the wrong underlying norm ID.
await sheet.getByRole('button',{name:'Đóng Danh mục kho'}).click();
await sheet.waitFor({state:'hidden'});
await page.locator('[data-hnl-fixture-duplicate]').click();
await catalogOpener.click();
await sheet.locator('[data-hnl-catalog-open-master^="material:"]').first().click();
await page.locator('[data-hnl-catalog-target-ambiguous]').waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-norm-editor]').count(),0,label+': ambiguous norm must not auto-edit');
const normEditButton=page.getByRole('button',{name:'Sửa định mức '+ 'Tấm thạch cao Golden P0'}).first();
const editBox=await normEditButton.boundingBox();
assert(editBox && editBox.height>=40 && editBox.width>=40,label+': norm editor touch target');
await back.click();
await sheet.waitFor({state:'visible'});

// The same name click on equipment targets the equipment master, not material norms.
await sheet.getByRole('button',{name:'Thiết bị',exact:true}).click();
const equipmentName=sheet.locator('[data-hnl-catalog-open-master^="equipment:"]').first();
assert.equal(await equipmentName.locator('svg').count(),0,label+': no extra icon beside equipment name');
await equipmentName.click();
const equipmentTab=page.locator('[data-hnl-master-catalog-tab="equipment"]');
await equipmentTab.waitFor({state:'visible'});
assert.equal(await equipmentTab.getAttribute('aria-selected'),'true',label+': equipment must open equipment master');
// This isolated fixture deliberately has no projectId and cannot read its
// Firestore equipment catalog. Check navigation in the browser, but validate
// the editor's icons in source; the actual editor requires Cloud ready state.
const panel=page.locator('[data-hnl-equipment-master="true"]');
await panel.waitFor({state:'visible'});
// Wait for the React effect to resolve the absent project into its fail-closed error state.
// A visible panel may still contain its initial loading placeholder for a few frames.
await panel.getByText('Không tải được thông tin thiết bị', {exact:false}).waitFor({state:'visible',timeout:10000});
assert((await panel.innerText()).includes('Không tải được thông tin thiết bị'),
  label+': missing project must not bypass the equipment load/permission guard');
await back.click();
await sheet.waitFor({state:'visible'});
assert.equal(await sheet.getByRole('button',{name:'Thiết bị',exact:true}).count(),1,
  label+': back returns to equipment catalog instead of default material tab');
const shot=`runtime-evidence/catalog-click-${label}.png`;await page.screenshot({path:shot});checks.push({viewport:label,result:'PASS',screenshot:shot});await ctx.close();
}
// Cross-module source-voucher click-through: real CrewTab + WarehouseTab components,
// including mobile unmount/remount. No Cloud writes; fixture write handlers throw.
for(const size of [{width:1280,height:800},{width:393,height:852}]){
 const label='crew-return-'+size.width+'x'+size.height;
 const ctx=await browser.newContext({viewport:size,locale:'vi-VN',isMobile:size.width<500,hasTouch:size.width<500});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(label+': '+e.message));
 await page.goto(url.replace('/index.html','/crew-return.html'),{waitUntil:'domcontentloaded'});
 const warehouseSearch=page.getByPlaceholder('Tìm vật tư, vị trí, người giao, mã phiếu, ngày (17/10/2026)...');
 // Warm and retain the Warehouse tab on PC; only mobile unmounts inactive tabs.
 await page.locator('[data-hnl-fixture-open-warehouse="true"]').click();
 await warehouseSearch.waitFor({state:'visible'});
 if(size.width>=500) await warehouseSearch.fill('Tấm');
 await page.locator('[data-hnl-fixture-open-crew="true"]').click();
 const directory=page.locator('#crew-subtab-navigation button').last();
 await directory.waitFor({state:'visible',timeout:15000});await directory.click();
 const team=page.locator('[title="Bấm để xem chi tiết thống kê căn & defect"]').first();
 await team.waitFor({state:'visible',timeout:15000});await team.click();
 const modal=page.locator('[data-hnl-crew-team-modal-body="true"]');await modal.waitFor({state:'visible'});
 await page.getByRole('button',{name:/Vật tư đối chiếu/}).click();
 const materialDetails=page.locator('[data-hnl-team-material-voucher-details]').first();
 await materialDetails.waitFor({state:'visible'});
 await materialDetails.locator('summary').click();
 const materialVoucher=page.locator('[data-hnl-team-material-voucher="FLOW-OUT-MAT-001"]');
 await materialVoucher.waitFor({state:'visible'});await materialVoucher.click();
 await page.locator('[data-hnl-fixture-active-tab="warehouse"]').waitFor({state:'visible'});
 const crewBack=page.locator('[data-hnl-fixture-header-back] [data-hnl-context-back-button="true"]');
 await crewBack.waitFor({state:'visible',timeout:15000});
 assert.equal(await page.locator('[data-hnl-context-back-button="true"]').count(),1,label+': Crew voucher has duplicate Back buttons');
 assert.equal(await page.locator('[data-hnl-voucher-return-origin="crew-statistics"]').count(),0,label+': duplicate Back inside voucher card');
 await crewBack.click();
 await page.locator('[data-hnl-fixture-active-tab="crew"]').waitFor({state:'visible'});
 await modal.waitFor({state:'visible',timeout:15000});
 assert.equal(await page.getByRole('button',{name:/Vật tư đối chiếu/}).getAttribute('aria-pressed'),'true',label+': material tab did not restore');
 assert.equal(await page.locator('[data-hnl-team-material-voucher-details]').first().evaluate(el=>el.open),true,label+': original material voucher list collapsed');
 // Revisiting Warehouse normally must never retain the temporary voucher-ID search.
 await page.locator('[data-hnl-fixture-open-warehouse="true"]').click();
 await warehouseSearch.waitFor({state:'visible'});
 assert.equal(await warehouseSearch.inputValue(),size.width>=500?'Tấm':'',label+': material voucher ID leaked into Warehouse Search');
 await warehouseSearch.fill('');
 await page.locator('[data-hnl-fixture-open-crew="true"]').click();

 await page.locator('[data-hnl-crew-equipment-tab="true"]').click();
 const equipmentDetails=page.locator('[data-hnl-team-equipment-voucher-details]').first();
 await equipmentDetails.waitFor({state:'visible'});
 await equipmentDetails.locator('summary').click();
 const equipmentVoucher=page.locator('[data-hnl-team-equipment-voucher="FLOW-OUT-EQUIP-002"]');
 await equipmentVoucher.waitFor({state:'visible'});await equipmentVoucher.click();
 await page.locator('[data-hnl-fixture-active-tab="warehouse"]').waitFor({state:'visible'});
 const equipmentBack=page.locator('[data-hnl-fixture-header-back] [data-hnl-context-back-button="true"]');
 await equipmentBack.waitFor({state:'visible',timeout:15000});
 assert.equal(await page.locator('[data-hnl-context-back-button="true"]').count(),1,label+': Equipment voucher has duplicate Back buttons');
 assert.equal(await page.locator('[data-hnl-voucher-return-origin="crew-statistics"]').count(),0,label+': duplicate equipment Back inside voucher');
 await equipmentBack.click();
 await page.locator('[data-hnl-fixture-active-tab="crew"]').waitFor({state:'visible'});
 await modal.waitFor({state:'visible',timeout:15000});
 assert.equal(await page.locator('[data-hnl-crew-equipment-tab="true"]').getAttribute('aria-pressed'),'true',label+': equipment tab did not restore');
 assert.equal(await page.locator('[data-hnl-team-equipment-voucher-details]').first().evaluate(el=>el.open),true,label+': original equipment voucher list collapsed');
 await page.locator('[data-hnl-fixture-open-warehouse="true"]').click();
 await warehouseSearch.waitFor({state:'visible'});
 assert.equal(await warehouseSearch.inputValue(),'',label+': equipment voucher ID leaked into Warehouse Search after header Back');
 checks.push({viewport:label,flow:'crew-material-equipment-voucher-return-with-no-stale-search',result:'PASS'});
 await page.screenshot({path:`runtime-evidence/catalog-click-${label}.png`}).catch(()=>{});
 await ctx.close();
}

// Source-level guard for matching icons; browser equipment editor cannot load
// Firestore documents in this intentionally projectless UI fixture.
const equipmentSource=fs.readFileSync('src/components/EquipmentCatalogPanel.tsx','utf8');
const normSource=fs.readFileSync('src/components/MaterialNormModal.tsx','utf8');
assert(equipmentSource.includes('Edit3 className="h-3.5 w-3.5"') &&
  normSource.includes('Edit3 className="h-3.5 w-3.5"') &&
  equipmentSource.includes('Trash2 className="h-3.5 w-3.5"') &&
  normSource.includes('Trash2 className="h-3.5 w-3.5"') &&
  equipmentSource.includes('min-h-10 min-w-10') &&
  normSource.includes('min-h-10 min-w-10'),
  'Equipment and norm edit/trash icons must match in shape, glyph size and touch area');
assert.equal(errors.length,0,errors.join(' | '));console.log('WAREHOUSE CATALOG CLICK GOLDEN PASS',JSON.stringify(checks));
}catch(e){console.error(log.slice(-1200));throw e;}finally{fs.writeFileSync('runtime-evidence/catalog-click-report.json',JSON.stringify({checks,errors,date:new Date().toISOString()},null,2));await browser?.close();server.kill('SIGTERM');}
