#!/usr/bin/env node
// Read-only Firestore collection-group snapshot. Encrypt before ANY GitHub artifact upload.
// P21.15: RSA-OAEP(SHA-256)-wrapped AES-256-GCM; user-only private key on Google Drive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createSign,randomBytes,publicEncrypt,createCipheriv,constants} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';

const project=process.env.P2115_FIRESTORE_PROJECT;
const raw=process.env.FIREBASE_SERVICE_ACCOUNT;
const expected=process.env.P2115_EXPECTED_PROJECT;
if(!project||project!==expected||!['hnl-qltc-dev','com-example-qlct-61329'].includes(project))throw Error('P21.15 project isolation failed');
if(!raw)throw Error('Missing Firestore service account secret');
let sa;try{sa=JSON.parse(raw);}catch{throw Error('Invalid service account JSON');}
if(sa.project_id!==project||sa.type!=='service_account'||!sa.private_key||!sa.client_email)throw Error('Service-account project mismatch');
const pub=fs.readFileSync('scripts/p2115-firestore-backup-public.pem','utf8');
const fingerprint=createHash('sha256').update(pub).digest('hex');
if(fingerprint!=='5b5c1d1b9f689fecc4be21d7a01400748e49a4a90834fe5fa29f7e9418520e28')throw Error('Public key fingerprint drift');
const jwt=(v)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const now=Math.floor(Date.now()/1000),body=jwt({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3300}),head=jwt({alg:'RS256',typ:'JWT'});
const signer=createSign('RSA-SHA256');signer.update(head+'.'+body);signer.end();
const assertion=head+'.'+body+'.'+signer.sign(sa.private_key).toString('base64url');
const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(30000)});
if(!tokenRes.ok)throw Error('Cannot get authorized Firestore read token '+tokenRes.status);
const token=(await tokenRes.json()).access_token;
if(typeof token!=='string'||!token)throw Error('Invalid access token');
const prefix='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents';
const maxDoc=Number(process.env.P2115_MAX_DOCS||15000),maxBytes=Number(process.env.P2115_MAX_BYTES||300000000);
if(!(maxDoc>0&&maxDoc<=30000&&maxBytes>0&&maxBytes<=500000000))throw Error('Unsafe snapshot limits');
let requests=0;
async function api(relative,options={}){
 for(let attempt=0;attempt<5;attempt++){
  if(++requests>maxDoc*5+1000)throw Error('Read request safety limit exceeded');
  try{
   const res=await fetch(prefix+relative,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000)});
   if((res.status===429||res.status>=500)&&attempt<4){await new Promise(r=>setTimeout(r,1000*(attempt+1)));continue;}
   if(!res.ok)throw Error('Firestore READ blocked '+res.status+' '+relative.split('?')[0].replace(/[^/]/g,'x').slice(0,120));
   return await res.json();
  }catch(e){if(attempt===4||!String(e).includes('timeout'))throw e;await new Promise(r=>setTimeout(r,750*(attempt+1)));}
 }
}
const encodePath=s=>s.split('/').map(encodeURIComponent).join('/');
async function listCollections(docPath){
 let pageToken='',result=[],pages=0;
 do{
  const payload={pageSize:200};
  if(pageToken)payload.pageToken=pageToken;
  const response=await api((docPath?'/'+encodePath(docPath):'')+':listCollectionIds',{method:'POST',body:JSON.stringify(payload)});
  result.push(...(response.collectionIds||[]));
  pageToken=response.nextPageToken||'';
  if(++pages>300)throw Error('Collection pagination exceeded');
 }while(pageToken);
 return [...new Set(result)].sort();
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'p2115-'));
const ndjson=path.join(temp,'snapshot.ndjson');
const handle=fs.openSync(ndjson,'wx',0o600);
let documents=0,bytes=0;
const contentHash=createHash('sha256'),collections=new Set(),docsByCollection=new Map();
async function crawl(parentDocPath,depth=0){
 if(depth>16)throw Error('Nested Firestore depth cap exceeded');
 const ids=await listCollections(parentDocPath);
 for(const col of ids){
  const relative=(parentDocPath?parentDocPath+'/':'')+col;
  collections.add(relative.replace(/\/[^/]+\/(?=[^/]+$)/g,'/*/'));
  let cursor='',page=0;
  do{
   const qs=new URLSearchParams({pageSize:'200'});if(cursor)qs.set('pageToken',cursor);
   const response=await api('/'+encodePath(relative)+'?'+qs);
   const arr=response.documents||[];
   for(const doc of arr){
    if(!doc.name||!doc.name.startsWith('projects/'+project+'/databases/(default)/documents/'))throw Error('Unexpected external document path');
    const rel=doc.name.split('/documents/')[1];
    if(!rel?.startsWith(relative+'/'))throw Error('Unexpected collection document path');
    const line=JSON.stringify({document:doc})+'\n';
    const b=Buffer.byteLength(line);
    if(++documents>maxDoc||((bytes+=b)>maxBytes))throw Error('Snapshot exceeds safety limits; no artifact exported');
    fs.writeSync(handle,line);contentHash.update(line);
    const pattern=rel.split('/').map((v,i)=>i%2===1?'*':v).join('/');
    docsByCollection.set(pattern,(docsByCollection.get(pattern)||0)+1);
    await crawl(rel,depth+1);
   }
   cursor=response.nextPageToken||'';
   if(++page>1000)throw Error('Document pagination exceeded');
  }while(cursor);
 }
}
try{await crawl('');}finally{fs.closeSync(handle);}
if(!documents)throw Error('Firestore empty or inaccessible; refuse empty backup certification');
const key=randomBytes(32),nonce=randomBytes(12);
const wrappedKey=publicEncrypt({key:pub,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key);
const cipher=createCipheriv('aes-256-gcm',key,nonce);
const artifact='P2115-FIRESTORE-'+project+'-'+(process.env.GITHUB_SHA||'UNKNOWN').slice(0,12)+'.jsonl.gz.aes256';
const output=path.resolve(artifact);
await pipeline(fs.createReadStream(ndjson),createGzip({level:8}),cipher,fs.createWriteStream(output,{mode:0o600,flags:'wx'}));
const digest=createHash('sha256').update(fs.readFileSync(output)).digest('hex');
const publicManifest={
 format:'HNL-QLTC-P2115-FIRESTORE-V1',project,createdAt:new Date().toISOString(),
 sourceHead:process.env.GITHUB_SHA,documents,collections:collections.size,
 collectionCounts:Object.fromEntries([...docsByCollection.entries()].sort((a,b)=>a[0].localeCompare(b[0]))),
 plaintextBytes:bytes,plaintextSha256:contentHash.digest('hex'),
 encryptedFile:artifact,encryptedBytes:fs.statSync(output).size,encryptedSha256:digest,
 algorithm:'AES-256-GCM',compression:'gzip',wrappedKeyAlgorithm:'RSA-OAEP-SHA256',
 wrappedKeyBase64:wrappedKey.toString('base64'),ivBase64:nonce.toString('base64'),
 tagBase64:cipher.getAuthTag().toString('base64'),publicKeySha256:fingerprint,
 consistency:'non-atomic document-by-document REST snapshot; NOT equivalent to managed export',
 snapshotMaxDocuments:maxDoc,reads:requests
};
fs.writeFileSync(artifact+'.manifest.json',JSON.stringify(publicManifest,null,2),{mode:0o600});
fs.rmSync(temp,{force:true,recursive:true});
key.fill(0);
console.log(JSON.stringify({status:'ENCRYPTED_FIRESTORE_READ_ONLY_SNAPSHOT_CREATED',project,documents,collections:collections.size,encryptedBytes:publicManifest.encryptedBytes,encryptedSha256:digest,readRequests:requests,consistency:publicManifest.consistency}));
