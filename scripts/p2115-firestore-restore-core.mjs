import {createDecipheriv,createHash,privateDecrypt,constants} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
export function assertIsolatedEmulator({host,targetProject}){
 if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(host||'')))throw Error('RESTORE_EMULATOR_HOST_REQUIRED');
 if(targetProject!=='hnl-qltc-restore-isolated')throw Error('RESTORE_TARGET_NOT_ISOLATED');
}
export function decryptSnapshot({encrypted,manifest,privateKeyPem}){
 if(manifest?.format!=='HNL-QLTC-P2115-FIRESTORE-V1')throw Error('RESTORE_MANIFEST_FORMAT');
 if(!['hnl-qltc-dev','com-example-qlct-61329'].includes(manifest.project))throw Error('RESTORE_SOURCE_PROJECT');
 if(sha256(encrypted)!==manifest.encryptedSha256||encrypted.length!==manifest.encryptedBytes)throw Error('RESTORE_ENCRYPTED_INTEGRITY');
 const key=privateDecrypt({key:privateKeyPem,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(manifest.wrappedKeyBase64,'base64'));
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(manifest.ivBase64,'base64'));decipher.setAuthTag(Buffer.from(manifest.tagBase64,'base64'));
  const plain=gunzipSync(Buffer.concat([decipher.update(encrypted),decipher.final()]));
  if(plain.length!==manifest.plaintextBytes||sha256(plain)!==manifest.plaintextSha256)throw Error('RESTORE_PLAINTEXT_INTEGRITY');
  const prefix='projects/'+manifest.project+'/databases/(default)/documents/';
  const documents=plain.toString('utf8').split('\n').filter(Boolean).map(line=>{const document=JSON.parse(line)?.document;
   if(!document?.name?.startsWith(prefix)||(!document.createTime&&!document.updateTime))throw Error('RESTORE_INVALID_DOCUMENT');
   const path=document.name.slice(prefix.length);if(!path||path.split('/').length%2!==0)throw Error('RESTORE_INVALID_PATH');
   return {path,fields:document.fields||{}};});
  if(documents.length!==manifest.documents)throw Error('RESTORE_DOCUMENT_COUNT');
  if(new Set(documents.map(x=>x.path)).size!==documents.length)throw Error('RESTORE_DUPLICATE_PATH');
  return documents;
 }finally{key.fill(0);}
}
export function inventory(documents){const rows=[...documents].sort((a,b)=>a.path.localeCompare(b.path)).map(x=>({path:x.path,fields:x.fields||{}}));return {documents:rows.length,sha256:sha256(Buffer.from(stable(rows)))};}
export async function restoreToEmptyEmulator({host,targetProject,documents,fetchImpl=fetch}){
 assertIsolatedEmulator({host,targetProject});const base='http://'+host+'/v1/projects/'+targetProject+'/databases/(default)/documents';
 // Firestore REST listCollectionIds is admin-only, even on the emulator. The
 // emulator-local owner token is never sent anywhere except loopback.
 const emulatorHeaders={'content-type':'application/json',authorization:'Bearer owner'};
 const collections=await fetchImpl(base+':listCollectionIds',{method:'POST',headers:emulatorHeaders,body:'{"pageSize":1}'});
 if(!collections.ok)throw Error('RESTORE_EMULATOR_PREFLIGHT_'+collections.status);
 if(((await collections.json()).collectionIds||[]).length)throw Error('RESTORE_TARGET_NOT_EMPTY');
 for(const item of documents){const url=base+'/'+item.path.split('/').map(encodeURIComponent).join('/');const response=await fetchImpl(url,{method:'PATCH',headers:emulatorHeaders,body:JSON.stringify({fields:item.fields})});if(!response.ok)throw Error('RESTORE_WRITE_FAILED_'+response.status);}
 const restored=[];for(const item of documents){const url=base+'/'+item.path.split('/').map(encodeURIComponent).join('/');const response=await fetchImpl(url,{headers:emulatorHeaders});if(!response.ok)throw Error('RESTORE_READBACK_FAILED_'+response.status);const document=await response.json();restored.push({path:item.path,fields:document.fields||{}});}
 const source=inventory(documents),readback=inventory(restored);if(source.documents!==readback.documents||source.sha256!==readback.sha256)throw Error('RESTORE_PARITY_FAILED');return readback;
}
