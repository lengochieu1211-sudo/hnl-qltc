import fs from 'node:fs';
import { chromium } from 'playwright';

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

const hostingUrl = required('DEV_HOSTING_URL').replace(/\/$/, '');
const prodProjectId = required('PROD_FIREBASE_PROJECT_ID');
const prodR2Url = required('PROD_R2_URL').replace(/\/$/, '');
const expectedCommit = String(process.env.VITE_GIT_COMMIT || process.env.GITHUB_SHA || '').trim();

if (!hostingUrl.includes('hnl-qltc-dev.web.app')) throw new Error(`Refusing non-DEV Hosting URL: ${hostingUrl}`);
if (hostingUrl.includes(prodProjectId)) throw new Error('REFUSING: DEV Hosting URL references PROD project');

fs.mkdirSync('runtime-evidence', { recursive: true });
const report = {
  hostingUrl,
  expectedCommit,
  startedAt: new Date().toISOString(),
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  forbiddenRequests: [],
};

const pass = (name, detail = '') => {
  report.checks.push({ name, status: 'PASS', detail });
  console.log(`PASS BROWSER: ${name}${detail ? ` — ${detail}` : ''}`);
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runViewport(browser, label, viewport, screenshotPath) {
  const context = await browser.newContext({
    viewport,
    locale: 'vi-VN',
    serviceWorkers: 'allow',
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();

  page.on('pageerror', error => report.pageErrors.push({ label, message: String(error?.message || error) }));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ label, text: message.text() });
  });
  page.on('request', request => {
    const url = request.url();
    if (url.includes(prodProjectId) || url.startsWith(prodR2Url)) {
      report.forbiddenRequests.push({ label, method: request.method(), url });
    }
  });

  const response = await page.goto(`${hostingUrl}/?runtimeGolden=${Date.now()}&viewport=${label}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  assert(response, `${label}: no navigation response`);
  assert(response.status() === 200, `${label}: Hosting returned HTTP ${response.status()}`);
  pass(`${label} Hosting HTTP`, '200');

  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 });
  pass(`${label} React root renders`);

  const title = await page.title();
  assert(title === 'HNL Quản Lý Thi Công', `${label}: unexpected title: ${title}`);
  pass(`${label} document title`, title);

  await page.waitForTimeout(2500);
  assert(report.forbiddenRequests.filter(x => x.label === label).length === 0, `${label}: browser contacted PROD backend`);
  pass(`${label} no PROD Firebase/R2 network request`);

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body?.scrollWidth || 0,
  }));
  const effectiveScroll = Math.max(dimensions.scrollWidth, dimensions.bodyScrollWidth);
  const overflow = effectiveScroll - dimensions.innerWidth;
  assert(overflow <= 12, `${label}: horizontal overflow ${overflow}px (scroll=${effectiveScroll}, viewport=${dimensions.innerWidth})`);
  pass(`${label} responsive horizontal overflow`, `${Math.max(0, overflow)}px`);

  const loginBadge = page.locator('button[title*="dang nhap Google" i], button[title*="Google/Firebase" i]').first();
  assert(await loginBadge.count() > 0, `${label}: Google/Firebase login badge not found`);
  await loginBadge.click();
  const modalText = page.getByText('Đăng nhập Google/Firebase', { exact: true });
  await modalText.waitFor({ state: 'visible', timeout: 10000 });
  pass(`${label} Google/Firebase login modal opens`);

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, registrations: 0 };
    await new Promise(resolve => setTimeout(resolve, 1200));
    const regs = await navigator.serviceWorker.getRegistrations();
    return { supported: true, registrations: regs.length, scopes: regs.map(r => r.scope) };
  });
  assert(swState.supported, `${label}: service worker unsupported unexpectedly`);
  assert(swState.registrations >= 1, `${label}: no service worker registration detected`);
  pass(`${label} service worker registered`, String(swState.registrations));

  await page.screenshot({ path: screenshotPath, fullPage: true });
  pass(`${label} screenshot captured`, screenshotPath);

  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  await runViewport(browser, 'desktop', { width: 1440, height: 900 }, 'runtime-evidence/desktop.png');
  await runViewport(browser, 'mobile', { width: 393, height: 852 }, 'runtime-evidence/mobile.png');

  const fatalConsole = report.consoleErrors.filter(item => {
    const text = item.text.toLowerCase();
    return text.includes('uncaught') || text.includes('chunkloaderror') || text.includes('failed to fetch dynamically imported module');
  });
  assert(report.pageErrors.length === 0, `Page errors detected: ${JSON.stringify(report.pageErrors)}`);
  assert(fatalConsole.length === 0, `Fatal console errors detected: ${JSON.stringify(fatalConsole)}`);
  assert(report.forbiddenRequests.length === 0, `Forbidden PROD requests detected: ${JSON.stringify(report.forbiddenRequests)}`);
  pass('hosted browser fatal error gate', 'no page/fatal-console errors');

  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error?.message || error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync('runtime-evidence/hosted-browser-report.json', JSON.stringify(report, null, 2));
  console.log(`HOSTED BROWSER GOLDEN ${report.status || 'FAIL'} — ${report.checks.length} checks`);
}
