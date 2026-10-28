import fs from 'node:fs';
import assert from 'node:assert/strict';
const mode=process.argv[2];
const file=process.argv[3];
assert(['appid','sdk'].includes(mode));
assert(file&&fs.existsSync(file));
const data=JSON.parse(fs.readFileSync(file,'utf8'));
if(mode==='appid'){
 const a=Array.isArray(data?.result)?data.result:Array.isArray(data)?data:[];
 const web=a.find(x=>x.platform==='WEB'||String(x.appId||'').includes(':web:'));
 assert(web?.appId,'Existing DEV WebApp needed. Refuse creating/changing Firebase app.');
 console.log(web.appId);
}else{
 const keys=['apiKey','appId','messagingSenderId','projectId','storageBucket','authDomain'];
 const result={};
 function walk(x){
  if(!x)return;
  if(typeof x==='string'){
   try{walk(JSON.parse(x))}catch{}
   for(const k of keys){
    const re=new RegExp(k+'\\s*:\\s*["\\x27]([^"\\x27]+)["\\x27]');
    const match=x.match(re);if(match&&!result[k])result[k]=match[1];
   }
  }else if(Array.isArray(x))x.forEach(walk);
  else if(typeof x==='object'){
   for(const k of keys)if(typeof x[k]==='string'&&!result[k])result[k]=x[k];
   for(const v of Object.values(x))walk(v);
  }
 }
 walk(data);
 assert.equal(result.projectId,'hnl-qltc-dev','Never build with PROD Firebase project');
 assert(result.apiKey&&result.appId&&result.messagingSenderId,'DEV WebApp SDK fields required');
 result.authDomain='hnl-qltc-dev.web.app';
 result.storageBucket=result.storageBucket||'hnl-qltc-dev.firebasestorage.app';
 assert(process.env.GITHUB_ENV,'CI env path required');
 for(const k of keys){const v=result[k];if(v)fs.appendFileSync(process.env.GITHUB_ENV,'VITE_FIREBASE_'+k.replace(/([A-Z])/g,'_$1').toUpperCase()+'='+v+'\n');}
 console.log('DEV Firebase WebApp configuration pinned to hnl-qltc-dev; no credential included.');
}
