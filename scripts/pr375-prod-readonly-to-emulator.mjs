#!/usr/bin/env node
// QA only: read real PROD Firestore via REST (never write PROD) and restore into a
// local ephemeral Firestore Emulator. Never export plaintext data or credentials.
import fs from 'node:fs';
import {createSign,createHash} from 'node:crypto';
import {crawlFirestore,listDocumentsQuery} from './p2115-firestore-traversal.mjs';
import {assertIsolatedEmulator,inventory,restoreToEmptyEmulator} from './p2115-firestore-restore-core.mjs';

const sourceProject='com-example-qlct-61329';
const targetProject='hnl-qltc-restore-isolated';
const host=process.env.FIRESTORE_EMULATOR_HOST;
assertIsolatedEmulator({host,targetProject});
if(process.env.PR375_REAL_PROD_READ_TO_EMULATOR!=='ALLOW_READONLY_LIVE_TO_EMULATOR')
  throw Error('QA RESTORE CONSENT TOKEN REQUIRED');
const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
if(sa.type!=='service_account'||sa.project_id!==sourceProject||!sa.private_key||!sa.client_email)
  throw Error('PROD READONLY FIRESTORE SERVICE ACCOUNT PROJECT MISMATCH');
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const head=enc({alg:'RS256',typ:'JWT'});
const body=enc({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3300});
const signer=createSign('RSA-SHA256');signer.update(head+'.'+body);signer.end();
const jwt=head+'.'+body+'.'+signer.sign(sa.private_key).toString('base64url');
const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('PROD DATASTORE READ TOKEN '+response.status);
const token=(await response.json()).access_token;
if(!token)throw Error('Missing read access token');
const base='https://firestore.googleapis.com/v1/projects/'+sourceProject+'/databases/(default)/documents';
const pfx='projects/'+sourceProject+'/databases/(default)/documents/';
const rows=[];
const collections=new Set();
let totalBytes=0,requests=0;
function encodePath(s){return s.split('/').map(encodeURIComponent).join('/');}
async function api(path,options={}){
  for(let i=0;i<4;i++){
   requests++;
   if(requests>85000)throw Error('Firestore read-request safety ceiling');
   const r=await fetch(base+path,{...options,
     headers:{authorization:'Bearer '+token,'content-type':'application/json'},
     signal:AbortSignal.timeout(45000)});
   if((r.status===429||r.status>=500)&&i<3){await new Promise(resolve=>setTimeout(resolve,(i+1)*750));continue;}
   if(!r.ok)throw Error('Firestore read-only REST HTTP '+r.status);
   return r.json();
  }
  throw Error('Firestore REST retries exhausted');
}
await crawlFirestore({
  listCollections:async parent=>{
   const data=await api((parent?'/'+encodePath(parent):'')+':listCollectionIds',{method:'POST',body:JSON.stringify({pageSize:200})});
   return [...new Set(data.collectionIds||[])].sort();
  },
  listDocuments:async (path,cursor)=>api('/'+encodePath(path)+'?'+listDocumentsQuery(cursor)),
  documentPath:(doc,collection)=>{
   if(!doc.name?.startsWith(pfx))throw Error('Outside source Firestore project');
   const relative=doc.name.slice(pfx.length);
   if(!relative.startsWith(collection+'/')||relative.split('/').length%2!==0)throw Error('Invalid document relative path');
   return relative;
  },
  onCollection:async relative=>{collections.add(relative);},
  onDocument:async (doc,path)=>{
   totalBytes+=Buffer.byteLength(JSON.stringify(doc.fields||{}));
   if(rows.length>=15000||totalBytes>300000000)throw Error('Snapshot limit exceeded');
   rows.push({path,fields:doc.fields||{}});
  }
});
if(rows.length<4500)throw Error('PROD DOCUMENT COUNT LOWER THAN EXPECTED SAFETY FLOOR');
if(new Set(rows.map(x=>x.path)).size!==rows.length)throw Error('Source contains duplicate paths');
const source=inventory(rows);
const restored=await restoreToEmptyEmulator({host,targetProject,documents:rows});
if(source.documents!==restored.documents||source.sha256!==restored.sha256)throw Error('RESTORE DATA PARITY FAILED');
try{await restoreToEmptyEmulator({host,targetProject,documents:rows});throw Error('Second restore must reject populated emulator');}
catch(e){if(!String(e).includes('RESTORE_TARGET_NOT_EMPTY'))throw e;}
const summary={
 status:'REAL_PROD_READONLY_TO_ISOLATED_EMULATOR_RESTORE_PARITY_PASS',
 sourceProjectId:sourceProject,targetEmulatorProjectId:targetProject,
 sourceDocuments:source.documents,restoredDocuments:restored.documents,sourceCollections:collections.size,
 sourceInventorySha256:source.sha256,restoredInventorySha256:restored.sha256,
 sourceSnapshotReadRequests:requests,sourcePayloadBytes:totalBytes,
 sourceReadIsSequential:true,sourceSnapshotAtomic:false,
 readBackVerified:true,emptyTargetRejectVerified:true,prodWrites:false,
 encryptedBackupArtifactReplayed:false,
 checkedAt:new Date().toISOString(),qaHead:process.env.GITHUB_SHA||''
};
fs.writeFileSync('PR375-PROD-READONLY-EMULATOR-RESTORE-SUMMARY.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
