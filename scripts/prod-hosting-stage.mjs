/**
 * PROD Hosting artifact quarantine. Never deploy the output of the combined
 * `npm run build` directly: dist also contains a Node server bundle.
 * This helper is local-only. The deployment remains guarded in Actions.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'com-example-qlct-61329';
const SITE = 'hnlqltc';
const APP_ID = '1:119152410850:web:c2aee2135428af34ef5ebb';
const R2 = 'hnl-qltc-r2-gateway.lengochieu1211.workers.dev';
const AI = 'hnl-qltc-ai-gateway.lengochieu1211.workers.dev';
const WEB_EXT = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.webmanifest', '.txt', '.wasm', '.mp3', '.mp4', '.pdf']);
const BAD_PATH = /(^|\/)(\.|node_modules(?:\/|$)|(?:server|firebase|package)(?:\.|\/|$)|[^/]*\.map$)|\.(?:cjs|mjs|ts|tsx|env|pem|key|p12|exe|apk|aab)$/i;
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const deny = (message) => { throw new Error('PROD_HOSTING_BLOCKED:' + message); };

function filesUnder(base) {
  const found = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isSymbolicLink()) deny('SYMLINK_FORBIDDEN:' + path.relative(base, absolute));
      if (item.isDirectory()) walk(absolute);
      else if (item.isFile()) found.push(path.relative(base, absolute).replaceAll('\\', '/'));
      else deny('UNKNOWN_FILE_TYPE');
    }
  }
  walk(base);
  return found.sort();
}

function allowed(rel) {
  if (BAD_PATH.test(rel)) return false;
  if (rel === 'manifest.json') return true;
  return WEB_EXT.has(path.posix.extname(rel).toLowerCase());
}

export function checkProdStageConfig(root = ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.prod.json'), 'utf8'));
  if (Object.keys(config).length !== 1 || config.hosting?.site !== SITE || config.hosting?.public !== 'dist-prod-hosting') deny('UNSAFE_HOSTING_CONFIG');
  const packageFile = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (packageFile.version !== lock.version || packageFile.name !== lock.name) deny('PACKAGE_LOCK_DRIFT');
  return { version: packageFile.version };
}

export function stageProdHosting(root = ROOT) {
  const { version } = checkProdStageConfig(root);
  const dist = path.join(root, 'dist');
  const dest = path.join(root, 'dist-prod-hosting');
  if (!fs.existsSync(path.join(dist, 'index.html'))) deny('MISSING_VITE_INDEX');
  const all = filesUnder(dist);
  const jsFiles = all.filter(p => p.startsWith('assets/') && p.endsWith('.js'));
  if (jsFiles.length === 0) deny('NO_WEB_BUNDLE');
  const js = Buffer.concat(jsFiles.map(p => fs.readFileSync(path.join(dist, p))));
  if (![PROJECT, APP_ID, R2, AI].every(marker => js.includes(marker))) deny('PROD_BUNDLE_FINGERPRINT_MISMATCH');
  if (js.includes('hnl-qltc-dev-backup')) deny('BACKUP_PROJECT_IN_PROD_BUNDLE');
  if (js.includes('hnl-qltc-ai-gateway-dev.lengochieu1211.workers.dev')) deny('DEV_AI_GATEWAY_IN_PROD_BUNDLE');
  if (!all.includes('manifest.json') || !all.includes('sw.js')) deny('PWA_FILES_MISSING');
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const entries = {};
  for (const rel of all) {
    if (!allowed(rel)) continue;
    const source = path.join(dist, rel);
    const output = path.join(dest, rel);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(source, output);
    entries[rel] = digest(fs.readFileSync(output));
  }
  if (!entries['index.html'] || !entries['sw.js'] || !entries['manifest.json']) deny('REQUIRED_WEB_ASSET_MISSING');
  const manifest = { kind: 'HNL_QLTC_PROD_HOSTING_ASSET_MANIFEST', projectId: PROJECT, site: SITE, version, files: entries };
  fs.writeFileSync(path.join(dest, 'hnl-prod-asset-checksums.json'), JSON.stringify(manifest, null, 2) + '\n');
  verifyProdHosting(root);
  return manifest;
}

export function verifyProdHosting(root = ROOT) {
  const { version } = checkProdStageConfig(root);
  const dest = path.join(root, 'dist-prod-hosting');
  const manifestPath = path.join(dest, 'hnl-prod-asset-checksums.json');
  if (!fs.existsSync(manifestPath)) deny('STAGING_MANIFEST_MISSING');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.kind !== 'HNL_QLTC_PROD_HOSTING_ASSET_MANIFEST' || manifest.projectId !== PROJECT || manifest.site !== SITE || manifest.version !== version) deny('WRONG_STAGED_PROJECT');
  const stagedFiles = filesUnder(dest).filter(name => name !== 'hnl-prod-asset-checksums.json');
  for (const rel of stagedFiles) {
    if (!allowed(rel)) deny('UNSAFE_STAGED_FILE:' + rel);
  }
  if (stagedFiles.length !== Object.keys(manifest.files).length) deny('STAGING_FILE_COUNT_CHANGED');
  for (const rel of stagedFiles) {
    if (digest(fs.readFileSync(path.join(dest, rel))) !== manifest.files[rel]) deny('STAGING_FILE_CHANGED:' + rel);
  }
  if (!stagedFiles.includes('index.html') || !stagedFiles.includes('sw.js') || !stagedFiles.includes('manifest.json')) deny('REQUIRED_WEB_ASSET_MISSING');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === 'stage') console.log('STAGED_PROD_WEB_FILES', Object.keys(stageProdHosting().files).length);
    else if (command === 'verify') console.log('VERIFIED_PROD_WEB_FILES', Object.keys(verifyProdHosting().files).length);
    else deny('USE_STAGE_OR_VERIFY');
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
