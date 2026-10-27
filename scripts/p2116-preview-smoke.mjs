import {chromium} from 'playwright';
import fs from 'node:fs';
const url=process.env.P2116_PREVIEW_URL||'';
if(!/^https:\/\/hnl-qltc-dev--[a-z0-9-]+\.web\.app$/.test(url))throw Error('No valid DEV preview URL');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const view of [{name:'PC',width:1440,height:900},{name:'AndroidPhone',width:390,height:844}]){
  const page=await browser.newPage({viewport:{width:view.width,height:view.height},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e.message).slice(0,250)));
  const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(2500);
  const d=await page.evaluate(()=>({title:document.title,bodyLength:document.body?.innerText?.length||0,docWidth:document.documentElement.scrollWidth,viewWidth:window.innerWidth,appRoot:!!document.getElementById('root')}));
  await page.screenshot({path:'P2116-'+view.name+'.png',fullPage:true});
  results.push({view:view.name,status:r?.status(),...d,pageErrors:errors});
  await page.close();
  if(!r?.ok()||d.bodyLength<10||!d.appRoot||errors.length)throw Error('DEV UI smoke failure '+JSON.stringify(results));
 }
 fs.writeFileSync('P2116-DEV-PC-MOBILE-SMOKE.json',JSON.stringify(results,null,2));
 console.log('P21.16 DEV PC+Mobile unauthed smoke PASS, not Runtime Golden');
}finally{await browser.close()}
