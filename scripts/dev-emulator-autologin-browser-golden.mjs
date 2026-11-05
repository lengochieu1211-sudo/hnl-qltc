/** CI-only browser sign-in smoke for local HNL QLTC DEV Firebase Emulator. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const project = 'demo-hnl-qltc-dev';
const web = 'http://127.0.0.1:4178';
const authApi = `http://127.0.0.1:9099/emulator/v1/projects/${project}/accounts`;
assert.equal(process.env.DEV_AUTO_TEST_ENV, 'isolated-emulator');
assert.equal(process.env.VITE_APP_ENV, 'DEV');
assert.equal(process.env.VITE_USE_FIREBASE_EMULATORS, 'true');
assert.equal(process.env.VITE_FIREBASE_EMULATOR_PROJECT_ID, project);
assert.notEqual(process.env.VITE_FIREBASE_PROJECT_ID, 'com-example-qlct-61329');
const env = {
  ...process.env,
  VITE_RUNTIME_BACKEND: 'firebase-only',
  VITE_APP_ENV: 'DEV',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_EMULATOR_PROJECT_ID: project,
  VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
  VITE_BINARY_STORAGE_PROVIDER: 'firebase-storage',
  VITE_HNL_AI_ENABLED: 'false',
  VITE_ENABLE_LEGACY_DRIVE_WRITE: 'false',
  VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE: 'false',
};
for (const name of Object.keys(env)) {
  if (/^VITE_(R2_GATEWAY_URL|HNL_AI_GATEWAY_URL|FIREBASE_API_KEY|FIREBASE_AUTH_DOMAIN|FIREBASE_APP_ID|FIREBASE_STORAGE_BUCKET|FIREBASE_MESSAGING_SENDER_ID)$/.test(name)) delete env[name];
}
fs.mkdirSync('runtime-evidence/dev-emulator-auto-login', { recursive: true });
const evidence = 'runtime-evidence/dev-emulator-auto-login';
const report = { project, environment: 'ISOLATED_DEV_EMULATOR', results: [], forbiddenRequests: [] };
let server, browser, logs = '';
try {
  const probe = await fetch(authApi, { signal: AbortSignal.timeout(3000) });
  assert.equal(probe.status, 200, 'Auth Emulator is required');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4178', '--strictPort'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { logs += String(chunk); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(web, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Vite startup failed: ${logs.slice(-1600)}`);
  browser = await chromium.launch({ headless: true });
  for (const [role, viewport] of [
    ['ADMIN', { width: 1440, height: 900 }],
    ['EDITOR', { width: 1280, height: 800 }],
    ['VIEWER', { width: 393, height: 852 }],
  ]) {
    const context = await browser.newContext({ viewport, locale: 'vi-VN' });
    try {
      const page = await context.newPage();
      page.on('request', request => {
        if (/com-example-qlct-61329|hnlqltc\.web\.app|hnl-qltc-dev\.web\.app|hnl-qltc-r2-gateway\./i.test(request.url())) {
          report.forbiddenRequests.push({ role, url: request.url() });
        }
      });
      const response = await page.goto(web, { waitUntil: 'domcontentloaded', timeout: 30000 });
      assert.equal(response?.status(), 200);
      await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('[data-hnl-dev-emulator-auth="true"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('button[data-hnl-dev-test-role]').count(), 3);
      await page.locator(`button[data-hnl-dev-test-role="${role}"]`).click();
      await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({ state: 'hidden', timeout: 25000 });
      assert.equal(report.forbiddenRequests.length, 0, 'Live DEV or PROD network access blocked');
      await page.screenshot({ path: `${evidence}/${role.toLowerCase()}.png`, fullPage: true });
      report.results.push({ role, status: 'PASS', login: 'Firebase Auth Emulator' });
      console.log(`PASS AUTOLOGIN: ${role}`);
    } finally { await context.close(); }
  }
  const users = (await (await fetch(authApi)).json()).users || [];
  const ids = [];
  for (const role of ['admin', 'editor', 'viewer']) {
    const account = users.find(user => user.email === `${role}@hnl.test`);
    assert(account?.localId, `No ${role} Auth Emulator account`);
    ids.push(account.localId);
  }
  assert.equal(new Set(ids).size, 3, 'Separate UID per test account');
  assert.equal(report.forbiddenRequests.length, 0, 'Forbidden live traffic');
  report.status = 'PASS';
  console.log('PASS: 3 accounts without manual login, DEV emulator only');
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${evidence}/report.json`, JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) server.kill('SIGTERM');
}
