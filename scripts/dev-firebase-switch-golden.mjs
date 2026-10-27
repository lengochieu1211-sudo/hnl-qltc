import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateDevTarget, switchDevTarget, managedTarget} from './dev-firebase-switch.mjs';
let passed=0;
const base=`VITE_APP_ENV=DEV\nVITE_DEV_FIREBASE_TARGET=backup\nVITE_FIREBASE_PROJECT_ID=hnl-qltc-dev-backup\nVITE_FIREBASE_API_KEY=AIza-SYNTHETIC-NOT-REAL\nVITE_FIREBASE_AUTH_DOMAIN=hnl-qltc-dev-backup.firebaseapp.com\nVITE_FIREBASE_APP_ID=1:123:web:test-synthetic\nVITE_FIREBASE_MESSAGING_SENDER_ID=123\nVITE_WAREHOUSE_TRUSTED_WRITER=false\nVITE_BINARY_STORAGE_PROVIDER=r2\nVITE_R2_GATEWAY_URL=\nVITE_HNL_AI_ENABLED=false\n`;
function test(name,fn) {fn(); passed++;console.log('PASS',name)}
function fails(regex,fn){assert.throws(fn,regex)}
test('valid backup config',()=>assert.equal(validateDevTarget(base,'backup').projectId,'hnl-qltc-dev-backup'));
test('backup cannot use prod',()=>fails(/PROJECT_MISMATCH/,()=>validateDevTarget(base.replace('hnl-qltc-dev-backup\n','com-example-qlct-61329\n'),'backup')));
test('backup cannot impersonate primary',()=>fails(/PROJECT_MISMATCH/,()=>validateDevTarget(base.replace('VITE_FIREBASE_PROJECT_ID=hnl-qltc-dev-backup','VITE_FIREBASE_PROJECT_ID=hnl-qltc-dev'),'backup')));
test('backup cannot point to primary R2',()=>fails(/R2_MUST_BE_SEPARATE/,()=>validateDevTarget(base.replace('VITE_R2_GATEWAY_URL=', 'VITE_R2_GATEWAY_URL=https://hnl-qltc-r2-gateway-dev.lengochieu1211.workers.dev'),'backup')));
test('backup cannot share prod R2',()=>fails(/R2_MUST_BE_SEPARATE|PROD_R2_FORBIDDEN/,()=>validateDevTarget(base.replace('VITE_R2_GATEWAY_URL=', 'VITE_R2_GATEWAY_URL=https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev'),'backup')));
test('backup cannot enable trusted writer under Spark',()=>fails(/REQUIRES_BLAZE/,()=>validateDevTarget(base.replace('TRUSTED_WRITER=false','TRUSTED_WRITER=true'),'backup')));
test('backup cannot enable cross-project AI',()=>fails(/AI_MUST_BE_DISABLED/,()=>validateDevTarget(base.replace('VITE_HNL_AI_ENABLED=false','VITE_HNL_AI_ENABLED=true'),'backup')));
test('backup cannot enable Firebase Storage on Spark',()=>fails(/STORAGE_REQUIRES_BLAZE/,()=>validateDevTarget(base.replace('VITE_BINARY_STORAGE_PROVIDER=r2','VITE_BINARY_STORAGE_PROVIDER=firebase-storage'),'backup')));
test('duplicate vars rejected',()=>fails(/DUPLICATE_KEY/,()=>validateDevTarget(base+'VITE_APP_ENV=DEV\n','backup')));
test('wrong auth domain rejected',()=>fails(/AUTH_DOMAIN_MISMATCH/,()=>validateDevTarget(base.replace('backup.firebaseapp.com','firebaseapp.com'),'backup')));
test('production app mode rejected',()=>fails(/MUST_BE_DEV/,()=>validateDevTarget(base.replace('VITE_APP_ENV=DEV','VITE_APP_ENV=PROD'),'backup')));
test('valid primary config',()=>{const p=base.replace('VITE_DEV_FIREBASE_TARGET=backup','VITE_DEV_FIREBASE_TARGET=primary').replaceAll('hnl-qltc-dev-backup','hnl-qltc-dev'); assert.equal(validateDevTarget(p,'primary').projectId,'hnl-qltc-dev');});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hnl-dev-target-'));
try {
 fs.writeFileSync(path.join(dir,'.env.dev-backup.local'),base);
 test('dry-run never changes target',()=>{const s=switchDevTarget({projectRoot:dir,target:'backup',dryRun:true});assert.equal(s.activated,false);assert.equal(fs.existsSync(path.join(dir,'.env.local')),false)});
 test('switch writes managed config',()=>{const s=switchDevTarget({projectRoot:dir,target:'backup'});assert.equal(s.activated,true);assert.equal(managedTarget(fs.readFileSync(path.join(dir,'.env.local'),'utf8')),'backup')});
 test('refuse to overwrite un-managed local env',()=>{fs.writeFileSync(path.join(dir,'.env.local'),'VITE_APP_ENV=PROD\n');fails(/UNMANAGED_ENV_LOCAL/,()=>switchDevTarget({projectRoot:dir,target:'backup'}))});
 test('switch safely back to primary',()=>{const p=base.replace('VITE_DEV_FIREBASE_TARGET=backup','VITE_DEV_FIREBASE_TARGET=primary').replaceAll('hnl-qltc-dev-backup','hnl-qltc-dev');fs.writeFileSync(path.join(dir,'.env.dev-primary.local'),p);fs.writeFileSync(path.join(dir,'.env.local'),'# HNL_QLTC_MANAGED_DEV_TARGET=backup\n'+base);const s=switchDevTarget({projectRoot:dir,target:'primary'});assert.equal(s.projectId,'hnl-qltc-dev');assert.equal(managedTarget(fs.readFileSync(path.join(dir,'.env.local'),'utf8')),'primary')});
} finally {fs.rmSync(dir,{recursive:true,force:true})}
console.log(`${passed}/${passed} DEV Firebase fallback guard tests PASS`);
