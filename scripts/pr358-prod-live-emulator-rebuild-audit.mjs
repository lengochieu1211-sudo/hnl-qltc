#!/usr/bin/env node
// READ PROD FIRESTORE, WRITE ONLY TO LOCAL EMULATOR - never writes to any cloud service.
// Treat document contents as sensitive: no business payloads, paths or emails in stdout/artifacts.
import {createSign} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {crawlFirestore,listDocumentsQuery} from './p2115-firestore-traversal.mjs';
import {restoreToEmptyEmulator,inventory,assertIsolatedEmulator} from './p2115-firestore-restore-core.mjs';
const PROD='com-example-qlct-61329', TARGET='hnl-qltc-restore-isolated';
if(process.env.GITHUB_REF!=='refs/heads/audit/pr358-prod-to-local-emulator-20261030')throw Error('UNPINNED_BRANCH');
if(process.env.PR358_CANDIDATE!=='1d69495c939911a5b20c1046f356777adcdeb44c')throw Error('UNPINNED_SOURCE');
const host=process.env.FIRESTORE_EMULATOR_HOST,targetProject=process.env.P2115_RESTORE_TARGET;
assertIsolatedEmulator({host,targetProject});
if(targetProject!==TARGET)throw Error('NOT_LOCAL_RESTORE_TARGET');
const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
if(sa.project_id!==PROD||sa.type!=='service_account'||!sa.private_key||!sa.client_email)throw Error('WRONG_PROD_READ_CREDENTIALS');
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const head=enc({alg:'RS256',typ:'JWT'});
const body=enc({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3100});
const signer=createSign('RSA-SHA256');signer.update(head+'.'+body);signer.end();
const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:head+'.'+body+'.'+signer.sign(sa.private_key).toString('base64url')}),signal:AbortSignal.timeout(35000)});
if(!res.ok)throw Error('READ_TOKEN_HTTP_'+res.status);
const access=(await res.json()).access_token;
if(!access)throw Error('READ_TOKEN_MISSING');
const base='https://firestore.googleapis.com/v1/projects/'+PROD+'/databases/(default)/documents';
const docPrefix='projects/'+PROD+'/databases/(default)/documents/';
let requests=0;
async function read(relative,method='GET',input) {
 if(++requests>42000)throw Error('READ_ONLY_MAX_REQUESTS');
 if(method!=='GET'&&!(method==='POST'&&relative.endsWith(':listCollectionIds')))throw Error('PROD_MUTATING_METHOD_BLOCKED');
 for(let n=0;n<4;n++){
  const r=await fetch(base+relative,{method,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(40000)});
  if((r.status===429||r.status>=500)&&n<3){await new Promise(ok=>setTimeout(ok,(n+1)*1200));continue;}
  if(!r.ok)throw Error('FIRESTORE_SOURCE_READ_HTTP_'+r.status);
  return r.json();
 }
 throw Error('READ_RETRIES_EXHAUSTED');
}
const escaped=v=>v.split('/').map(encodeURIComponent).join('/');
async function listCollections(parent) {
 let cursor='',page=0,ids=[];
 do {
  const q=await read((parent?'/'+escaped(parent):'')+':listCollectionIds','POST',{pageSize:200,...(cursor?{pageToken:cursor}:{})});
  ids.push(...(q.collectionIds||[]));
  cursor=q.nextPageToken||'';
  if(++page>250)throw Error('COLLECTION_PAGINATION_CAP');
 }while(cursor);
 return [...new Set(ids)].sort();
}
const docs=[],unique=new Set();
await crawlFirestore({
 listCollections,
 listDocuments:(p,c)=>read('/'+escaped(p)+'?'+listDocumentsQuery(c).toString()),
 documentPath:(doc,c)=> {
  if(!doc.name?.startsWith(docPrefix))throw Error('FOREIGN_DOCUMENT');
  const path=doc.name.slice(docPrefix.length);
  if(!path.startsWith(c+'/')||path.split('/').length%2)throw Error('INVALID_PATH');
  return path;
 },
 onCollection:async()=>{},
 onDocument:async(doc,path)=>{
  if(docs.length>=15000)throw Error('SOURCE_DOCUMENT_CAP');
  if(unique.has(path))throw Error('SOURCE_DUPLICATE_DOC');
  unique.add(path);
  docs.push({path,fields:doc.fields||{}});
 }
});
if(docs.length<4977)throw Error('LIVE_DOCUMENT_COUNT_LESS_THAN_LAST_4977_BACKUP');
const source=inventory(docs);
const restore=await restoreToEmptyEmulator({host,targetProject:TARGET,documents:docs});
if(source.documents!==restore.documents||source.sha256!==restore.sha256)throw Error('RESTORE_DIGEST_MISMATCH');
const evidence={status:'LIVE_TO_ISOLATED_FIRESTORE_EMULATOR_PARITY_PASS',prodSourceProject:PROD,restoreTarget:TARGET,sourceSha:process.env.PR358_CANDIDATE,documents:source.documents,collectionTraversalRequests:requests,inventoryDigest:source.sha256,liveProdReadOnly:true,emulatorIsolated:true,encryptedExistingBackupDecryptionVerified:false,productionRestorePerformed:false,certified:false};
writeFileSync('PR358-PROD-LIVE-EMULATOR-REBUILD-AGGREGATE.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
