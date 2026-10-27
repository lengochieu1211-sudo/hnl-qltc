import {writeFileSync} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";
const endpoint=process.env.P2114_LOCAL_URL||"http://127.0.0.1:8789",snapshot=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(snapshot||""))throw Error("Exact SHA required");
const headers={"x-hnl-dev-backup":"PROD-SNAPSHOT-P2114"};
async function get(path,opts={}){
 for(let n=0;n<4;n++){try{
  const response=await fetch(endpoint+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(60000)});
  const body=await response.json();
  if(!response.ok||(opts.method==="POST"&&!body.ok))throw Error(response.status+" "+JSON.stringify(body).slice(0,300));
  return body;
 }catch(err){if(n===3)throw err;await sleep(900*(n+1));}}
}
async function enumerate(){
 let cursor="",pages=0;const output=[],seen=new Set();
 do {
  const p=await get("/manifest"+(cursor?"?cursor="+encodeURIComponent(cursor):""));
  if(!Array.isArray(p.objects))throw Error("Bad R2 manifest response");
  for(const o of p.objects){if(!o.key||seen.has(o.key))throw Error("Duplicate/empty source key");seen.add(o.key);output.push(o);}
  cursor=p.truncated?p.cursor:"";
  if(p.truncated&&!cursor)throw Error("Truncated list without cursor");
  if(++pages>40)throw Error("Unexpected R2 pagination");
 }while(cursor);
 return output.sort((a,b)=>a.key.localeCompare(b.key));
}
const a=await get("/health");
if(!a.ok||a.environment!=="PROD"||a.source!=="hnl-qltc-media"||a.destination!=="hnl-qltc-media-prod-backup")throw Error("Wrong environment");
const initial=await enumerate(),bytes=initial.reduce((v,o)=>v+Number(o.size||0),0);
if(initial.length<1||initial.length>5000)throw Error("Unexpected DEV bucket item count "+initial.length);
console.log("PROD R2 baseline "+initial.length+" objects / "+bytes+" bytes, SHA="+snapshot);
const results=[];
for(let i=0;i<initial.length;i++){
 const src=initial[i],done=await get("/copy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...src,snapshot})});
 if(done.key!==src.key||done.bytes!==src.size||!(/^[a-f0-9]{64}$/).test(done.sha256))throw Error("Source/backup verification mismatch");
 results.push(done);
 if((i+1)%50===0)console.log("Copy + SHA256 & metadata verify: "+(i+1)+"/"+initial.length);
}
const final=await enumerate();
if(JSON.stringify(initial)!==JSON.stringify(final))throw Error("Source R2 changed during copy; not a consistent snapshot");
if(results.reduce((v,o)=>v+o.bytes,0)!==bytes)throw Error("Byte sum mismatch");
const report={status:"PROD_R2_BACKUP_SHA256_AND_METADATA_PASS",snapshotSha:snapshot,sourceBucket:a.source,backupBucket:a.destination,objects:initial.length,totalBytes:bytes,results};
writeFileSync("P2114-DEV-R2-BACKUP-VERIFIED-MANIFEST.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,objects:report.objects,totalBytes:report.totalBytes,snapshotSha:snapshot}));
