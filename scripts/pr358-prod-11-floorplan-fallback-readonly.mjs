#!/usr/bin/env node
// Read-only PROD Firestore legacy FloorPlan binary integrity audit.
// Never exports image bytes, document IDs, path/keys, credentials, or private data.
import {createSign,createHash} from 'node:crypto';
import fs from 'node:fs';
const PROD='com-example-qlct-61329',EXPECTED=11;
if(process.env.GITHUB_REF!=='refs/heads/audit/pr358-prod-11-floorplan-fallback-20261030'||
   process.env.PR358_CANDIDATE!=='1d69495c939911a5b20c1046f356777adcdeb44c')throw Error('READ_ONLY_PIN_GUARD');
const sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||'{}');
if(sa.type!=='service_account'||sa.project_id!==PROD||!sa.private_key||!sa.client_email)throw Error('WRONG_PROJECT_SA');
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const now=Math.floor(Date.now()/1000),h=encode({alg:'RS256',typ:'JWT'}),b=encode({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3200});
const sign=createSign('RSA-SHA256');sign.update(h+'.'+b);sign.end();
const resp=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:h+'.'+b+'.'+sign.sign(sa.private_key).toString('base64url')}),signal:AbortSignal.timeout(30000)});
if(!resp.ok)throw Error('FIRESTORE_AUTH_FAILED_'+resp.status);
const token=(await resp.json()).access_token;if(!token)throw Error('TOKEN_MISSING');
const base='https://firestore.googleapis.com/v1/projects/'+PROD+'/databases/(default)/documents';
const esc=p=>p.split('/').map(encodeURIComponent).join('/');
let requests=0;
async function read(path,cursor=''){
 if(++requests>8000)throw Error('READ_REQUEST_CAP');
 const q=new URLSearchParams({pageSize:'200'});if(cursor)q.set('pageToken',cursor);
 for(let i=0;i<4;i++){
  const res=await fetch(base+'/'+esc(path)+'?'+q,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});
  if((res.status===429||res.status>=500)&&i<3){await new Promise(r=>setTimeout(r,1500*(i+1)));continue;}
  if(!res.ok)throw Error('FIRESTORE_READ_HTTP_'+res.status);
  return res.json();
 }
 throw Error('READ_RETRIES_EXCEEDED');
}
async function list(path){let token='',pages=0,items=[];do{let page=await read(path,token);items.push(...page.documents||[]);token=page.nextPageToken||'';if(++pages>40||items.length>8000)throw Error('PAGINATION_CAP')}while(token);return items}
const scalar=v=>v?.stringValue??v?.integerValue??v?.doubleValue??v?.booleanValue??null;
let seen=0,active=0,deleted=0,withChunks=0,empty=0,indexGaps=0,invalidChunks=0,invalidMagic=0,totalBytes=0,chunkCount=0,mismatchedSize=0;
const projects=await list('projects');if(!projects.length)throw Error('NO_PROJECTS');
for(const project of projects){
 const projectId=String(project.name||'').split('/').at(-1);if(!projectId)throw Error('BAD_PROJECT_DOC');
 const metas=await list('projects/'+projectId+'/floor_plan_images');
 for(const meta of metas){
  const f=meta.fields||{};
  const provider=String(scalar(f.storageProvider)||'').toLowerCase(),cloudId=String(scalar(f.cloudFileId)||'');
  if(provider!=='firestore-fallback'&&!cloudId.startsWith('firestore:'))continue;
  seen++;
  if(scalar(f.deleted)===true||f.deletedAt&&scalar(f.deletedAt)){deleted++;continue;}
  active++;
  const floorId=String(meta.name||'').split('/').at(-1);
  const chunks=await list('projects/'+projectId+'/floor_plan_images/'+floorId+'/chunks');
  if(!chunks.length){empty++;continue}
  let ordered=[],valid=true;
  for(const c of chunks){
   const cf=c.fields||{};
   const index=Number(scalar(cf.index));
   const raw=cf.data?.bytesValue;
   if(!Number.isInteger(index)||index<0||typeof raw!=='string'){valid=false;continue}
   const binary=Buffer.from(raw,'base64');
   if(!binary.length||binary.length>1150000){valid=false;continue}
   ordered.push({index,binary});
  }
  if(!valid||ordered.length!==chunks.length){invalidChunks++;continue}
  ordered.sort((a,b)=>a.index-b.index);
  if(ordered.some((v,i)=>v.index!==i)){indexGaps++;continue}
  const bytes=Buffer.concat(ordered.map(x=>x.binary));
  if(bytes.length<12){invalidMagic++;continue}
  const jpeg=bytes[0]===255&&bytes[1]===216;
  const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  const gif=bytes.toString('ascii',0,3)==='GIF';
  const bmp=bytes.toString('ascii',0,2)==='BM';
  if(!jpeg&&!png&&!webp&&!gif&&!bmp){invalidMagic++;continue}
  const stated=Number(scalar(f.sizeBytes)||scalar(f.imageFileSize)||scalar(f.fileSize)||0);
  if(stated>0&&stated!==bytes.length)mismatchedSize++;
  totalBytes+=bytes.length;chunkCount+=chunks.length;withChunks++;
  if(totalBytes>320000000||chunkCount>10000)throw Error('MAX_IMAGE_READ_CAP');
  // Hash each image privately; aggregate output deliberately exposes no image-specific identity.
  const hashed=createHash('sha256').update(bytes).digest('hex');
  if(hashed.length!==64)throw Error('HASH_FAILURE');
 }
}
const evidence={format:'HNL-PR358-PROD-FLOORPLAN-FIRESTORE-FALLBACK-READONLY-V1',sourceSha:process.env.PR358_CANDIDATE,firestoreProject:PROD,utc:new Date().toISOString(),projectsScanned:projects.length,legacyFallbackFound:seen,legacyFallbackActive:active,legacyFallbackDeleted:deleted,activeWithReconstructibleImage:withChunks,emptyFallback:empty,badChunkData:invalidChunks,brokenChunkIndex:indexGaps,unknownImageSignature:invalidMagic,mismatchedMetaSize:mismatchedSize,totalImageBytes:totalBytes,totalChunks:chunkCount,readRequests:requests,firestoreSourceReadOnly:true,prodDataWrites:0,restoreEncryptedBackupVerified:false,runtimeAuthenticatedDisplayVerified:false,certified:false};
fs.writeFileSync('PR358-PROD-FLOORPLAN-FALLBACK-AGGREGATE.json',JSON.stringify(evidence,null,2));
console.log('FLOORPLAN FALLBACK AGGREGATE',JSON.stringify(evidence));
if(active!==EXPECTED||empty||invalidChunks||indexGaps||invalidMagic||mismatchedSize||active!==withChunks)process.exitCode=2;
