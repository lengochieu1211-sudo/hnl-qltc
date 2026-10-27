import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageBackupHosting, verifyBackupHosting, inspectBackupTarget, BACKUP_GATEWAY, hostingSiteArgs, classifyHostingSiteLookup } from './dev-backup-hosting.mjs';
import { switchDevTarget } from './dev-firebase-switch.mjs';
let passed=0;
function test(name,fn){fn();passed++;console.log(`PASS ${name}`)}
const base=fs.mkdtempSync(path.join(os.tmpdir(),'hnl-backup-hosting-'));
try {
 const env=`VITE_APP_ENV=DEV\nVITE_DEV_FIREBASE_TARGET=backup\nVITE_RUNTIME_BACKEND=firebase-only\nVITE_FIREBASE_PROJECT_ID=hnl-qltc-dev-backup\nVITE_FIREBASE_API_KEY=AIzaSyC3pD9OyZ8My4q2UVB_pJEcE5hT30EGGL0\nVITE_FIREBASE_AUTH_DOMAIN=hnl-qltc-dev-backup.firebaseapp.com\nVITE_FIREBASE_APP_ID=1:87340841644:web:02c6f832427ddf30cf7d09\nVITE_FIREBASE_MESSAGING_SENDER_ID=87340841644\nVITE_WAREHOUSE_TRUSTED_WRITER=false\nVITE_BINARY_STORAGE_PROVIDER=r2\nVITE_R2_GATEWAY_URL=\nVITE_HNL_AI_ENABLED=false\n`;
 fs.writeFileSync(path.join(base,'.env.dev-backup.local'),env);
 fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({name:'safe',version:'1.0.0'}));
 fs.writeFileSync(path.join(base,'package-lock.json'),JSON.stringify({name:'safe',version:'1.0.0'}));
 const conf=JSON.parse(fs.readFileSync(new URL('../firebase.dev-backup.json',import.meta.url)));
 fs.writeFileSync(path.join(base,'firebase.dev-backup.json'),JSON.stringify(conf));
 test('cannot inspect before selecting the backup',()=>assert.throws(()=>inspectBackupTarget(base),/MANAGED_BACKUP_ENV_NOT_SELECTED/));
 switchDevTarget({projectRoot:base,target:'backup'});
 test('correct explicit backup',()=>assert.equal(inspectBackupTarget(base).verified.projectId,'hnl-qltc-dev-backup'));
 test('site creation command is backup-only and pinned to correct Google account',()=>{
  assert.deepEqual(hostingSiteArgs('create'),['hosting:sites:create','hnl-qltc-dev-backup','--project','hnl-qltc-dev-backup','--account','lengochieu1211@gmail.com','--non-interactive']);
  assert.deepEqual(hostingSiteArgs('get'),['hosting:sites:get','hnl-qltc-dev-backup','--project','hnl-qltc-dev-backup','--account','lengochieu1211@gmail.com','--non-interactive']);
 });
 test('existing site does not need creation',()=>assert.equal(classifyHostingSiteLookup(0,'Site exists'),'existing'));
 test('only explicit not-found permits provisioning',()=>assert.equal(classifyHostingSiteLookup(1,'FirebaseError: HTTP Error: 404, site not found'),'missing'));
 test('permission/auth failures cannot trigger site creation',()=>{
  for(const error of ['HTTP Error: 403 permission denied','PERMISSION_DENIED','You are not authorized']) assert.throws(()=>classifyHostingSiteLookup(1,error),/BACKUP_IAM_OR_LOGIN_NOT_VERIFIED/);
  assert.throws(()=>classifyHostingSiteLookup(1,'Unexpected network failure'),/BACKUP_SITE_LOOKUP_UNVERIFIED/);
 });
 test('cannot deploy full root Firebase config',()=>{const p=path.join(base,'firebase.dev-backup.json');fs.writeFileSync(p,JSON.stringify({...conf,firestore:{rules:'firestore.rules'}}));assert.throws(()=>inspectBackupTarget(base),/MUST_ONLY_TARGET_BACKUP_HOSTING/);fs.writeFileSync(p,JSON.stringify(conf))});
 test('cannot select PROD alias',()=>{const p=path.join(base,'.env.local');let orig=fs.readFileSync(p,'utf8');fs.writeFileSync(p,orig.replace('hnl-qltc-dev-backup','com-example-qlct-61329'));assert.throws(()=>inspectBackupTarget(base),/ENV_FILES_DIVERGED|PROJECT_MISMATCH/);fs.writeFileSync(p,orig)});
 test('reject background .env.production',()=>{const p=path.join(base,'.env.production');fs.writeFileSync(p,'VITE_FIREBASE_PROJECT_ID=com-example-qlct-61329\n');assert.throws(()=>inspectBackupTarget(base),/UNEXPECTED_ENV_FILE/);fs.unlinkSync(p)});
 test('cannot stage before build',()=>assert.throws(()=>stageBackupHosting(base),/VITE_BUILD_REQUIRED/));
 const dist=path.join(base,'dist');fs.mkdirSync(path.join(dist,'assets'),{recursive:true});
 fs.writeFileSync(path.join(dist,'index.html'),'<div id="root"></div>');
 fs.writeFileSync(path.join(dist,'assets','index.js'),'const firebaseConfig = "hnl-qltc-dev-backup" + "1:87340841644:web:02c6f832427ddf30cf7d09" + "AIzaSyC3pD9OyZ8My4q2UVB_pJEcE5hT30EGGL0"');
 test('stage successful build',()=>assert.equal(stageBackupHosting(base).projectId,'hnl-qltc-dev-backup'));
 test('verify immutable staging',()=>assert.equal(verifyBackupHosting(base).appEnv,'DEV'));
 test('Vite PDF worker survives staging and checksum verification',()=>{
  const rel='assets/pdf.worker.min-CLrFZWeq.mjs';
  fs.writeFileSync(path.join(dist,rel),'/* synthetic browser PDF worker */');
  const staged=stageBackupHosting(base);
  assert.ok(staged.files[rel]);
  assert.equal(fs.readFileSync(path.join(base,'dist-dev-backup-hosting',rel),'utf8'),'/* synthetic browser PDF worker */');
  assert.equal(verifyBackupHosting(base).files[rel],staged.files[rel]);
  fs.appendFileSync(path.join(base,'dist-dev-backup-hosting',rel),'tampered');
  assert.throws(()=>verifyBackupHosting(base),/CHECKSUM_MISMATCH/);
  stageBackupHosting(base);
 });
 test('other MJS, maps, and noncanonical PDF worker paths stay private',()=>{
  const files=['server.mjs','assets/server.mjs','assets/unrelated.mjs','assets/pdf.worker.min-CLrFZWeq.mjs.map','assets/pdf.worker.min.mjs','assets/pdf.worker.min-x.mjs.env'];
  for(const rel of files)fs.writeFileSync(path.join(dist,rel),'SENSITIVE');
  const staged=stageBackupHosting(base);
  for(const rel of files)assert.equal(staged.files[rel],undefined);
  verifyBackupHosting(base);
 });
 for(const f of ['server.cjs','server.cjs.map','admin.private.pem','bundle.ts','bad.apk']) fs.writeFileSync(path.join(dist,f),'SENSITIVE');
 test('server bundles and secrets excluded from web staging',()=>{stageBackupHosting(base);for(const f of ['server.cjs','server.cjs.map','admin.private.pem','bundle.ts','bad.apk'])assert.equal(fs.existsSync(path.join(base,'dist-dev-backup-hosting',f)),false)});
 test('tampered web bundle rejected',()=>{const p=path.join(base,'dist-dev-backup-hosting','assets','index.js');fs.appendFileSync(p,'tampered');assert.throws(()=>verifyBackupHosting(base),/CHECKSUM_MISMATCH/);stageBackupHosting(base)});
 test('cannot use stale staging when active config changes',()=>{const p=path.join(base,'.env.local');const v=fs.readFileSync(p,'utf8');fs.writeFileSync(p,v.replace('VITE_APP_ENV=DEV','VITE_APP_ENV=PROD'));assert.throws(()=>verifyBackupHosting(base),/ENV_FILES_DIVERGED/);fs.writeFileSync(p,v)});
 test('missing expected app ID blocked',()=>{const p=path.join(dist,'assets','index.js');const v=fs.readFileSync(p,'utf8');fs.writeFileSync(p,'const project="hnl-qltc-dev-backup";');assert.throws(()=>stageBackupHosting(base),/BUNDLE_LACKS_EXPECTED_BACKUP_APP_ID/);fs.writeFileSync(p,v)});
 function selectGateway(url) {
  fs.writeFileSync(path.join(base,'.env.dev-backup.local'),env.replace('VITE_R2_GATEWAY_URL=', 'VITE_R2_GATEWAY_URL='+url));
  switchDevTarget({projectRoot:base,target:'backup'});
 }
 test('audited backup gateway accepted; older staging rejected',()=>{
  selectGateway(BACKUP_GATEWAY);
  assert.equal(inspectBackupTarget(base).verified.mediaReady,true);
  assert.throws(()=>verifyBackupHosting(base),/STALE_OR_WRONG_STAGING/);
 });
 test('old build without configured gateway cannot be staged',()=>assert.throws(()=>stageBackupHosting(base),/BUNDLE_LACKS_AUDITED_BACKUP_GATEWAY/));
 test('gateway endpoint variants and foreign targets rejected',()=>{
  for(const url of [BACKUP_GATEWAY+'/',BACKUP_GATEWAY+'/object',BACKUP_GATEWAY+'?x=1',BACKUP_GATEWAY+'#x',BACKUP_GATEWAY.replace('https://','https://user@'),BACKUP_GATEWAY.replace('https://','https://')+':443','https://hnl-qltc-r2-gateway-dev.lengochieu1211.workers.dev','https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev',BACKUP_GATEWAY+'.evil.example']) {
   assert.throws(()=>{selectGateway(url);inspectBackupTarget(base)},/MEDIA_GATEWAY_NOT_AUDITED|R2_MUST_BE_SEPARATE|PROD_R2_FORBIDDEN/);
  }
  selectGateway(BACKUP_GATEWAY);
 });
 test('gateway build staged with explicit gateway metadata',()=>{
  fs.appendFileSync(path.join(dist,'assets','index.js'),'\nconst mediaGateway="'+BACKUP_GATEWAY+'";');
  assert.equal(stageBackupHosting(base).mediaGateway,BACKUP_GATEWAY);
  assert.equal(verifyBackupHosting(base).mediaGateway,BACKUP_GATEWAY);
 });
 test('gateway manifest tampering rejected',()=>{
  const p=path.join(base,'dist-dev-backup-hosting','hnl-dev-backup-release.json');
  const m=JSON.parse(fs.readFileSync(p));m.mediaGateway=null;fs.writeFileSync(p,JSON.stringify(m));
  assert.throws(()=>verifyBackupHosting(base),/STALE_OR_WRONG_STAGING/);stageBackupHosting(base);
 });
 test('configured gateway bundle rejected when env disables gateway',()=>{
  selectGateway('');assert.throws(()=>stageBackupHosting(base),/BUNDLE_GATEWAY_ENV_MISMATCH/);
  selectGateway(BACKUP_GATEWAY);stageBackupHosting(base);
 });
 test('unsanctioned extra published files detected',()=>{const p=path.join(base,'dist-dev-backup-hosting','unexpected.txt');fs.writeFileSync(p,'new');assert.throws(()=>verifyBackupHosting(base),/STAGING_FILE_SET_CHANGED/);fs.unlinkSync(p)});
}finally{fs.rmSync(base,{recursive:true,force:true})}
console.log(`${passed}/${passed} DEV BACKUP HOSTING GUARD PASS`);
