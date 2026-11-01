import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const CANDIDATE='33a24cc3e97bdce61058fd2c2219c37da4f40642';
const origin='http://127.0.0.1:4173';
const out='runtime-evidence/pr375-isolated-qa';
fs.mkdirSync(out,{recursive:true});
const report={
  kind:'PR375_LOCAL_EMULATOR_BROWSER_PREFLIGHT',
  sourceCandidate:CANDIDATE,
  qaHead:String(process.env.GITHUB_SHA||''),
  environment:'DEV + demo-hnl-pr375 Emulator only',
  explicitlyNot:'Runtime Golden authenticated / physical Windows EXE / physical Android APK / iPhone Safari / PROD data parity',
  checkedAt:new Date().toISOString(),
  tests:[]
};
const mark=(name,status,details={})=>{report.tests.push({name,status,...details});console.log(status+' '+name);};
const save=()=>fs.writeFileSync(out+'/REPORT.json',JSON.stringify(report,null,2));
const disallowed=[
 'com-example-qlct-61329',
 'hnlqltc.web.app',
 'hnl-qltc-r2-gateway.lengochieu1211.workers.dev',
 'hnl-qltc-ai-gateway.lengochieu1211.workers.dev'
];
const configurations=[
 {name:'desktop',width:1440,height:900,isMobile:false},
 {name:'android-mobile',width:393,height:852,isMobile:true},
 {name:'small-mobile',width:360,height:640,isMobile:true},
 {name:'iphone-viewport-chromium',width:390,height:844,isMobile:true}
];
const browser=await chromium.launch({headless:true});
try{
 for(const c of configurations){
  const context=await browser.newContext({viewport:{width:c.width,height:c.height},isMobile:c.isMobile,hasTouch:c.isMobile,deviceScaleFactor:c.isMobile?2:1,locale:'vi-VN'});
  const page=await context.newPage();
  const pageErrors=[], blockedProd=[];
  page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
  await context.route('**/*',async route=>{
    const u=route.request().url();
    if(disallowed.some(s=>u.includes(s))){blockedProd.push(u.slice(0,250));await route.abort();return;}
    await route.continue();
  });
  const resp=await page.goto(origin+'/?pr375-qa='+CANDIDATE.slice(0,12),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(1800);
  const data=await page.evaluate(()=>({
    title:document.title,
    visibleTextChars:(document.body?.innerText||'').trim().length,
    rootPresent:Boolean(document.querySelector('#root')),
    viewportWidth:window.innerWidth,
    scrollWidth:document.documentElement.scrollWidth,
    appEnvironmentText:(document.body?.innerText||'').slice(0,180)
  }));
  const path=out+'/'+c.name+'.png';
  await page.screenshot({path,fullPage:false});
  const errors=[];
  if(resp?.status()!==200)errors.push('HTTP '+resp?.status());
  if(!data.rootPresent||data.visibleTextChars<10)errors.push('UI blank/no #root');
  if(data.scrollWidth>data.viewportWidth+80)errors.push('horizontal overflow '+data.scrollWidth+'/'+data.viewportWidth);
  if(pageErrors.length)errors.push('uncaught JS errors '+JSON.stringify(pageErrors));
  if(blockedProd.length)errors.push('attempted PROD network access '+JSON.stringify(blockedProd));
  mark(c.name,errors.length?'FAIL':'PASS',{...data,errors,blockedProd,screenshot:path});
  await context.close();
 }
 assert(report.tests.every(x=>x.status==='PASS'),'Isolated browser smoke failures');
}finally{await browser.close();save();}
console.log('PR375 isolated browser preflight complete. Authenticated/physical Runtime Golden remains pending.');
