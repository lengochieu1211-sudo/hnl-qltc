import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const url='http://127.0.0.1:'+port+'/scripts/fixtures/team-subitem-detail/index.html';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'}});
let logs='',browser;
for(const stream of [server.stdout,server.stderr])stream.on('data',d=>logs+=String(d));
const checks=[],errors=[];
const folder='runtime-evidence/team-subitem-detail';fs.mkdirSync(folder,{recursive:true});
const categoryName='Trần thạch cao khung nổi 610x610 tấm tiêu chuẩn (NC+VT) – tên hạng mục dài cần hiển thị đầy đủ';
const stageName='Thi công khung xương trần thạch cao khung nổi và gia cố bổ sung theo bản vẽ shopdrawing';
async function readDownload(page,button,label,expected){
 const pending=page.waitForEvent('download',{timeout:45000});
 await button.click();
 const download=await pending;
 const bytes=fs.readFileSync(await download.path());
 assert(bytes.length>1000,label+': Excel empty');
 const wb=XLSX.read(bytes,{type:'buffer',cellStyles:true,cellFormula:true});
 assert.equal(wb.SheetNames.length,9,label+': retain eight existing sheets plus 09');
 assert(wb.SheetNames.slice(0,8).every((s,i)=>s.startsWith('0'+(i+1)+'-')),label+': existing sheet ordering');
 const ws=wb.Sheets['09-Chi tiết hạng mục con'];
 assert(ws,label+': missing stage worksheet');
 const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
 assert.equal(rows.length,expected,label+': exact rows');
 const byId=Object.fromEntries(rows.map(r=>[r.__subItemId,r]));
 assert.equal(byId.S1['Hạng Mục Chính'],categoryName);
 assert.equal(byId.S1['Hạng Mục Con'],stageName);
 assert.equal(byId.S1['Khối Lượng Con'],120.25);
 assert.equal(byId.S2['Khối Lượng Con'],115);
 assert.equal(byId.S3['Khối Lượng Con'],0);
 assert.equal(byId.S3['ĐVT'],'Cái');
 assert.equal(byId.S4['Khối Lượng Con'],'');
 if(expected===13){assert.equal(byId.OTHER['__teamId'],'TEAM-B');assert.equal(byId.OTHER['Khối Lượng Con'],77);assert.equal(byId.OTHER['ĐVT'],'md');}
 else assert(!byId.OTHER,label+': other team leaked');
 assert(ws['!cols'].slice(1,6).every(c=>c.hidden));
 fs.writeFileSync(folder+'/'+label+'.xlsx',bytes);
}
try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}assert(ready,'Vite failed: '+logs.slice(-1800));
 browser=await chromium.launch({headless:true});
 for(const [width,height,dark] of [[1280,800,false],[1024,768,true],[393,852,false],[360,640,true]]){
  const label=width+'-'+(dark?'dark':'light');
  const ctx=await browser.newContext({viewport:{width,height},locale:'vi-VN',isMobile:width<500,hasTouch:width<500,acceptDownloads:true});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+': '+e.message));
  await page.goto(url+(dark?'?dark=1':''),{waitUntil:'domcontentloaded'});
  await page.locator('#crew-subtab-navigation button').last().click({timeout:20000});
  const team=page.locator('[title="Bấm để xem chi tiết thống kê căn & defect"]').filter({hasText:'Đội Golden A'}).first();
  if(await team.count())await team.click();else await page.locator('[data-hnl-team-statistics-action] button').first().click({timeout:20000});
  const modal=page.locator('[data-hnl-crew-team-modal-body="true"]');
  const main=modal.locator('[data-hnl-team-category-row="true"]');
  await main.waitFor({state:'visible',timeout:20000});
  const mainName=main.getByText(categoryName,{exact:true});
  const stage=modal.locator('[data-hnl-team-subitem-row="true"]').first();
  const stageTitle=stage.getByText('• '+stageName,{exact:true});
  assert.equal(await modal.locator('[data-hnl-team-subitem-row="true"]').count(),12,label+': all own stages');
  assert.equal(await modal.locator('[data-hnl-team-subitem-quantity="true"]').count(),12);
  assert(!(await modal.innerText()).includes('Công đoạn đội khác'),label+': other team stage leaked');
  for(const name of [mainName,stageTitle]){
    const metrics=await name.evaluate(el=>{const s=getComputedStyle(el);return {textOverflow:s.textOverflow,overflowWrap:s.overflowWrap,scroll:el.scrollWidth,width:el.clientWidth};});
    assert.equal(metrics.overflowWrap,'anywhere',label+': long name wrap');
    assert.notEqual(metrics.textOverflow,'ellipsis');
    assert(metrics.scroll<=metrics.width+2,label+': truncated name');
  }
  for(const el of await modal.locator('[data-hnl-team-category-row], [data-hnl-team-subitem-row], [data-hnl-team-subitem-list]').all()){
    const m=await el.evaluate(e=>({w:e.clientWidth,sw:e.scrollWidth,h:e.clientHeight,sh:e.scrollHeight,oy:getComputedStyle(e).overflowY}));
    assert(m.sw<=m.w+2,label+': horizontal overflow '+JSON.stringify(m));
    assert(m.sh<=m.h+2,label+': clipped list/row '+JSON.stringify(m));
    assert.notEqual(m.oy,'auto',label+': nested scrolling');
  }
  await main.scrollIntoViewIfNeeded();await page.screenshot({path:folder+'/'+label+'.png'});
  await readDownload(page,page.getByTitle('Tải báo cáo Excel thống kê chi tiết cho đội thi công này'),label+'-single',12);
  await page.getByRole('button',{name:/^Đóng$/}).last().click();
  await page.getByRole('button',{name:/Quản lý dữ liệu|^Dữ liệu$/}).first().click();
  await readDownload(page,page.getByText('Báo cáo chi tiết tất cả đội',{exact:true}),label+'-all',13);
  checks.push({viewport:label,names:'PASS',quantities:'PASS',singleExcel:'PASS',allExcel:'PASS'});await ctx.close();
 }
 assert.deepEqual(errors,[]);
 console.log('TEAM SUBITEM BROWSER GOLDEN PASS',JSON.stringify(checks));
}finally{
 fs.writeFileSync(folder+'/result.json',JSON.stringify({checks,errors},null,2));
 await browser?.close();server.kill();
}
