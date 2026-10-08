import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const DEV='hnl-qltc-dev',BASE='7575076f21d44a4fab31422011659f1465ea6b5a';
const IDS=['proj_1786411472502','proj_1786458217020'];
const ROOT='projects/'+DEV+'/databases/(default)/documents';
const assert=(x,s)=>{if(!x)throw Error(s)};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const publicKey='-----BEGIN PUBLIC KEY-----\n'+"MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAzGqnxRaXgly6qG3ZdnbKSIWTZlV6JhH+hP6twezOKaWJLDTq7PVWhfadwh2RA2EKoLXoc8e4pWUrzo2qNmlLQBFKtuT3qkp9Sin7bpX+hLFSDDer+pcvOe8e49sAMiHM4I0eNxd3CmJVOiC8rszUZlADmyBPfqhl3svb9aqALyaIRJ2n4W3YhWYQpQO2sLOx/3BhJDaKtd8dTuZal3IGs106OGdu2SbVtkW+hLaoPj4gyofewLSw1zT2pvHwGM3CAWpmvvYTVegy2dU7ekFvGrBAtXo4rKaU4JUMUAMoa9joQCbvUjVuNm/62KhFFHOh/hwtUxDzlzejbtGBb9q40+VawRMhea9pTNcLi0ecSgLvCaFM9fTdiR0oCTZR5UOXHM5AE5GpTAbYs+3ix6iyG4AdEkeOGyDpT7ChfBXqSFgOfepWqS8S7bv6SxYuWZ/2CusKXAZ/7JS6s8pOgf9uSHxRfLfHnIykceV5Qaa5eysRuBiOZrtijWLmrgSz5L87AgMBAAE=".match(/.{1,64}/g).join('\n')+'\n-----END PUBLIC KEY-----';
const encode=s=>s.split('/').map(encodeURIComponent).join('/');
async function run(){
 assert(process.env.GITHUB_REF_NAME==='audit/hnl-dev-restore-readonly-7575076f-20261008','Wrong branch');
 assert(process.env.HNL_EXPECTED_DEV_HEAD===BASE,'Wrong DEV HEAD');
 const cred=process.env.FIREBASE_SERVICE_ACCOUNT||'';
 assert(cred.length>300,'Missing DEV credential');
 const sa=JSON.parse(cred);
 assert(sa.project_id===DEV&&sa.project_id!=='com-example-qlct-61329','Credential not DEV');
 const now=Math.floor(Date.now()/1000);
 const unsigned=[{alg:'RS256',typ:'JWT'},{iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3200}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const signed=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),sa.private_key).toString('base64url');
 const grant=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed});
 const tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:grant});
 assert(tr.ok,'OAuth HTTP '+tr.status);
 const access=(await tr.json()).access_token;assert(access,'No token');
 const api=async(p,post)=>{
  const r=await fetch('https://firestore.googleapis.com/v1/'+ROOT+'/'+p,{method:post?'POST':'GET',headers:{Authorization:'Bearer '+access,...(post?{'Content-Type':'application/json'}:{})},body:post?JSON.stringify(post):undefined});
  if(!post&&r.status===404)return null;
  assert(r.ok,'Firestore read API HTTP '+r.status);
  return r.json();
 };
 const valid=(name,id)=>{const prefix=ROOT+'/projects/'+id;assert(name===prefix||name.startsWith(prefix+'/'),'Bad resource path');return name.slice(ROOT.length+1);};
 let total=0,bytes=0;
 const columns=async(parent)=>{
  const all=[];let next='';
  do{
    const r=await api(encode(parent)+':listCollectionIds',{pageSize:100,...(next?{pageToken:next}:{})});
    all.push(...(r.collectionIds||[]));next=r.nextPageToken||'';
    assert(all.length<1000,'Too many columns');
  }while(next);
  return [...new Set(all)].sort();
 };
 const documents=async(parent,column,id)=>{
  const all=[];let next='';
  do{
    const q=new URLSearchParams({pageSize:'100',...(next?{pageToken:next}:{})});
    const r=await api(encode(parent+'/'+column)+'?'+q.toString());
    for(const doc of r?.documents||[]){
      valid(doc.name,id);all.push(doc);total++;bytes+=Buffer.byteLength(JSON.stringify(doc));
      assert(total<=5000&&bytes<80000000,'Export too large: fail closed, no partial artifact');
    }
    next=r?.nextPageToken||'';
  }while(next);
  return all;
 };
 const snaps=[],summaries=[];
 for(const id of IDS){
  const p='projects/'+id,root=await api(encode(p));
  const rows=[],queue=[p];let traversed=0;
  while(queue.length){
    // Read-only bounded breadth-first scan: at most six parent documents concurrently.
    const parents=queue.splice(0,6);
    assert((traversed+=parents.length)<6000,'Depth cap');
    const batches=await Promise.all(parents.map(async parent=>{
      const groups=[];
      for(const column of await columns(parent)){
        assert(!column.includes('/'),'Bad collection');
        const docs=await documents(parent,column,id);
        groups.push({parent,collection:column,documents:docs});
      }
      return groups;
    }));
    for(const groups of batches)for(const group of groups){
      rows.push(group);
      for(const doc of group.documents)queue.push(valid(doc.name,id));
    }
  }
  const counts={};for(const row of rows)counts[row.collection]=(counts[row.collection]||0)+row.documents.length;
  snaps.push({id,root,rows});
  summaries.push({projectId:id,rootPresent:!!root,documents:rows.reduce((v,row)=>v+row.documents.length,0),collections:counts});
 }
 const raw=Buffer.from(JSON.stringify({type:'HNL-DEV-FIRESTORE-REST',devProject:DEV,devHead:BASE,at:new Date().toISOString(),snaps}));
 assert(raw.length<80000000,'Raw too large');
 const gz=zlib.gzipSync(raw,{level:9}),key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const c=crypto.createCipheriv('aes-256-gcm',key,iv);
 const cipher=Buffer.concat([c.update(gz),c.final()]),tag=c.getAuthTag();
 const wrapped=crypto.publicEncrypt({key:publicKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
 const d=crypto.createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);
 assert(Buffer.concat([d.update(cipher),d.final()]).equals(gz),'Encryption roundtrip failed');key.fill(0);
 fs.mkdirSync('readonly-evidence',{recursive:true});
 const envelope={type:'HNL-DEV-AES256-GCM-RSA-OAEP',version:1,iv:iv.toString('base64'),tag:tag.toString('base64'),wrappedKey:wrapped.toString('base64'),ciphertext:cipher.toString('base64'),gzSha256:sha(gz)};
 fs.writeFileSync('readonly-evidence/DEV-DATA-ENCRYPTED.json.enc',JSON.stringify(envelope),{mode:0o600});
 fs.writeFileSync('readonly-evidence/DEV-SAFE-SUMMARY.json',JSON.stringify({DEV,BASE,readOnly:true,encrypted:true,collections:summaries,rawBytes:raw.length,remoteR2BinariesIncluded:false},null,2));
 console.log('READ-ONLY DEV PREFLIGHT PASS '+JSON.stringify(summaries));
}
run().catch(e=>{console.error('READ-ONLY BLOCKED '+String(e.message||e).slice(0,180));process.exitCode=1;});