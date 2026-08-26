import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (m) => { console.error(`SOURCE LINT FAIL: ${m}`); process.exitCode = 1; };
const pass = (m) => console.log(`PASS: ${m}`);

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) fail('package.json/package-lock.json version mismatch');
else pass(`package/lock version ${pkg.version}`);

const textExt = new Set(['.ts','.tsx','.js','.mjs','.cjs','.json','.yml','.yaml','.md','.html','.xml','.rules','.ps1','.cs','.gs']);
const ignored = new Set(['node_modules','dist','.git']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExt.has(path.extname(entry.name)) || entry.name.endsWith('.rules')) files.push(full);
  }
}
walk(root);

let mergeMarkers = 0;
let privateKeys = 0;
let githubTokens = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) { console.error('merge marker:', path.relative(root, file)); mergeMarkers++; }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) { console.error('private key:', path.relative(root, file)); privateKeys++; }
  if (/(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/.test(text)) { console.error('GitHub token:', path.relative(root, file)); githubTokens++; }
}
if (mergeMarkers) fail(`${mergeMarkers} unresolved merge-marker file(s)`); else pass('no merge markers');
if (privateKeys || githubTokens) fail('high-risk secret material found'); else pass('no private keys/GitHub tokens');

const runtime = read('src/config/runtimeArchitecture.ts');
if (!runtime.includes("VITE_ENABLE_LEGACY_DRIVE_WRITE || 'false'") || !runtime.includes("VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE || 'false'")) fail('legacy write defaults are not fail-closed');
else pass('legacy runtime write defaults off');

const security = read('src/utils/securityUtils.ts');
if (!security.includes("if (FIREBASE_ONLY_RUNTIME) return 'VIEWER'")) fail('global localStorage role can still authorize Firebase-only UI');
if (!security.includes('if (FIREBASE_ONLY_RUNTIME || !projectId) return')) fail('local project member database can still be written in Firebase-only runtime');
else pass('legacy role/member caches cannot grant Firebase-only access');

const app = read('src/App.tsx');
for (const marker of [
  'loadProjectFromFirestoreCache(projectId)',
  'if (!isProjectRoleResolved)',
  'if (!FIREBASE_ONLY_RUNTIME || LEGACY_LOCAL_BUSINESS_CACHE_WRITE_ENABLED)',
  "Google Drive runtime đã tắt trong Firebase-only",
]) if (!app.includes(marker)) fail(`App Firebase-only guard missing: ${marker}`);
pass('App cache/role/legacy-write guards present');

if (!read('.github/workflows/firebase-hosting-merge.yml').includes('workflow_dispatch:') || !read('.github/workflows/firebase-hosting-merge.yml').includes('DEPLOY-PROD')) fail('PROD deploy is not manual-gated');
else pass('PROD deploy manual confirmation gate');

if (process.exitCode) process.exit(process.exitCode);
console.log('SOURCE LINT PASS');
