import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],
 {stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',
 VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'}});
let serverLog='';for(const stream of [vite.stdout,vite.stderr])stream.on('data',s=>serverLog+=String(s));
async function assertEventuallyEnabled(locator) {
  await locator.waitFor({state:'visible',timeout:30000});
  for(let i=0;i<100;i++){
    if(await locator.isEnabled())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Prepared download action stayed disabled');
}
fs.mkdirSync('runtime-evidence',{recursive:true});const results=[];let browser;
try {
 const url='http://127.0.0.1:'+port+'/scripts/fixtures/warehouse-catalog/index.html';
 let ready=false;
 for(let i=0;i<140;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));}
 assert(ready,'Fixture Vite not ready: '+serverLog.slice(-500));
 browser=await chromium.launch({headless:true});
 for(const viewport of [{width:1280,height:800},{width:393,height:852}]){
  const tag=viewport.width+'x'+viewport.height;
  const context=await browser.newContext({viewport,acceptDownloads:true,isMobile:viewport.width<500,hasTouch:viewport.width<500});
  await context.addInitScript(()=>{
    window.__voucherPrintText=[];
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
      if(this.canvas.width===1240 && this.canvas.height===1754)
        window.__voucherPrintText.push({text:String(text),x,y,align:this.textAlign,font:this.font});
      return original.call(this,text,x,y,...rest);
    };
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('[data-hnl-voucher-share-id]').count(),0,
    'Individual warehouse journal entries must not have a separate PNG/PDF export button');
  const open=page.locator('[data-hnl-warehouse-export-open="all"]');
  assert.equal(await open.count(),1,'Keep exactly one centralized export action at journal heading');
  await open.waitFor({state:'visible',timeout:15000});await open.click();
  const sheet=page.locator('[data-hnl-settings-sheet="warehouse-voucher-share"]');
  await sheet.waitFor({state:'visible'});
  assert(await sheet.getByRole('heading',{name:'Chia sẻ phiếu nhập/xuất kho'}).isVisible(),'Voucher share modal heading must match renamed action');
  await sheet.getByRole('button',{name:'Khoảng ngày'}).click();
  const dates=sheet.locator('input[type="date"]');
  await dates.nth(0).fill('2026-10-13');
  await dates.nth(1).fill('2026-10-13');
  const dateBoxes=await Promise.all([dates.nth(0).boundingBox(),dates.nth(1).boundingBox()]);
  assert(dateBoxes.every(box=>box&&box.width>=140&&box.width<=170),tag+': date fields must be compact, never stretched across wide sheets');
  assert(dateBoxes.every(box=>box.x>=0&&box.x+box.width<=viewport.width+1),tag+': date fields must fit viewport');
  await sheet.getByRole('button',{name:'Một phiếu'}).click();
  await sheet.locator('label').filter({hasText:'P0-IN-20261013-001'}).locator('input[type="radio"]').check();
  assert.match(await sheet.innerText(),/Đã chọn 1\/\d+ phiếu/,'Single voucher selection missing');
  // Only Image, Excel and PDF remain; preserve the existing file download flows.
  assert.equal(await sheet.locator('[data-hnl-voucher-format]').count(),3,
    'Warehouse share should expose exactly three formats');
  assert.equal(await sheet.locator('[data-hnl-voucher-format="text"]').count(),0,
    'Remove Content format without touching file exports');
  assert.equal(await sheet.locator('[data-hnl-voucher-format="png"]').count(),1);
  assert.equal(await sheet.locator('[data-hnl-voucher-format="xlsx"]').count(),1);
  assert.equal(await sheet.locator('[data-hnl-voucher-format="pdf"]').count(),1);
  // Check actual rendered Tailwind colors on both PC and phone, not just CSS classes.
  const palette={
    png:'bg-sky-600',
    xlsx:'bg-green-600',
    pdf:'bg-red-600',
  };
  const formatBoxes=[];const actualColors=[];
  for(const [format,colorClass] of Object.entries(palette)){
    const control=sheet.locator('[data-hnl-voucher-format="'+format+'"]');
    const {actual,expected}=await control.evaluate((el,expectedClass)=>{
      const swatch=document.createElement('span');
      swatch.className=expectedClass;
      document.body.appendChild(swatch);
      const expected=getComputedStyle(swatch).backgroundColor;
      const actual=getComputedStyle(el).backgroundColor;
      swatch.remove();
      return {actual,expected};
    },colorClass);
    // Tailwind v4 commonly returns OKLCH instead of RGB: compare computed styles.
    assert.notEqual(expected,'rgba(0, 0, 0, 0)',tag+': expected Tailwind color must be compiled');
    assert.equal(actual,expected,tag+': '+format+' should match its semantic color utility');
    actualColors.push(actual);
    const bounds=await control.boundingBox();
    assert(bounds && bounds.width>=96 && bounds.width<=116 && bounds.height>=44,
      tag+': '+format+' format button must remain touch-friendly and capped near 104px, not stretch across desktop');
    assert(bounds.x>=0 && bounds.x+bounds.width<=viewport.width+1,
      tag+': '+format+' format button must not overflow the viewport');
    formatBoxes.push(bounds);
  }
  assert.equal(new Set(actualColors).size,3,tag+': Image/Excel/PDF need three distinct colors');
  assert(formatBoxes.every(box=>Math.abs(box.width-formatBoxes[0].width)<2 && Math.abs(box.height-formatBoxes[0].height)<2),
    tag+': Image, Excel and PDF buttons must share dimensions');

  await sheet.locator('[data-hnl-voucher-format="xlsx"]').click();
  const excelAction=sheet.locator('[data-hnl-voucher-action="xlsx-download"]');
  await assertEventuallyEnabled(excelAction);
  const excelBox=await excelAction.boundingBox();
  assert(excelBox&&excelBox.y>=0&&excelBox.y+excelBox.height<=viewport.height+2,tag+': Excel action must fit viewport');
  assert(excelBox.width>=72&&excelBox.width<=185&&excelBox.height>=44,
    tag+': share/download actions must stay readable and compact (actual '+excelBox.width.toFixed(1)+'px, height '+excelBox.height.toFixed(1)+'px)');
  const excelPromise=page.waitForEvent('download',{timeout:30000});
  await excelAction.click();
  const excelDl=await excelPromise;
  const excelBytes=fs.readFileSync(await excelDl.path());
  assert(excelBytes.length>3000&&excelBytes.subarray(0,2).toString()==='PK',tag+': valid XLSX binary');
  const workbook=XLSX.read(excelBytes,{type:'buffer',cellFormula:true,cellStyles:true});
  assert.equal(workbook.SheetNames.length,1,tag+': 1 selected invoice should have 1 sheet');
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const cells=Object.values(firstSheet).filter(c=>c&&typeof c==='object'&&'v' in c).map(c=>c.v);
  for(const value of ['PHIẾU NHẬP KHO','Công trình Trung tâm Kiểm thử QLTC','Công ty Thi công Kiểm thử','Mã tham chiếu','P0-IN-20261013-001']){
    assert(cells.includes(value),tag+': missing Excel voucher value '+value);
  }
  assert(cells.includes(12),tag+': Excel quantity must be numeric');
  assert(firstSheet['!merges']?.length>2,tag+': expected print layout merges');
  assert.equal(firstSheet['!cols']?.[4]?.hidden,true,tag+': original ID must be retained in the hidden fifth Excel column');
  results.push({viewport:tag,format:'xlsx',mode:'single',bytes:excelBytes.length,file:excelDl.suggestedFilename()});
  // The existing PNG/PDF paths must remain operational.
  
  for(const format of ['png','pdf']){
    await sheet.locator('[data-hnl-voucher-format="'+format+'"]').click();
    const action=sheet.locator('[data-hnl-voucher-action="'+format+'-download"]');
    await action.waitFor({state:'visible'});
    await assertEventuallyEnabled(action);
    const box=await action.boundingBox();
    assert(box&&box.y>=0&&box.y+box.height<=viewport.height+2,
      tag+': '+format+' action buttons must be visible in viewport without user scroll');
    const promise=page.waitForEvent('download',{timeout:30000});
    await action.click();
    const download=await promise;
    const filepath=await download.path();
    assert(filepath,'download not saved');
    const bytes=fs.readFileSync(filepath);
    assert(bytes.length>3000,format+' export was empty/tiny: '+bytes.length);
    if(format==='png'){
      assert.equal(bytes.subarray(1,4).toString(),'PNG','PNG header');
      fs.writeFileSync('runtime-evidence/voucher-paper-'+tag+'.png',bytes);
      const draws=await page.evaluate(()=>window.__voucherPrintText||[]);
      assert(!draws.some(x=>x.text==='P0-IN-20261013-001'),'Printed PNG must omit internal transaction IDs');
      assert(draws.some(x=>x.text==='Người thực hiện:'),'A generic handler cannot be mislabeled sender/receiver');
      assert(draws.some(x=>x.text==='Công trình:') && draws.some(x=>x.text==='Địa điểm:'),
        'Printed voucher must display project name/location labels instead of empty unit/department');
      assert(draws.some(x=>x.text==='Công trình Trung tâm Kiểm thử QLTC')
        && draws.some(x=>x.text==='123 Đường Thử Nghiệm, Quận 1, TP.HCM'),
        'Printed PNG must use the active project metadata, not a warehouse address');
      assert(draws.some(x=>x.text==='Đơn vị thi công:') && draws.some(x=>x.text==='Công ty Thi công Kiểm thử'),
        'Optional contractor must come from the current project, not a guessed warehouse recipient');
      assert(!draws.some(x=>x.text.includes('Mã tham chiếu')),'No reference column or footer on printed PNG');
      assert(!draws.some(x=>x.text.startsWith('Đơn vị:')||x.text.startsWith('Bộ phận:')),
        'Old blank unit/department placeholders must not appear');
      const handlerLabel=draws.find(x=>x.text==='Người thực hiện:');
      const handlerName=draws.find(x=>x.text==='Người nhập P0');
      assert(handlerLabel&&handlerName&&handlerName.x-handlerLabel.x>170,
        'Printed handler name must clear the longer label rather than overlap it');
      assert(!draws.some(x=>x.text==='Người giao:'||x.text==='Người nhận:'),
        'Do not invent whether handler is sender or recipient');
      assert(!draws.some(x=>/HNL QLTC/.test(x.text)),'No application brand in printed voucher');
      const summary=draws.find(x=>x.text.startsWith('Số dòng trên trang:'));
      const signature=draws.find(x=>x.text==='Người lập phiếu');
      assert(summary && signature && signature.y>summary.y+50 && signature.y-summary.y<250,
        'Signature must follow the actual table instead of being pinned near A4 bottom');
    }else {
      assert.equal(bytes.subarray(0,4).toString(),'%PDF','PDF header');
      fs.writeFileSync('runtime-evidence/voucher-selectable-'+tag+'.pdf',bytes);
      assert(!bytes.toString('latin1').includes('/Subtype /Image'),
        'PDF must use native selectable text, not one PNG image for each page');
      const task=getDocument({data:new Uint8Array(bytes),disableFontFace:true,useSystemFonts:false});
      const pdfDoc=await task.promise;
      const firstPage=await pdfDoc.getPage(1);
      const content=await firstPage.getTextContent();
      const pdfText=content.items.map(item=>('str' in item ? item.str : '')).join(' ');
      for(const required of ['PHIẾU NHẬP KHO','Công trình Trung tâm Kiểm thử QLTC',
        'Tên vật tư / thiết bị','Số lượng','Người thực hiện']) {
        assert(pdfText.includes(required),tag+': PDF native text not extractable: '+required+'; got '+pdfText.slice(0,400));
      }
      assert(!pdfText.includes('P0-IN-20261013-001')&&!pdfText.includes('Mã tham chiếu'),tag+': PDF must omit technical IDs');
      await task.destroy();
    }
    assert(!download.suggestedFilename().includes('HNL'),'Printed voucher must be unbranded');
    results.push({viewport:tag,format,mode:'single',bytes:bytes.length,file:download.suggestedFilename()});
  }
  // Two original receipt IDs on the same day/by the same handler must share
  // one A4 print table and one PNG/PDF file rather than per-material exports.
  await sheet.getByRole('button',{name:'Tất cả'}).click();
  await sheet.getByRole('button',{name:'Nhập kho'}).click();
  await sheet.getByRole('button',{name:'Vật tư',exact:true}).click();
  assert.match(await sheet.innerText(),/2 dòng vật tư\/thiết bị → 1 trang A4/,'Expected two material lines on one A4');
  for(const format of ['png','pdf']){
    await sheet.locator('[data-hnl-voucher-format="'+format+'"]').click();
    const action=sheet.locator('[data-hnl-voucher-action="'+format+'-download"]');
    await assertEventuallyEnabled(action);
    const promise=page.waitForEvent('download',{timeout:30000});
    await action.click();
    const download=await promise;
    const bytes=fs.readFileSync(await download.path());
    assert(bytes.length>3000,format+' grouped voucher empty');
    if(format==='pdf'){
      const pageObjects=bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[];
      assert.equal(pageObjects.length,1,'Two receipt lines should produce one PDF A4 page');
    }
    results.push({viewport:tag,format,mode:'multirow',bytes:bytes.length,file:download.suggestedFilename()});
  }
  await page.screenshot({path:'runtime-evidence/voucher-export-'+tag+'.png'});
  assert.deepEqual(errors,[],'React errors: '+errors.join(', '));
  await context.close();
 }
 assert.equal(results.length,10);
 fs.writeFileSync('runtime-evidence/voucher-export-report.json',JSON.stringify({status:'PASS',results},null,2));
 console.log('WAREHOUSE VOUCHER IMAGE/EXCEL/SEARCHABLE-PDF REAL DOWNLOAD PASS',JSON.stringify(results));
} finally {await browser?.close();vite.kill('SIGTERM');}
