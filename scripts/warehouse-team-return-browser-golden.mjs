import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const port = await new Promise((resolve, reject) => {
  const listen = net.createServer();
  listen.once('error', reject);
  listen.listen(0, '127.0.0.1', () => { const assigned = listen.address().port; listen.close(() => resolve(assigned)); });
});
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    VITE_APP_ENV: 'DEV', VITE_RUNTIME_BACKEND: 'firebase-only', VITE_USE_FIREBASE_EMULATORS: 'true',
    VITE_FIREBASE_EMULATOR_PROJECT_ID: 'demo-hnl-voucher-return' } });
let logs = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', data => logs += String(data));
const results = [];
let browserInstance;
try {
  const url = 'http://127.0.0.1:' + port + '/scripts/fixtures/warehouse-team-return/index.html';
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Vite did not start: ' + logs.slice(-1400));
  browserInstance = await chromium.launch({ headless: true });
  fs.mkdirSync('runtime-evidence', { recursive: true });
  for (const device of [{ width: 1280, height: 800, mobile: false }, { width: 393, height: 852, mobile: true }]) {
    const label = device.width + 'x' + device.height;
    const context = await browserInstance.newContext({ viewport: device, locale: 'vi-VN', isMobile: device.mobile, hasTouch: device.mobile });
    const page = await context.newPage();
    await page.goto(url + (device.mobile ? '?mobile=1' : ''), { waitUntil: 'domcontentloaded' });
    await page.locator('#crew-subtab-navigation').getByRole('button').last().click();
    const outerTeams = page.locator('#crew-subtab-navigation').getByRole('button').last();
    assert.equal(await outerTeams.getAttribute('aria-pressed'), 'true', label + ': source Team list not active');
    await page.locator('[data-hnl-team-statistics-action] button').first().click();
    const modal = page.locator('[data-hnl-crew-team-modal-body]');
    await modal.waitFor({ state: 'visible' });
    const tabs = page.locator('[data-hnl-pc-deep-tabs="crew-team-detail"]');
    await tabs.getByRole('button', { name: /Vật tư đối chiếu/ }).click();
    const details = page.locator('[data-hnl-team-material-voucher-details]').first();
    await details.locator('summary').click();
    assert.equal(await details.evaluate(element => element.open), true, label + ': original material voucher details not expanded');
    await page.locator('[data-hnl-team-material-voucher="RETURN-MAT-OUT-1"]').click();
    const backMaterial = page.locator('[data-hnl-voucher-return-origin="crew-statistics"]');
    await backMaterial.waitFor({ state: 'visible' });
    await backMaterial.getByRole('button', { name: /Quay lại Thống kê Căn\/Phòng & Defect/ }).click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await outerTeams.getAttribute('aria-pressed'), 'true', label + ': Back lost outer Teams tab');
    assert.equal(await tabs.getByRole('button', { name: /Vật tư đối chiếu/ }).getAttribute('aria-pressed'), 'true',
      label + ': Back lost material reconciliation tab');
    await details.waitFor({ state: 'visible' });
    assert.equal(await details.evaluate(element => element.open), true, label + ': Back collapsed material voucher list');
    await tabs.getByRole('button', { name: /Thiết bị đã cấp/ }).click();
    await page.locator('[data-hnl-team-equipment-voucher="RETURN-EQUIP-OUT-1"]').click();
    const backEquipment = page.locator('[data-hnl-voucher-return-origin="crew-statistics"]');
    await backEquipment.waitFor({ state: 'visible' });
    await backEquipment.getByRole('button', { name: /Quay lại Thống kê Căn\/Phòng & Defect/ }).click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await outerTeams.getAttribute('aria-pressed'), 'true', label + ': Back from equipment lost Teams list');
    assert.equal(await tabs.getByRole('button', { name: /Thiết bị đã cấp/ }).getAttribute('aria-pressed'), 'true',
      label + ': Back from equipment lost selected equipment tab');
    assert((await page.locator('[data-hnl-team-equipment-report="project-wide"]').innerText()).includes('Đội kiểm tra Quay lại'),
      label + ': returned to wrong team');
    const shot = 'runtime-evidence/team-voucher-return-' + label + '.png';
    await page.screenshot({ path: shot });
    results.push({ device: label, result: 'PASS', materialVoucher: 'RETURN-MAT-OUT-1', equipmentVoucher: 'RETURN-EQUIP-OUT-1', screenshot: shot });
    await context.close();
  }
  console.log('CREW MATERIAL/EQUIPMENT VOUCHER REAL BACK CLICK GOLDEN PASS', JSON.stringify(results));
} catch (error) {
  console.error(logs.slice(-2800));
  throw error;
} finally {
  fs.writeFileSync('runtime-evidence/team-voucher-return-report.json', JSON.stringify({ results, at: new Date().toISOString() }, null, 2));
  await browserInstance?.close();
  server.kill('SIGTERM');
}
