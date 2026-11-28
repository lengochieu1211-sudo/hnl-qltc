import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import * as XLSX from 'xlsx';
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const url='http://127.0.0.1:'+port+'/scripts/fixtures/prod-warehouse-labels/index.html';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-rules'}});
const out='runtime-evidence/prod-warehouse-labels';fs.mkdirSync(out,{recursive:true});
const results=[],errors=[];let browser,logs='';
for(const s of [server.stdout,server.stderr])s.on('data',d=>logs+=String(d));
try {
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,logs.slice(-3000));
  browser=await chromium.launch({headless:true});
  const admin=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true,locale:'vi-VN'});
  const viewer=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,locale:'vi-VN'});
  const pc=await admin.newPage(),mobile=await viewer.newPage();
  for(const p of [pc,mobile])p.on('pageerror',e=>errors.push(e.message));
  const id=String(Date.now());
  const open=async (p,role)=>{await p.goto(url+'?test='+id+'&role='+role);await p.waitForFunction(()=>document.querySelector('[data-fixture-ready]')?.textContent==='ready',null,{timeout:60000});};
  const grid=p=>p.locator('[data-hnl-pc-v3-inner="warehouse-voucher-card-grid"]');
  const expectName=async(p,name)=>{await grid(p).getByText(name,{exact:true}).first().waitFor({timeout:30000});assert.equal(await grid(p).getByText(name,{exact:true}).count(),2,name+' must appear on IN and OUT');};
  await open(pc,'admin');
  await open(mobile,'viewer');
  await expectName(pc,'Tấm cũ kiểm thử');await expectName(mobile,'Máy khoan cũ kiểm thử');
  const before=await pc.evaluate(()=>window.__warehouseLabelFixture.snapshotLedger());
  assert.equal(before.inventory.length,4);assert.equal(before.balances.length,2);
  assert.deepEqual(before.balances.map(x=>x.data.onHand).sort((a,b)=>a-b),[2,7]);
  assert.equal(await mobile.evaluate(()=>window.__warehouseLabelFixture.denyViewer()),true);
  await pc.evaluate(()=>window.__warehouseLabelFixture.rename(1));
  for(const p of [pc,mobile]){await expectName(p,'Tấm mới kiểm thử 1');await expectName(p,'Máy khoan mới kiểm thử 1');}
  assert.deepEqual(await pc.evaluate(()=>window.__warehouseLabelFixture.snapshotLedger()),before,'catalog rename cannot mutate vouchers/balances');
  await mobile.evaluate(()=>window.__warehouseLabelFixture.offline());
  await pc.evaluate(()=>window.__warehouseLabelFixture.rename(2));
  await expectName(pc,'Tấm mới kiểm thử 2');await expectName(pc,'Máy khoan mới kiểm thử 2');
  await expectName(mobile,'Tấm mới kiểm thử 1');await expectName(mobile,'Máy khoan mới kiểm thử 1');
  await mobile.evaluate(()=>window.__warehouseLabelFixture.online());
  await expectName(mobile,'Tấm mới kiểm thử 2');await expectName(mobile,'Máy khoan mới kiểm thử 2');
  const search=pc.getByPlaceholder(/Tìm vật tư, vị trí, người giao/);
  await search.fill('Tấm cũ kiểm thử');await expectName(pc,'Tấm mới kiểm thử 2');
  await search.fill('Máy khoan mới kiểm thử 2');await expectName(pc,'Máy khoan mới kiểm thử 2');
  await search.fill('');
  const downloadPromise=pc.waitForEvent('download');await pc.locator('[data-fixture-export]').click();const download=await downloadPromise;
  await download.saveAs(out+'/warehouse.xlsx');
  const wb=XLSX.readFile(out+'/warehouse.xlsx');
  for(const [sheet,ids] of [['Nhập Kho',['LABEL-MAT-IN','LABEL-EQ-IN']],['Xuất Kho',['LABEL-MAT-OUT','LABEL-EQ-OUT']]]){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet]);assert.equal(rows.length,2);
    for(const id of ids){
      const row=rows.find(x=>x['Mã Phiếu']===id),original=before.inventory.find(x=>x.id===id).data;
      assert(row);assert.equal(row['Tên Vật Tư / Thiết Bị'],original.materialName);
      assert.equal(row['__itemKind'],original.itemKind);
      assert.equal(row['__materialId']||'',original.materialId||'');
      assert.equal(row['Số Lượng'],original.quantity);assert.equal(row['Đơn Vị Tính'],original.unit);
      assert.equal(row['Tên hiện tại (chỉ xem)'],id.includes('-MAT-')?'Tấm mới kiểm thử 2':'Máy khoan mới kiểm thử 2');
    }
  }
  assert.deepEqual(await pc.evaluate(()=>window.__warehouseLabelFixture.snapshotLedger()),before);
  await pc.screenshot({path:out+'/desktop.png',fullPage:true});await mobile.screenshot({path:out+'/mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  results.push({pc:'PASS',mobileViewer:'PASS',realtimeTwoAccounts:'PASS',offlineReconnect:'PASS',immutableLedger:'PASS',renameTwice:'PASS',searchOldNew:'PASS',viewerDenied:'PASS',xlsxIdentity:'PASS'});
  console.log('PROD WAREHOUSE LABEL EMULATOR GOLDEN PASS',JSON.stringify(results));
}finally{fs.writeFileSync(out+'/result.json',JSON.stringify({results,errors},null,2));await browser?.close();server.kill();}
