import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const address = 'http://127.0.0.1:' + port + '/scripts/fixtures/warehouse-catalog/index.html';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VITE_APP_ENV: 'DEV',
    VITE_RUNTIME_BACKEND: 'firebase-only', VITE_USE_FIREBASE_EMULATORS: 'true',
    VITE_FIREBASE_EMULATOR_PROJECT_ID: 'demo-hnl-qltc-dev' } });
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', value => serverLog += String(value));
const results = [], errors = [];
fs.mkdirSync('runtime-evidence', { recursive: true });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(address)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Norm layout fixture not ready: ' + serverLog.slice(-1000));
  browser = await chromium.launch({ headless: true });
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 393, height: 852 }]) {
    const tag = size.width + 'x' + size.height;
    const ctx = await browser.newContext({ viewport: size, locale: 'vi-VN', isMobile: size.width < 500, hasTouch: size.width < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(tag + ': ' + error.message));
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-hnl-open-norm-fixture]').click();
    await page.getByRole('button', { name: /Thêm định mức.*chọn cách thêm/ }).click();
    await page.getByRole('button', { name: 'Tạo định mức mới' }).click();
    const editor = page.locator('[data-hnl-norm-editor]');
    await editor.waitFor({ state: 'visible' });
    for (const mode of ['add', 'edit']) {
      const metrics = await editor.evaluate(form => {
        const b = form.getBoundingClientRect();
        const dlg = form.parentElement.getBoundingClientRect();
        const grid = form.querySelector('.lg\\:grid-cols-2');
        const columns = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length : 0;
        const docWidth = document.documentElement.scrollWidth;
        return { x: b.x, width: b.width, dlgWidth: dlg.width, columns, docWidth, viewport: window.innerWidth, height: b.height };
      });
      assert(metrics.x >= -1 && metrics.x + metrics.width <= size.width + 2, tag + ' ' + mode + ': form overflows viewport');
      assert(metrics.docWidth <= size.width + 12, tag + ' ' + mode + ': document overflows horizontally');
      assert(metrics.height > 100, tag + ' ' + mode + ': form collapsed');
      if (size.width >= 1024) {
        assert(metrics.width > 800 && metrics.width > metrics.dlgWidth * 0.83, tag + ' ' + mode + ': PC form is still narrow');
        assert.equal(metrics.columns, 2, tag + ' ' + mode + ': core fields not in two columns');
      } else {
        assert.equal(metrics.columns, 1, tag + ' ' + mode + ': mobile form must remain single-column');
      }
      if (mode === 'add') {
        await editor.getByRole('button', { name: 'Lưu & thêm tiếp' }).waitFor({ state: 'visible' });
        await editor.getByRole('button', { name: 'Lưu & đóng' }).waitFor({ state: 'visible' });
      } else {
        await editor.getByRole('button', { name: 'Lưu thay đổi' }).waitFor({ state: 'visible' });
      }
      await page.screenshot({ path: 'runtime-evidence/norm-layout-' + mode + '-' + tag + '.png' });
      results.push({ tag, mode, ...metrics, status: 'PASS' });
      if (mode === 'add') {
        await editor.getByRole('button', { name: 'Quay lại' }).click();
        await page.locator('button[title="Sửa định mức"]').first().click();
        await editor.waitFor({ state: 'visible' });
      }
    }
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'React error during responsive tests');
  console.log('MATERIAL NORM ADD/EDIT PC + MOBILE GOLDEN PASS ' + JSON.stringify(results));
} catch (error) {
  console.error('Material norm browser golden failed; Vite tail:', serverLog.slice(-1000));
  throw error;
} finally {
  fs.writeFileSync('runtime-evidence/norm-layout-report.json', JSON.stringify({ results, errors, at: new Date().toISOString() }, null, 2));
  await browser?.close();
  server.kill('SIGTERM');
}
