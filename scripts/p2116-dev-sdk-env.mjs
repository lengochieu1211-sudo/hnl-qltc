import fs from 'node:fs';
const p=process.env.RUNNER_TEMP+'/p2116-dev-sdk.json';
const raw=JSON.parse(fs.readFileSync(p,'utf8'));
const fields=['apiKey','appId','projectId','authDomain','storageBucket','messagingSenderId'];
const cfg={};
function visit(v){
 if(v===null||v===undefined)return;
 if(Array.isArray(v)){for(const e of v)visit(e);return}
 if(typeof v==='string'){
   try{visit(JSON.parse(v))}catch{}
   for(const k of fields){const m=v.match(new RegExp(k+'\\s*:\\s*["\\x27]([^"\\x27]+)["\\x27]'));if(m&&!cfg[k])cfg[k]=m[1]}
   return;
 }
 if(typeof v==='object')for(const [k,x] of Object.entries(v)){if(fields.includes(k)&&typeof x==='string'&&x)cfg[k]=x;else visit(x)}
}
visit(raw);
if(!cfg.apiKey||!cfg.appId||!cfg.messagingSenderId||cfg.projectId&&cfg.projectId!=='hnl-qltc-dev')throw new Error('DEV Firebase SDK missing fields or wrong project');
cfg.projectId='hnl-qltc-dev';cfg.authDomain='hnl-qltc-dev.web.app';
cfg.storageBucket=cfg.storageBucket||'hnl-qltc-dev.firebasestorage.app';
const mapping={apiKey:'API_KEY',appId:'APP_ID',messagingSenderId:'MESSAGING_SENDER_ID',projectId:'PROJECT_ID',authDomain:'AUTH_DOMAIN',storageBucket:'STORAGE_BUCKET'};
fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(mapping).map(([k,n])=>'VITE_FIREBASE_'+n+'='+cfg[k]).join('\n')+'\n');
console.log('P21.16 existing DEV Firebase Web SDK resolved without creating/modifying any app');
