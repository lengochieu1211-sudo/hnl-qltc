import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webkit} from 'playwright';

const base='http://127.0.0.1:4174';
const out='runtime-evidence/pr375-webkit-emulator-auth';
const users=['ADMIN','EDITOR','VIEWER'];
fs.mkdirSync(out,{recursive:true});
const report={
 scope:'DEV ONLY: sign-in and post-auth shell (not full RBAC or physical Runtime Golden)',
 exactBase:'33a24cc3e97bdce61058fd2c2219c37da4f40642',
 qaCommit:process.env.GITHUB_SHA||'',
 projectId:'demo-hnl-pr375',
 createdAt:new Date().toISOString(),
 results:[]
};
const denied=['com-example-qlct-61329','hnlqltc.web.app','hnl-qltc-r2-gateway.lengochieu1211.workers.dev','hnl-qltc-ai-gateway.lengochieu1211.workers.dev'];
const browser=await webkit.launch({headless:true});
try{
 for(const viewport of [{name:'iphone-webkit',width:393,height:852,isMobile:true}]){
  for(const user of users){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:viewport.isMobile,hasTouch:viewport.isMobile,locale:'vi-VN'});
   const page=await context.newPage();const forbidden=[],errors=[];
   page.on('pageerror',e=>errors.push(String(e.message).slice(0,220)));
   await context.route('**/*',async route=>{
     const url=route.request().url();
     if(denied.some(s=>url.includes(s))){forbidden.push(url.slice(0,240));await route.abort();return;}
     await route.continue();
   });
   try{
    const res=await page.goto(base+'/?auth-qa='+user,{waitUntil:'domcontentloaded',timeout:60000});
    assert.equal(res?.status(),200,'Dev Vite server refused');
    await page.waitForFunction(()=>Boolean(document.querySelector('[data-hnl-auth-gate]')),{timeout:20000});
    const auth=await page.evaluate(async kind=>{
      const fb=await import('/src/lib/firebase.ts');
      if(!fb.FIREBASE_EMULATOR_ENABLED || fb.APP_ENVIRONMENT!=='DEV')throw Error('Emulator safety guard refused');
      const id=await fb.signInWithEmulatorTestAccount(kind);
      const who=fb.getCurrentRealFirebaseUser();
      if(!who || who.uid!==id.uid || !who.email?.toLowerCase().startsWith(kind.toLowerCase()))throw Error('Emulator authenticated identity mismatch');
      return {email:who.email,uidPresent:Boolean(who.uid),emulator:true};
    },user);
    await page.waitForFunction(()=>!document.querySelector('[data-hnl-auth-gate]')||document.querySelector('[data-hnl-auth-gate]')?.getAttribute('data-hnl-auth-gate')==='authenticated',{timeout:30000});
    await page.waitForTimeout(1600);
    const state=await page.evaluate(()=>({
      gate:document.querySelector('[data-hnl-auth-gate]')?.getAttribute('data-hnl-auth-gate')||'cleared',
      bodyChars:(document.body?.innerText||'').trim().length,
      appRoot:Boolean(document.querySelector('#root')),
      activeTab:document.querySelector('main[data-hnl-active-tab]')?.getAttribute('data-hnl-active-tab')||null,
      scrollWidth:document.documentElement.scrollWidth,
      innerWidth:window.innerWidth
    }));
    assert(state.appRoot && state.bodyChars>=15,'Post login app missing');
    assert(state.gate!=='signed-out'&&state.gate!=='checking','Auth gate not cleared');
    assert(state.scrollWidth<=state.innerWidth+80,'Horizontal overflow after auth');
    assert.equal(forbidden.length,0,'Attempted real PROD network');
    assert.equal(errors.length,0,'Uncaught errors: '+errors.join(';'));
    const file=out+'/'+viewport.name+'-'+user.toLowerCase()+'.png';
    await page.screenshot({path:file,fullPage:false});
    report.results.push({device:viewport.name,role:user,status:'PASS',auth,state,screenshot:file});
    console.log('PASS '+viewport.name+' '+user+' emulator login & post-auth render');
   }catch(err){
    report.results.push({device:viewport.name,role:user,status:'FAIL',error:String(err),errors,forbidden});
    console.error('FAIL '+viewport.name+' '+user+' '+String(err));
   }finally{await context.close();}
  }
 }
 assert(report.results.length===3 && report.results.every(x=>x.status==='PASS'),'Emulator authenticated shell smoke failed');
}finally{
 fs.writeFileSync(out+'/REPORT.json',JSON.stringify(report,null,2));
 await browser.close();
}
console.log('WEBKIT EMULATOR AUTH SHELL TESTS PASS. NOT NATIVE IPHONE SAFARI OR PROD GOLDEN.');
