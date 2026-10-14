import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import * as XLSX from 'xlsx';

const port=await new Promise((resolve,reject)=>{
  const socket=net.createServer();socket.once('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const n=socket.address().port;socket.close(()=>resolve(n));});
});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',
    VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'},
});
let output='';for(const stream of [vite.stdout,vite.stderr])stream.on('data',chunk=>output+=String(chunk));
let browser;const results=[];
fs.mkdirSync('runtime-evidence',{recursive:true});
async function ready(locator){
  for(let n=0;n<140;n++){if(await locator.isEnabled())return;await new Promise(r=>setTimeout(r,150));}
  throw new Error('Prepared export action remained disabled');
}
try{
  const url='http://127.0.0.1:'+port+'/scripts/fixtures/crew-report/index.html';
  let up=false;
  for(let n=0;n<140;n++){
    try{if((await fetch(url)).ok){up=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  assert(up,'Vite fixture failed: '+output.slice(-1000));
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1280,height:800},{width:393,height:852}]){
    const name=viewport.width+'x'+viewport.height;
    const context=await browser.newContext({viewport,acceptDownloads:true,isMobile:viewport.width<500,hasTouch:viewport.width<500});
    await context.addInitScript(()=>{
      window.__crewShareEvents=[];
      Object.defineProperty(navigator,'share',{configurable:true,value:async(payload)=>{
        window.__crewShareEvents.push({files:(payload.files||[]).map(f=>({name:f.name,size:f.size,type:f.type})),active:navigator.userActivation?.isActive});
      }});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    });
    const page=await context.newPage();const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    const dialog=page.getByRole('dialog',{name:'Chia sẻ báo cáo quân số',exact:true});
    await dialog.waitFor({state:'visible',timeout:20000});
    // Reproduce Android screenshot: user scrolls to the export buttons below long tables.
    await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const scrollBefore=await dialog.evaluate(el=>el.scrollTop);
    assert(scrollBefore>0,name+': fixture must exercise real modal scrolling');
    await dialog.getByRole('button',{name:'Nội dung',exact:true}).click();
    assert(await page.getByRole('button',{name:'Sao chép nội dung'}).isVisible());
    assert(await page.getByRole('button',{name:'Chia sẻ nội dung'}).isVisible());
    const textActions=page.locator('[data-hnl-crew-action-menu="text"]');
    assert(await textActions.evaluate(el=>el.parentElement?.parentElement===document.body),
      name+': overlay must be portaled directly under document.body, outside scroll containers');
    assert(Math.abs((await dialog.evaluate(el=>el.scrollTop))-scrollBefore)<=2,
      name+': clicking Content must not jump scrolled report to top');
    const textBounds=await textActions.boundingBox();
    assert(textBounds&&textBounds.y>=0&&textBounds.y+textBounds.height<=viewport.height+2,
      name+': text share popup must be within viewport');
    await textActions.getByRole('button',{name:'Đóng tùy chọn'}).click();

    await dialog.getByRole('button',{name:'Excel',exact:true}).click();
    const excelActions=page.locator('[data-hnl-crew-action-menu="excel"]');
    assert(Math.abs((await dialog.evaluate(el=>el.scrollTop))-scrollBefore)<=2,
      name+': switching to Excel must retain report scroll position');
    const excelBounds=await excelActions.boundingBox();
    await page.screenshot({path:'runtime-evidence/crew-share-overlay-'+name+'.png'});
    assert(excelBounds&&excelBounds.y>=0&&excelBounds.y+excelBounds.height<=viewport.height+2,
      name+': Excel share popup must be within viewport');
    const dlExcel=page.getByRole('button',{name:'Tải Excel'});
    await ready(dlExcel);
    const excelPromise=page.waitForEvent('download',{timeout:30000});
    await dlExcel.click();
    const excelDownload=await excelPromise;
    const bytes=fs.readFileSync(await excelDownload.path());
    assert(bytes.length>5000,'Exported workbook is empty');
    assert.equal(bytes.subarray(0,2).toString(),'PK');
    const wb=XLSX.read(bytes,{type:'buffer',cellFormula:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    assert.match(String(ws['E9']?.f),/^MAX\(/,'Daily headcount must have MAX formula');
    assert.match(String(ws['J9']?.f),/^SUM\(/,'Total daily must have SUM formula');
    results.push({viewport:name,format:'xlsx',bytes:bytes.length,file:excelDownload.suggestedFilename()});

    await page.getByRole('button',{name:'Chia sẻ Excel'}).click();
    assert((await page.evaluate(()=>window.__crewShareEvents)).some(evt=>evt.files.some(f=>f.type.includes('spreadsheetml'))),
      'Browser Web Share API must receive actual XLSX attachment');

    await excelActions.getByRole('button',{name:'Đóng tùy chọn'}).click();
    await dialog.getByRole('button',{name:'Ảnh',exact:true}).click();
    const imageActions=page.locator('[data-hnl-crew-action-menu="image"]');
    assert(Math.abs((await dialog.evaluate(el=>el.scrollTop))-scrollBefore)<=2,
      name+': switching to Image must retain report scroll position');
    const imageBounds=await imageActions.boundingBox();
    assert(imageBounds&&imageBounds.y>=0&&imageBounds.y+imageBounds.height<=viewport.height+2,
      name+': Image share popup must be within viewport');
    const dlPng=page.getByRole('button',{name:'Tải ảnh'});
    await ready(dlPng);
    const pngPromise=page.waitForEvent('download',{timeout:30000});
    await dlPng.click();
    const imageDownload=await pngPromise;
    const png=fs.readFileSync(await imageDownload.path());
    assert(png.length>3000&&png.subarray(1,4).toString()==='PNG','Crew share PNG invalid');
    results.push({viewport:name,format:'png',bytes:png.length,file:imageDownload.suggestedFilename()});

    await page.getByRole('button',{name:'Chia sẻ ảnh'}).click();
    assert((await page.evaluate(()=>window.__crewShareEvents)).some(evt=>evt.files.some(f=>f.type==='image/png')),
      'Browser Web Share API must receive actual PNG attachment');
    await imageActions.getByRole('button',{name:'Đóng tùy chọn'}).click();
    assert.equal(await page.locator('[data-hnl-crew-action-menu]').count(),0,'Dismiss overlay without losing report');
    assert(Math.abs((await dialog.evaluate(el=>el.scrollTop))-scrollBefore)<=2,
      name+': closing overlay must restore previous report scroll position');
    assert.deepEqual(errors,[],'Browser JS errors');
    await page.screenshot({path:'runtime-evidence/crew-share-'+name+'.png',fullPage:true});
    await context.close();
  }
  assert.equal(results.length,4);
  fs.writeFileSync('runtime-evidence/crew-report-export-browser.json',JSON.stringify({status:'PASS',results},null,2));
  console.log('CREW REAL PNG/EXCEL DOWNLOAD + SHARE EVENT PASS',JSON.stringify(results));
}finally{await browser?.close();vite.kill('SIGTERM');}
