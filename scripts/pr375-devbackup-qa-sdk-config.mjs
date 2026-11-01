import fs from 'node:fs';
const sdkFile=process.argv[2];
if(!sdkFile||!fs.existsSync(sdkFile))throw Error('Missing DEV Backup SDK config');
const j=JSON.parse(fs.readFileSync(sdkFile,'utf8'));
const keys=['apiKey','appId','messagingSenderId','projectId','authDomain','storageBucket'];
const found={};
const scan=x=>{
 if(x==null)return;
 if(typeof x==='string'){
  try{const p=JSON.parse(x);if(p!==x)scan(p);}catch{}
  for(const k of keys){
   const m=x.match(new RegExp(k+'\\s*:\\s*["\\x27]([^"\\x27]+)["\\x27]'));
   if(m&&!found[k])found[k]=m[1];
  }
 }else if(Array.isArray(x))x.forEach(scan);
 else if(typeof x==='object')for(const [k,v] of Object.entries(x)){
  if(keys.includes(k)&&typeof v==='string'&&!found[k])found[k]=v;
  scan(v);
 }
};
scan(j);
if(found.projectId!=='hnl-qltc-dev-backup'||!found.apiKey||!found.appId||!found.messagingSenderId)
 throw Error('DEV Backup SDK strict projectId and required settings check failed');
found.authDomain='hnl-qltc-dev-backup.web.app';
found.storageBucket ||= 'hnl-qltc-dev-backup.firebasestorage.app';
const values={
 VITE_FIREBASE_API_KEY:found.apiKey,
 VITE_FIREBASE_APP_ID:found.appId,
 VITE_FIREBASE_MESSAGING_SENDER_ID:found.messagingSenderId,
 VITE_FIREBASE_PROJECT_ID:found.projectId,
 VITE_FIREBASE_AUTH_DOMAIN:found.authDomain,
 VITE_FIREBASE_STORAGE_BUCKET:found.storageBucket,
};
if(!process.env.GITHUB_ENV)throw Error('Not GitHub Actions env');
fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n');
console.log('PASS strict DEV Backup SDK config; project='+found.projectId+'; no secret logged');
