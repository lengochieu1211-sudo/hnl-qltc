#!/usr/bin/env node
/* Isolated fallback Hosting deployer. Deliberately never references .firebaserc. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDevTarget, managedTarget, parseDotEnv } from './dev-firebase-switch.mjs';

export const BACKUP_ID = 'hnl-qltc-dev-backup';
export const BACKUP_GATEWAY = 'https://hnl-qltc-r2-gateway-dev-backup.lengochieu1211.workers.dev';
export const BACKUP_OPERATOR = 'lengochieu1211@gmail.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_EXT = new Set(['.html','.js','.css','.json','.png','.jpg','.jpeg','.gif','.webp','.avif','.svg','.ico','.woff','.woff2','.ttf','.webmanifest','.txt','.wasm','.mp3','.mp4','.pdf']);
const NEVER_PUBLIC = /(^|\/)(?:\.|node_modules|server(?:\.|$)|firebase(?:\.|$)|package(?:\.|$)|.*\.map$)|\.(?:cjs|mjs|ts|tsx|env|pem|key|p12|exe|apk|aab)$/i;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const die = message => { throw new Error(`BACKUP_HOSTING_BLOCKED:${message}`); };
function allowedWebFile(rel) {
  // Vite emits the browser PDF.js worker as an ES module, not a server bundle.
  return /^assets\/pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs$/.test(rel)
    || (!NEVER_PUBLIC.test(rel) && WEB_EXT.has(path.extname(rel).toLowerCase()));
}

export function inspectBackupTarget(root = ROOT) {
  const localPath = path.join(root, '.env.local');
  const backPath = path.join(root, '.env.dev-backup.local');
  if (!fs.existsSync(localPath) || !fs.existsSync(backPath)) die('MANAGED_BACKUP_ENV_NOT_SELECTED');
  const local = fs.readFileSync(localPath,'utf8');
  if (managedTarget(local) !== 'backup') die('ACTIVE_TARGET_NOT_BACKUP');
  const backup = fs.readFileSync(backPath,'utf8');
  if (local !== '# HNL_QLTC_MANAGED_DEV_TARGET=backup\n'+backup.trimEnd()+'\n') die('ENV_FILES_DIVERGED');
  const verified = validateDevTarget(local, 'backup');
  if (verified.projectId !== BACKUP_ID) die('WRONG_PROJECT');
  const gateway = verified.values.get('VITE_R2_GATEWAY_URL') || '';
  if (gateway && gateway !== BACKUP_GATEWAY) die('MEDIA_GATEWAY_NOT_AUDITED_BACKUP_ENDPOINT');
  if (verified.values.get('VITE_FIREBASE_APP_ID') !== '1:87340841644:web:02c6f832427ddf30cf7d09') die('WEB_APP_ID_NOT_EXPECTED');
  if (verified.values.get('VITE_FIREBASE_MESSAGING_SENDER_ID') !== '87340841644') die('SENDER_ID_NOT_EXPECTED');
  for (const name of ['.env.production','.env.production.local']) {
    if (fs.existsSync(path.join(root,name))) die(`UNEXPECTED_ENV_FILE:${name}`);
  }
  const deploy = JSON.parse(fs.readFileSync(path.join(root,'firebase.dev-backup.json'),'utf8'));
  if (Object.keys(deploy).join(',') !== 'hosting' || deploy.hosting?.site !== BACKUP_ID || deploy.hosting?.public !== 'dist-dev-backup-hosting') die('DEPLOY_CONFIG_MUST_ONLY_TARGET_BACKUP_HOSTING');
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  if (lock.name !== pkg.name || lock.version !== pkg.version) die('PACKAGE_LOCK_MISMATCH');
  return { root, verified, envHash: sha(local), config: deploy, version: pkg.version };
}

function getFiles(base) {
  const output = [];
  function crawl(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const p=path.join(dir,entry.name);
      if (entry.isSymbolicLink()) die('SYMLINK_FORBIDDEN');
      if (entry.isDirectory()) crawl(p);
      else if (entry.isFile()) output.push(path.relative(base,p).replaceAll('\\','/'));
    }
  }
  crawl(base); return output.sort();
}

export function stageBackupHosting(root = ROOT) {
  const info = inspectBackupTarget(root);
  const dist = path.join(root,'dist');
  if (!fs.existsSync(path.join(dist,'index.html'))) die('VITE_BUILD_REQUIRED');
  const files=getFiles(dist);
  const js=files.filter(n=>n.endsWith('.js'));
  if (!js.length) die('NO_VITE_BUNDLE');
  const bundle=Buffer.concat(js.map(name=>fs.readFileSync(path.join(dist,name))));
  if (!bundle.includes('1:87340841644:web:02c6f832427ddf30cf7d09')) die('BUNDLE_LACKS_EXPECTED_BACKUP_APP_ID');
  if (!bundle.includes('hnl-qltc-dev-backup')) die('BUNDLE_LACKS_BACKUP_PROJECT');
  if (!bundle.includes('AIzaSyC3pD9OyZ8My4q2UVB_pJEcE5hT30EGGL0')) die('BUNDLE_LACKS_EXPECTED_BACKUP_API_KEY');
  const gateway = info.verified.values.get('VITE_R2_GATEWAY_URL') || '';
  if (gateway && !bundle.includes(gateway)) die('BUNDLE_LACKS_AUDITED_BACKUP_GATEWAY');
  if (!gateway && bundle.includes(BACKUP_GATEWAY)) die('BUNDLE_GATEWAY_ENV_MISMATCH');
  const dest = path.join(root,'dist-dev-backup-hosting');
  fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
  const manifest={kind:'HNL_QLTC_DEV_BACKUP_HOSTING',projectId:BACKUP_ID,appEnv:'DEV',version:info.version,mediaGateway:gateway || null,envSha256:info.envHash,files:{}};
  for (const rel of files) {
    if (!allowedWebFile(rel)) continue;
    const source=path.join(dist,rel); const target=path.join(dest,rel);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
    manifest.files[rel]=sha(fs.readFileSync(target));
  }
  if (!manifest.files['index.html']) die('INDEX_MISSING_IN_STAGING');
  fs.writeFileSync(path.join(dest,'hnl-dev-backup-release.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

export function verifyBackupHosting(root = ROOT) {
  const info=inspectBackupTarget(root);
  const dir=path.join(root,'dist-dev-backup-hosting');
  const file=path.join(dir,'hnl-dev-backup-release.json');
  if (!fs.existsSync(file)) die('STAGING_MANIFEST_MISSING');
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  if (m.projectId !== BACKUP_ID || m.appEnv !== 'DEV' || m.envSha256 !== info.envHash || m.version !== info.version || m.mediaGateway !== (info.verified.values.get('VITE_R2_GATEWAY_URL') || null)) die('STALE_OR_WRONG_STAGING');
  const actual=getFiles(dir).filter(f=>f!=='hnl-dev-backup-release.json');
  if (actual.length !== Object.keys(m.files).length) die('STAGING_FILE_SET_CHANGED');
  for (const name of actual) {
    if (!allowedWebFile(name)) die('UNSAFE_PUBLIC_FILE');
    if (sha(fs.readFileSync(path.join(dir,name))) !== m.files[name]) die('STAGING_CHECKSUM_MISMATCH:'+name);
  }
  return m;
}

// Firebase Hosting default sites are on-demand since October 15, 2026.
// Inspect before creating; never treat access-denied/auth failures as a missing site.
export function hostingSiteArgs(action) {
  if (action !== 'get' && action !== 'create') die('UNKNOWN_SITE_ACTION');
  return [`hosting:sites:${action}`, BACKUP_ID, '--project', BACKUP_ID, '--account', BACKUP_OPERATOR, '--non-interactive'];
}
export function classifyHostingSiteLookup(status, output) {
  if (status === 0) return 'existing';
  const value=String(output||'');
  if (/(?:403|PERMISSION_DENIED|permission denied|unauthorized|unauthenticated|not authorized|insufficient permissions)/i.test(value)) die('BACKUP_IAM_OR_LOGIN_NOT_VERIFIED');
  if (/(?:HTTP Error:\s*404|error[^\n]*\b404\b|\bNOT_FOUND\b)/i.test(value)) return 'missing';
  die('BACKUP_SITE_LOOKUP_UNVERIFIED');
}
export function provisionBackupHosting(root = ROOT) {
  inspectBackupTarget(root); // never trust .firebaserc or an unmanaged .env.local
  const check=spawnSync('firebase',hostingSiteArgs('get'),{cwd:root,encoding:'utf8',shell:false});
  if (check.error) die('FIREBASE_CLI_NOT_AVAILABLE');
  const outcome=classifyHostingSiteLookup(check.status,`${check.stdout||''}\n${check.stderr||''}`);
  if (outcome === 'existing') return {site:BACKUP_ID,status:'already_exists',changed:false};
  execute('firebase',hostingSiteArgs('create'),root,process.env);
  const verify=spawnSync('firebase',hostingSiteArgs('get'),{cwd:root,encoding:'utf8',shell:false});
  if (verify.error || verify.status !== 0) die('PROVISION_READBACK_FAILED');
  return {site:BACKUP_ID,status:'created_and_verified',changed:true};
}

function execute(cmd,args,cwd,env) {
  const r=spawnSync(cmd,args,{cwd,env,stdio:'inherit',shell:false});
  if (r.error) die(`COMMAND_NOT_AVAILABLE:${cmd}`);
  if (r.status!==0) die(`COMMAND_FAILED:${cmd}:${r.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd=process.argv[2]||'check';
  try {
    if(cmd==='check') {
      const s=inspectBackupTarget();
      console.log(JSON.stringify({projectId:s.verified.projectId,version:s.version,hosting:'not deployed',staged:fs.existsSync(path.join(ROOT,'dist-dev-backup-hosting','hnl-dev-backup-release.json')),note:'Explicit backup-only, no billing, no cloud functions/rules deploy'},null,2));
    } else if (cmd==='build') {
      const s=inspectBackupTarget();
      const env={...process.env};
      for(const key of Object.keys(env)) if(key.startsWith('VITE_')) delete env[key];
      Object.assign(env,Object.fromEntries(s.verified.values));
      execute('npm',['run','build'],ROOT,env);
      const m=stageBackupHosting();
      console.log('STAGED_FOR_BACKUP_ONLY',BACKUP_ID,'files',Object.keys(m.files).length);
    } else if(cmd==='stage') {
      const m=stageBackupHosting();console.log('STAGED_FOR_BACKUP_ONLY',BACKUP_ID,Object.keys(m.files).length);
    } else if(cmd==='provision-hosting') {
      if(!process.argv.includes('--confirm-backup-only')) die('EXPLICIT_CONFIRM_BACKUP_ONLY_REQUIRED');
      const result=provisionBackupHosting();
      console.log(JSON.stringify({...result,operator:BACKUP_OPERATOR,note:'Only Firebase Hosting site metadata on isolated backup project; no deployment or Firestore/Rules updates'},null,2));
    } else if(cmd==='deploy-hosting') {
      if(!process.argv.includes('--confirm-backup-only')) die('EXPLICIT_CONFIRM_BACKUP_ONLY_REQUIRED');
      const m=verifyBackupHosting();
      console.log('Deploy backup-only site:',m.projectId);
      execute('firebase',['deploy','--project',BACKUP_ID,'--account',BACKUP_OPERATOR,'--config','firebase.dev-backup.json','--only','hosting','--non-interactive'],ROOT,process.env);
    } else die('UNKNOWN_ACTION');
  } catch(e) {console.error(String(e?.message||e));process.exitCode=1;}
}
