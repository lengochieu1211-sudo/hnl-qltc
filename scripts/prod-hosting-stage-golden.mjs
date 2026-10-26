/** P20.3: dependency-free, synthetic PROD Hosting leak prevention regression. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageProdHosting, verifyProdHosting } from './prod-hosting-stage.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hnl-prod-web-stage-'));
const dist = path.join(temp, 'dist');
const output = path.join(temp, 'dist-prod-hosting');
function write(rel, content) {
  const target = path.join(temp, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function blocked(code, fn) { assert.throws(fn, new RegExp('PROD_HOSTING_BLOCKED:' + code)); }
try {
  write('firebase.prod.json', JSON.stringify({ hosting: { site: 'hnlqltc', public: 'dist-prod-hosting' } }));
  write('package.json', JSON.stringify({ name: 'qlct-an-phu', version: '6.3.0' }));
  write('package-lock.json', JSON.stringify({ name: 'qlct-an-phu', version: '6.3.0' }));
  blocked('MISSING_VITE_INDEX', () => stageProdHosting(temp));
  write('dist/index.html', '<!doctype html><div id="root"></div><script src="/assets/a.js"></script>');
  write('dist/assets/a.js', 'window.x="com-example-qlct-61329|1:119152410850:web:c2aee2135428af34ef5ebb|hnl-qltc-r2-gateway.lengochieu1211.workers.dev|hnl-qltc-ai-gateway.lengochieu1211.workers.dev"');
  write('dist/manifest.json', '{}');
  write('dist/sw.js', 'self.addEventListener("fetch", ()=>{});');
  write('dist/server.cjs', 'PRIVATE_SERVER_SECRET');
  write('dist/server.cjs.map', 'PRIVATE_SOURCEMAP_SECRET');
  write('dist/.env.production', 'PRIVATE_ENV_SECRET');
  write('dist/credentials.json', 'PRIVATE_JSON_SECRET');
  write('dist/assets/a.js.map', 'PRIVATE_JS_SOURCEMAP');
  const stage = stageProdHosting(temp);
  assert.deepEqual(Object.keys(stage.files).sort(), ['assets/a.js', 'index.html', 'manifest.json', 'sw.js']);
  assert.equal(fs.existsSync(path.join(output, 'server.cjs')), false);
  assert.equal(fs.existsSync(path.join(output, 'credentials.json')), false);
  assert.equal(fs.existsSync(path.join(output, 'assets/a.js.map')), false);
  assert.equal(Object.keys(verifyProdHosting(temp).files).length, 4);
  write('dist-prod-hosting/assets/a.js', 'TAMPERED');
  blocked('STAGING_FILE_CHANGED', () => verifyProdHosting(temp));
  stageProdHosting(temp);
  write('dist-prod-hosting/server.cjs', 'LEAK');
  blocked('UNSAFE_STAGED_FILE', () => verifyProdHosting(temp));
  fs.rmSync(path.join(output, 'server.cjs'));
  fs.symlinkSync(path.join(temp, 'package.json'), path.join(output, 'evil.txt'));
  blocked('SYMLINK_FORBIDDEN', () => verifyProdHosting(temp));
  fs.rmSync(path.join(output, 'evil.txt'));
  const config = path.join(temp, 'firebase.prod.json');
  write('firebase.prod.json', JSON.stringify({ hosting: { site: 'wrong', public: 'dist-prod-hosting' } }));
  blocked('UNSAFE_HOSTING_CONFIG', () => stageProdHosting(temp));
  fs.writeFileSync(config, JSON.stringify({ hosting: { site: 'hnlqltc', public: 'dist-prod-hosting' } }));
  write('dist/assets/a.js', 'hnl-qltc-dev-backup com-example-qlct-61329 1:119152410850:web:c2aee2135428af34ef5ebb hnl-qltc-r2-gateway.lengochieu1211.workers.dev hnl-qltc-ai-gateway.lengochieu1211.workers.dev');
  blocked('BACKUP_PROJECT_IN_PROD_BUNDLE', () => stageProdHosting(temp));
  write('dist/assets/a.js', 'wrong Firebase project');
  blocked('PROD_BUNDLE_FINGERPRINT_MISMATCH', () => stageProdHosting(temp));
  console.log('PROD HOSTING STAGE GOLDEN PASS: fail-closed staging, tamper, symlink, secrets, project and app fingerprint');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
