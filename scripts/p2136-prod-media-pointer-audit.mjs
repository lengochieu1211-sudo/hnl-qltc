#!/usr/bin/env node
// P21.36: READ-ONLY inventory; never export business documents, asset paths or secrets.
import {createHash,createSign} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {crawlFirestore,listDocumentsQuery} from './p2115-firestore-traversal.mjs';
const PROD='com-example-qlct-61329',BUCKET='hnl-qltc-media',ACCOUNT='4078cafe74946b0d5a67b35143b60071';
function decode(v) {
 if(!v||typeof v!=='object')return v;
 if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
 if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);
 for(const k of ['stringValue','integerValue','doubleValue','booleanValue'])if(k in v)return v[k];
 return undefined;
}
const stats={refs:{},r2Paths:new Map(),invalidR2:0,legacyByCollection:{},legacyByState:{},legacyByCollectionAndState:{}};
function parse(fields,documentName='') {
 const relative=String(documentName).split('/documents/')[1]||'';
 const collection=relative.split('/').filter((_,i)=>i%2===0).slice(-1)[0]||'unknown';
 const root=Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,decode(v)]));
 function walk(x,depth=0){
  if(!x||typeof x!=='object'||depth>25)return;
  if(Array.isArray(x)){for(const v of x)walk(v,depth+1);return}
  if('storageProvider' in x||'storagePath' in x||'cloudFileId' in x) {
   const provider=String(x.storageProvider||x.provider||'').toLowerCase();
   const raw=String(x.storagePath||x.cloudFileId||x.cloudUrl||'').trim();
   let type='';
   if(provider==='r2'||raw.startsWith('r2:'))type='r2';
   else if(provider==='firestore-fallback'||raw.startsWith('firestore:'))type='firestoreFallback';
   else if(provider.includes('drive')||/drive.google.com/.test(raw))type='drive';
   else if(provider.includes('firebase-storage')||raw.startsWith('storage:')||raw.includes('firebasestorage.googleapis.com'))type='firebaseStorage';
   else if(provider||raw)type='unknown';
   if(type){
    stats.refs[type]=(stats.refs[type]||0)+1;
    if(type!=='r2') {
     const state=(x.deleted===true||Boolean(x.deletedAt)||root.deleted===true||Boolean(root.deletedAt))?'tombstoned':'not-flagged-deleted';
     const key=collection+':'+type,byState=type+':'+state,byCollection=key+':'+state;
     stats.legacyByCollection[key]=(stats.legacyByCollection[key]||0)+1;
     stats.legacyByState[byState]=(stats.legacyByState[byState]||0)+1;
     stats.legacyByCollectionAndState[byCollection]=(stats.legacyByCollectionAndState[byCollection]||0)+1;
    }
    if(type==='r2') {
     const path=raw.replace(/^r2:/,'');
     if(!/^projects\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.includes('..'))stats.invalidR2++;
     else {
      const entry=stats.r2Paths.get(path)||{sizes:new Set(),sha:new Set(),collections:new Set(),states:new Set()};
      entry.collections.add(collection);
      // Deletion flags are hints only: nested/photo metadata may have tombstones elsewhere.
      const deleted=x.deleted===true||Boolean(x.deletedAt)||root.deleted===true||Boolean(root.deletedAt);
      entry.states.add(deleted?'tombstoned':'not-flagged-deleted');
      const bytes=Number(x.sizeBytes??x.byteSize??x.fileSize);
      if(bytes>0)entry.sizes.add(bytes);
      for(const k of ['sha256','checksum','contentSha256'])if(/^[a-f0-9]{64}$/i.test(String(x[k]||'')))entry.sha.add(String(x[k]).toLowerCase());
      stats.r2Paths.set(path,entry);
     }
    }
   }
  }
  for(const v of Object.values(x))if(v&&typeof v==='object')walk(v,depth+1);
 }
 walk(root);
}
if(process.argv.includes('--self-test')){
 parse({a:{mapValue:{fields:{storageProvider:{stringValue:'r2'},storagePath:{stringValue:'projects/proj_1/photo/p.jpg'}}}}});
 parse({a:{mapValue:{fields:{storageProvider:{stringValue:'firestore-fallback'},cloudFileId:{stringValue:'firestore:p'}}}}});
 if(stats.refs.r2!==1||stats.refs.firestoreFallback!==1||stats.r2Paths.size!==1)throw Error('SELF_TEST_FAILED');
 console.log('P21.36 synthetic detector PASS; no network access');
}else{
 await live();
}
async function live(){
 if(process.env.GITHUB_REF!=='refs/heads/safety/p2136-prod-media-pointer-audit-20261028'||process.env.P2136_PROJECT!==PROD||process.env.P2136_R2_BUCKET!==BUCKET)throw Error('REFUSING_UNAPPROVED_READ_ONLY_CONTEXT');
 const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}'),cloudToken=process.env.CLOUDFLARE_API_TOKEN;
 if(sa.type!=='service_account'||sa.project_id!==PROD||!sa.private_key||!sa.client_email||!cloudToken)throw Error('READ_ONLY_CREDENTIAL_GATE_FAILED');
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const a=encode({alg:'RS256',typ:'JWT'}),b=encode({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3000});
 const signer=createSign('RSA-SHA256');signer.update(a+'.'+b);signer.end();
 const login=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:a+'.'+b+'.'+signer.sign(sa.private_key).toString('base64url')}),signal:AbortSignal.timeout(30000)});
 if(!login.ok)throw Error('FIRESTORE_TOKEN_HTTP_'+login.status);
 const access=(await login.json()).access_token;
 if(!access)throw Error('MISSING_FIRESTORE_TOKEN');
 const base='https://firestore.googleapis.com/v1/projects/'+PROD+'/databases/(default)/documents',esc=s=>s.split('/').map(encodeURIComponent).join('/');
 let requests=0,documents=0;
 async function api(relative,body){
  if(++requests>35000)throw Error('READ_LIMIT_EXCEEDED');
  const result=await fetch(base+relative,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(40000)});
  if(!result.ok)throw Error('FIRESTORE_READ_HTTP_'+result.status);
  return result.json();
 }
 async function cols(parent){
  let cursor='',pages=0;const found=[];
  do{
   const o=await api((parent?'/'+esc(parent):'')+':listCollectionIds',{pageSize:200,...(cursor?{pageToken:cursor}:{})});
   found.push(...o.collectionIds||[]);cursor=o.nextPageToken||'';
   if(++pages>250)throw Error('COLLECTION_PAGINATION_CAP');
  }while(cursor);
  return [...new Set(found)];
 }
 const prefix='projects/'+PROD+'/databases/(default)/documents/';
 await crawlFirestore({
  listCollections:cols,
  listDocuments:(path,cursor)=>api('/'+esc(path)+'?'+listDocumentsQuery(cursor).toString()),
  documentPath:(doc,collection)=>{
   if(!doc.name?.startsWith(prefix))throw Error('FOREIGN_DOCUMENT');
   const rel=doc.name.slice(prefix.length);if(!rel.startsWith(collection+'/'))throw Error('WRONG_COLLECTION');
   return rel;
  },
  onCollection:async()=>{},
  onDocument:async(doc)=>{
   if(++documents>15000)throw Error('DOCUMENT_CAP_EXCEEDED');
   parse(doc.fields||{},doc.name);
  }
 });
 if(!documents)throw Error('EMPTY_FIRESTORE_NOT_CERTIFIED');
 const r2=new Map();let cursor='',pages=0;
 do{
  const apiURL='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/r2/buckets/'+BUCKET+'/objects?per_page=1000'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  const reply=await fetch(apiURL,{headers:{Authorization:'Bearer '+cloudToken},signal:AbortSignal.timeout(40000)});
  if(!reply.ok)throw Error('R2_HTTP_'+reply.status);
  const body=await reply.json();if(!body.success||!Array.isArray(body.result))throw Error('BAD_R2_METADATA');
  for(const item of body.result){if(r2.has(item.key))throw Error('DUPLICATE_R2_KEY');r2.set(item.key,item)}
  cursor=body.result_info?.is_truncated?(body.result_info.cursor||''):'';
  if(body.result_info?.is_truncated&&!cursor)throw Error('MISSING_R2_CURSOR');
  if(++pages>40)throw Error('R2_PAGINATION_CAP');
 }while(cursor);
 if(!r2.size)throw Error('EMPTY_R2_NOT_CERTIFIED');
 let matched=0,missing=0,sizeMismatch=0,hashMismatch=0,shaMetaAbsent=0;
 const missingByCollection={},missingByState={},missingDigests=[],missingWithSameBasename=[];
 const basenames=new Map();for(const k of r2.keys()){const b=k.split('/').at(-1);basenames.set(b,(basenames.get(b)||0)+1)}
 for(const [key,e] of stats.r2Paths){
  const obj=r2.get(key);
  if(!obj){
   missing++;
   missingDigests.push(createHash('sha256').update(key).digest('hex').slice(0,16));
   for(const c of e.collections)missingByCollection[c]=(missingByCollection[c]||0)+1;
   for(const st of e.states)missingByState[st]=(missingByState[st]||0)+1;
   if(basenames.has(key.split('/').at(-1)))missingWithSameBasename.push(createHash('sha256').update(key).digest('hex').slice(0,16));
   continue;
  }
  matched++;
  if(e.sizes.size&&!e.sizes.has(Number(obj.size)))sizeMismatch++;
  if(e.sha.size){
   const sha=String(obj.custom_metadata?.sha256||obj.custom_metadata?.contentSha256||'').toLowerCase();
   if(!sha)shaMetaAbsent++;else if(!e.sha.has(sha))hashMismatch++;
  }
 }
 const result={
  format:'HNL-QLTC-P2136-READ-ONLY-POINTER-AUDIT',
  sourceCandidateSha:process.env.P2136_CANDIDATE_SHA,runSha:process.env.GITHUB_SHA,
  projectId:PROD,storageBucket:BUCKET,utc:new Date().toISOString(),
  firestoreDocuments:documents,firestoreReadRequests:requests,referenceCounts:stats.refs,
  r2Objects:r2.size,r2ReferencedUnique:stats.r2Paths.size,r2MatchedUnique:matched,
  r2MissingUnique:missing,r2MalformedReferences:stats.invalidR2,
  r2SizeMismatches:sizeMismatch,r2ShaMismatches:hashMismatch,r2ShaMetadataAbsent:shaMetaAbsent,
  missingByCollection,missingByState,missingKeySha256Prefix16:missingDigests.sort(),missingWithSameBasenamePrefix16:missingWithSameBasename.sort(),legacyByCollection:stats.legacyByCollection,legacyByState:stats.legacyByState,legacyByCollectionAndState:stats.legacyByCollectionAndState,
  legacyReferences:(stats.refs.firestoreFallback||0)+(stats.refs.drive||0)+(stats.refs.firebaseStorage||0),
  status:'READ_ONLY_INVENTORY_NOT_MIGRATION_PARITY_CERTIFICATION',
  note:'Metadata-level inventory cannot establish original legacy Drive/Storage byte parity. No business docs, paths or credentials exported.'
 };
 writeFileSync('P2136-PROD-POINTER-SUMMARY.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:result.status,firestoreDocuments:documents,r2Objects:r2.size,legacyReferences:result.legacyReferences,legacyByState:stats.legacyByState,r2Matched:matched,r2Missing:missing,r2Mismatch:sizeMismatch+hashMismatch,missingByCollection,missingByState}));
 if(missing||sizeMismatch||hashMismatch||stats.invalidR2)process.exitCode=2;
}
