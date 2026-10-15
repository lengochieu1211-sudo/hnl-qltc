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
const rect=await button.boundingBox();assert(rect&&rect.height>=39&&rect.width>=40,label+': touch area');await button.click();
const history=sheet.locator('[data-hnl-catalog-history="readonly"]');await history.waitFor({state:'visible'});
await history.getByText('Mã phiếu: P0-IN-20261013-001').waitFor({state:'visible'});
await history.getByText('13/10/2026',{exact:false}).first().waitFor({state:'visible'});
assert((await history.innerText()).includes('12 Tấm'),label+': IN count');
assert(!(await history.innerText()).includes('P0-OUT-20261013-003'),label+': IN/OUT mixed');
const r=await history.boundingBox();assert(r&&r.y<size.height-90,label+': offscreen');
assert.equal(await sheet.locator('[data-hnl-catalog-in-history]').count(),0,label+': catalog still obscures history');
await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.locator('[data-hnl-catalog-out-history^="material:"]').first().click();
await history.getByText('Mã phiếu: P0-OUT-20261013-003').waitFor({state:'visible'});
assert((await history.innerText()).includes('5 Tấm'),label+': OUT count');
await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.getByRole('button',{name:'Thiết bị',exact:true}).click();
await sheet.locator('[data-hnl-catalog-in-history^="equipment:"]').first().click();
await history.getByText('Mã phiếu: P0-EQUIP-IN-004').waitFor({state:'visible'});
assert((await history.innerText()).includes('3 Cái'),label+': equipment unit');

// Test the new name-only navigation, without any added icon next to item names.
// In VIEWER role the matching catalog is opened read-only; no edit form is mounted.
await sheet.getByRole('button',{name:/Danh mục kho/}).last().click();
await sheet.getByRole('button',{name:'Vật tư',exact:true}).click();
const materialName=sheet.locator('[data-hnl-catalog-open-master^="material:"]').first();
assert.equal(await materialName.locator('svg').count(),0,label+': no extra icon beside material name');
await materialName.click();
await page.locator('[data-hnl-master-catalog-tab="material"]').waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-norm-editor]').count(),0,label+': VIEWER cannot edit a norm');
await page.getByRole('button',{name:'Đóng quản lý vật tư thiết bị'}).click();

// ADMIN with exactly one matching name+unit lands in the existing edit form.
await page.locator('[data-hnl-fixture-admin]').click();
await catalogOpener.click();
await sheet.locator('[data-hnl-catalog-open-master^="material:"]').first().click();
await page.locator('[data-hnl-norm-editor]').waitFor({state:'visible'});
assert((await page.locator('[data-hnl-norm-editor]').innerText()).includes('Cập nhật định mức vật tư'),
  label+': ADMIN should open existing edit form for the correct material');
await page.getByRole('button',{name:'Đóng quản lý vật tư thiết bị'}).click();

// Two norms may share a warehouse name/unit but belong to different categories.
// Never auto-select and overwrite the wrong underlying norm ID.
await page.locator('[data-hnl-fixture-duplicate]').click();
await catalogOpener.click();
await sheet.locator('[data-hnl-catalog-open-master^="material:"]').first().click();
await page.locator('[data-hnl-catalog-target-ambiguous]').waitFor({state:'visible'});
assert.equal(await page.locator('[data-hnl-norm-editor]').count(),0,label+': ambiguous norm must not auto-edit');
const normEditButton=page.getByRole('button',{name:'Sửa định mức '+ 'Tấm thạch cao Golden P0'}).first();
const editBox=await normEditButton.boundingBox();
assert(editBox && editBox.height>=40 && editBox.width>=40,label+': norm editor touch target');
await page.getByRole('button',{name:'Đóng quản lý vật tư thiết bị'}).click();

// The same name click on equipment targets the equipment master, not material norms.
await catalogOpener.click();
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
assert((await panel.innerText()).includes('Không tải được thông tin thiết bị'),
  label+': missing project must not bypass the equipment load/permission guard');
await page.getByRole('button',{name:'Đóng quản lý vật tư thiết bị'}).click();
const shot=`runtime-evidence/catalog-click-${label}.png`;await page.screenshot({path:shot});checks.push({viewport:label,result:'PASS',screenshot:shot});await ctx.close();
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
