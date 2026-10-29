import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const app=fs.readFileSync('src/App.tsx','utf8');
const nav=fs.readFileSync('src/components/BottomNav.tsx','utf8');
const avatar=fs.readFileSync('src/components/DesktopAccountMenu.tsx','utf8');
assert(app.includes('desktopAccountHasPendingSync')&&app.includes('await signOutGoogle()'),'Auth signout must use existing confirmed Firebase path');
assert(app.includes('firestorePendingWriteCount > 0')&&app.includes('Number(photoCloudStatus.pending || 0) > 0'),'Pending Firestore/photo safeguards must remain');
assert(app.includes('onLockNow={handleDesktopLockNow}')&&app.includes('onSignOut={handleDesktopAccountSignOut}'),'Existing app callbacks must be wired');
assert(nav.includes('<DesktopAccountMenu')&&nav.indexOf('<DesktopAccountMenu')>nav.indexOf('data-hnl-nav-surface="desktop"'),'Avatar must appear inside desktop rail');
assert(nav.indexOf('<DesktopAccountMenu')<nav.indexOf('data-hnl-nav-surface="mobile"'),'Mobile navigation must remain separate');
assert(avatar.includes('subscribeToFirebaseAuthStatus')&&avatar.includes('referrerPolicy="no-referrer"'),'Use current Firebase account avatar only');
assert(avatar.includes('roleResolved')&&avatar.includes('hasPendingSync'),'Prevent auth role and pending write mistakes');
const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_APP_ENV:'DEV',VITE_RUNTIME_BACKEND:'firebase-only',VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_EMULATOR_PROJECT_ID:'demo-hnl-qltc-dev'}});
let log='';for(const x of [vite.stdout,vite.stderr])x.on('data',c=>{log+=String(c);});
let browser;
try {
 const url='http://127.0.0.1:'+port+'/scripts/fixtures/desktop-account/index.html';
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(url)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,250));}
 assert(ready,'Fixture unavailable '+log.slice(-700));
 browser=await chromium.launch({headless:true});
 for(const width of [1366,393]){
  const ctx=await browser.newContext({viewport:{width,height:width===1366?800:852},isMobile:width===393,hasTouch:width===393});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('[data-hnl-fixture-content]').waitFor({state:'visible'});
  if(width===1366){
    const rail=page.locator('[data-hnl-nav-surface="desktop"]');
    assert(await rail.isVisible(),'PC rail must be visible');
    const trigger=rail.getByRole('button',{name:'Mở menu tài khoản Google'});
    assert(await trigger.isVisible(),'Avatar button missing at top-left');
    const avatarBox=await trigger.boundingBox();assert(avatarBox?.x<90&&avatarBox.y<90,'Avatar must fit at top-left PC rail');
    await trigger.click();
    const menu=page.getByRole('menu',{name:'Thông tin và thao tác tài khoản'});
    assert(await menu.isVisible(),'Account flyout must open on desktop');
    const menuBox=await menu.boundingBox();assert(menuBox?.x>=84&&menuBox.x+menuBox.width<=1366,'Account panel must not overlap rail or right edge');
    assert((await menu.innerText()).includes('Quản trị viên'),'Role label must render');
    await menu.getByRole('menuitem',{name:'Thông tin tài khoản'}).click();
    assert.equal(await page.evaluate(()=>window.__testNav.account),1,'Account action must call parent');
    await trigger.click();await menu.getByRole('menuitem',{name:'Khóa ứng dụng'}).click();
    assert.equal(await page.evaluate(()=>window.__testNav.lock),1,'Lock action must call parent');
    await trigger.click();await page.keyboard.press('Escape');assert(!(await menu.isVisible()),'Escape closes account flyout');
    await trigger.click();await page.locator('[data-hnl-fixture-content]').click({position:{x:600,y:200}});assert(!(await menu.isVisible()),'Outside click closes flyout');
  } else {
    assert(await page.locator('[data-hnl-nav-surface="mobile"]').isVisible(),'Mobile bottom navigation must remain visible');
    assert(!(await page.locator('[data-hnl-nav-surface="desktop"]').isVisible()),'Desktop rail must not cover phone');
    assert(!(await page.locator('button[aria-label="Mở menu tài khoản Google"]').isVisible()),'Avatar PC must be hidden on mobile');
    const box=await page.locator('[data-hnl-nav-surface="mobile"]').boundingBox();assert(box?.y>730,'Mobile nav must stay at bottom');
  }
  assert.deepEqual(errors,[],width+': browser console page errors');
  console.log('PASS account menu fixture '+width+'px');await ctx.close();
 }
} finally {await browser?.close();vite.kill('SIGTERM');}
console.log('PASS DEV Backup PC account avatar: desktop/mobile visual and guarded callback golden');
