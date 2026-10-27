// P21.14 local-only Wrangler Worker. Both bindings are DEV buckets (never PROD).
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json"}});
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b))).map(v=>v.toString(16).padStart(2,"0")).join("");
const canon=x=>JSON.stringify(Object.entries(x||{}).sort(([a],[b])=>a.localeCompare(b)));
export default { async fetch(request,env){
 try {
  const u=new URL(request.url);
  if(request.headers.get("x-hnl-dev-backup")!=="DEV-ONLY-P2114")return json({error:"FORBIDDEN"},403);
  if(u.pathname==="/health")return json({ok:true,environment:"PROD",source:"hnl-qltc-media",destination:"hnl-qltc-media-prod-backup"});
  if(u.pathname==="/manifest"&&request.method==="GET"){
   const cursor=u.searchParams.get("cursor")||undefined;
   const x=await env.PROD_SOURCE.list({limit:100,cursor});
   return json({objects:x.objects.map(o=>({key:o.key,size:o.size,etag:o.etag})),truncated:x.truncated,cursor:x.cursor||null});
  }
  if(u.pathname==="/copy"&&request.method==="POST"){
   const {key,etag,size,snapshot}=await request.json();
   if(typeof key!=="string"||!key||key.length>1024||/[\x00-\x1f]/.test(key)||!(/^[a-f0-9]{40}$/).test(snapshot)||!Number.isSafeInteger(size)||size<0||size>25000000||!etag)return json({error:"INVALID_REQUEST"},400);
   const destinationKey="snapshots/"+snapshot+"/"+key;
   const source=await env.PROD_SOURCE.get(key);
   if(!source||source.size!==size||source.etag!==etag)return json({error:"SOURCE_DRIFT",key},409);
   const bytes=await source.arrayBuffer();const sha256=await digest(bytes);
   const old=await env.PROD_BACKUP.head(destinationKey);
   if(old&&(old.size!==source.size||canon(old.customMetadata)!==canon(source.customMetadata)||canon(old.httpMetadata)!==canon(source.httpMetadata)))return json({error:"BACKUP_CONFLICT",key},409);
   if(!old)await env.PROD_BACKUP.put(destinationKey,bytes,{httpMetadata:source.httpMetadata,customMetadata:source.customMetadata});
   const verified=await env.PROD_BACKUP.get(destinationKey);
   if(!verified||verified.size!==source.size||canon(verified.customMetadata)!==canon(source.customMetadata)||canon(verified.httpMetadata)!==canon(source.httpMetadata))return json({error:"METADATA_PARITY_FAIL",key},409);
   const gotSha256=await digest(await verified.arrayBuffer());
   if(sha256!==gotSha256)return json({error:"BYTES_SHA256_MISMATCH",key},409);
   return json({ok:true,key,destinationKey,bytes:size,sha256,customMetadataKeys:Object.keys(source.customMetadata||{}).length});
  }
  return json({error:"UNKNOWN_ROUTE"},404);
 }catch(e){return json({error:"PROD_BACKUP_FAILED",message:String(e?.message||e)},500);}
}};
