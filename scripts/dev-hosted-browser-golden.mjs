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

async function waitForDetailsOpen(page, selector, expectedOpen) {
  await page.waitForFunction(
    ({ targetSelector, open }) => {
      const details = document.querySelector(targetSelector);
      return Boolean(details && details.open === open);
    },
    { targetSelector: selector, open: expectedOpen },
    { timeout: 10000 },
  );
}

async function closeVisibleModal(page, label) {
  // Modal close affordances are intentionally not forced into one markup shape:
  // some dialogs expose an icon X with title="Đóng", while older Security Center
  // keeps a visible footer button whose accessible/text name is "Đóng". Accept both
  // so Runtime Golden certifies user-visible close behavior instead of one DOM detail.
  const titledClose = page.locator('button[title="Đóng"]:visible');
  if (await titledClose.count() > 0) {
    await titledClose.last().click();
    return;
  }

  const namedClose = page.locator('button:visible').filter({ hasText: /^Đóng$/ });
  assert(await namedClose.count() > 0, `${label}: visible modal close control not found`);
  await namedClose.last().click();
}

async function verifySettingsFeatureSheets(page, label) {
  const moreButton = page.getByRole('button', { name: 'Thêm', exact: true });
  assert(await moreButton.count() > 0, `${label}: Thêm bottom-nav button not found`);
  await moreButton.click();

  const settingsButton = page.getByRole('button', { name: 'Cài đặt', exact: true });
  await settingsButton.waitFor({ state: 'visible', timeout: 10000 });
  await settingsButton.click();

  const syncEntry = page.locator('button[title="Trung tâm đồng bộ & sao lưu dự án"]');
  await syncEntry.waitFor({ state: 'visible', timeout: 10000 });
  const syncEntryBox = await syncEntry.boundingBox();
  assert(syncEntryBox, `${label}: Sync Center entry has no layout box`);
  assert(syncEntryBox.height <= 100, `${label}: Sync Center entry is too tall (${syncEntryBox.height}px)`);
  const syncEntryIconBox = await syncEntry.locator('svg').first().boundingBox();
  assert(syncEntryIconBox, `${label}: Sync Center entry icon missing`);
  assert(syncEntryIconBox.width <= 22 && syncEntryIconBox.height <= 22, `${label}: Sync Center entry icon is not compact (${syncEntryIconBox.width}x${syncEntryIconBox.height})`);
  pass(`${label} compact Sync Center Settings entry`, `${Math.round(syncEntryBox.height)}px card, ${Math.round(syncEntryIconBox.width)}px icon`);

  const healthSelector = '#system-sync-card';
  const healthCard = page.locator(healthSelector);
  await healthCard.waitFor({ state: 'visible', timeout: 10000 });
  assert(!(await healthCard.evaluate(el => el.open)), `${label}: HNL Health Center must start collapsed`);
  pass(`${label} HNL Health Center default collapsed`);

  const healthSummary = healthCard.locator('summary').first();
  await healthSummary.click();
  await waitForDetailsOpen(page, healthSelector, true);
  await page.waitForTimeout(80);

  const panelMetrics = await page.evaluate((selector) => {
    const details = document.querySelector(selector);
    const style = details ? getComputedStyle(details) : null;
    const rect = details?.getBoundingClientRect();
    return {
      position: style?.position || '',
      overflowY: style?.overflowY || '',
      top: rect?.top ?? -1,
      width: rect?.width ?? -1,
      radiusTopLeft: Number.parseFloat(style?.borderTopLeftRadius || '0') || 0,
      bodyOverflow: document.body.style.overflow,
      backdrop: Boolean(document.querySelector('[data-hnl-floating-backdrop="true"]')),
    };
  }, healthSelector);
  assert(panelMetrics.position === 'fixed', `${label}: HNL Health Center did not promote to fixed feature sheet`);
  assert(panelMetrics.bodyOverflow === 'hidden', `${label}: feature sheet did not lock background scroll`);
  assert(panelMetrics.backdrop, `${label}: feature sheet backdrop missing`);
  assert(panelMetrics.overflowY === 'auto' || panelMetrics.overflowY === 'scroll', `${label}: feature sheet body is not independently scrollable`);
  if (label === 'mobile') {
    assert(panelMetrics.top > 40 && panelMetrics.top < 120, `${label}: feature sheet top offset is unexpected (${panelMetrics.top}px)`);
    assert(panelMetrics.radiusTopLeft >= 20, `${label}: feature sheet rounded top is missing (${panelMetrics.radiusTopLeft}px)`);
  } else {
    assert(panelMetrics.width <= 980, `${label}: feature panel is too wide (${panelMetrics.width}px)`);
    assert(panelMetrics.top > 0, `${label}: feature panel must leave backdrop visible above it`);
  }
  pass(`${label} HNL Health Center feature sheet layout`, `top=${Math.round(panelMetrics.top)}px width=${Math.round(panelMetrics.width)}px`);

  const closeIndicator = healthSummary.locator('span[aria-hidden="true"]').last();
  await closeIndicator.waitFor({ state: 'visible', timeout: 5000 });
  await closeIndicator.click();
  await waitForDetailsOpen(page, healthSelector, false);
  pass(`${label} HNL Health Center X closes sheet`);

  await healthSummary.click();
  await waitForDetailsOpen(page, healthSelector, true);
  await page.keyboard.press('Escape');
  await waitForDetailsOpen(page, healthSelector, false);
  pass(`${label} HNL Health Center Escape closes sheet`);

  await healthSummary.click();
  await waitForDetailsOpen(page, healthSelector, true);
  await page.waitForTimeout(80);
  await page.evaluate(() => window.history.back());
  await waitForDetailsOpen(page, healthSelector, false);
  pass(`${label} HNL Health Center browser/Android Back closes sheet`);

  await syncEntry.click();
  const syncAdvanced = page.getByText('Cài đặt sao lưu nâng cao', { exact: true });
  await syncAdvanced.waitFor({ state: 'visible', timeout: 10000 });
  const redundantDisclosureText = page.getByText(/^(Mở|Mở rộng|Thu gọn)$/);
  assert(await redundantDisclosureText.count() === 0, `${label}: Sync Center exposes redundant disclosure text`);
  pass(`${label} Sync Center opens dedicated function panel`);

  await closeVisibleModal(page, `${label} Sync Center`);
  await syncAdvanced.waitFor({ state: 'hidden', timeout: 10000 });
  pass(`${label} Sync Center X closes panel`);
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

  // Account/login entry intentionally lives in Security Center. The global header must
  // not regain a separate Google/Firebase badge or a Wi-Fi badge.
  const legacyLoginBadge = page.locator('button[title*="dang nhap Google" i], button[title*="Google/Firebase" i]');
  assert(await legacyLoginBadge.count() === 0, `${label}: legacy Google/Firebase header login badge returned`);
  const wifiBadge = page.locator('button[title*="Wi-Fi" i], button[title*="wifi" i]');
  assert(await wifiBadge.count() === 0, `${label}: legacy Wi-Fi header badge returned`);
  pass(`${label} header account/network badges removed`);

  const securityButton = page.locator('button[title*="Trung tâm bảo mật" i]').first();
  assert(await securityButton.count() > 0, `${label}: Security Center button not found`);
  await securityButton.click();
  const securityTitle = page.getByText('Trung tâm bảo mật & phân quyền', { exact: true });
  await securityTitle.waitFor({ state: 'visible', timeout: 10000 });
  const accountEntry = page.getByText('Tài khoản Google/Firebase', { exact: true });
  await accountEntry.waitFor({ state: 'visible', timeout: 10000 });
  pass(`${label} Security Center owns Google/Firebase account entry`);

  await closeVisibleModal(page, `${label} Security Center`);
  await securityTitle.waitFor({ state: 'hidden', timeout: 10000 });
  pass(`${label} Security Center closes through visible close control`);

  await verifySettingsFeatureSheets(page, label);

  // HNL QLTC offline data is provided by Firestore persistentLocalCache/IndexedDB,
  // not by a PWA service worker. Requiring a service-worker registration here would
  // incorrectly fail a healthy deployment. Verify the browser primitives required by
  // the actual offline architecture instead; the live backend golden separately proves
  // pending writes survive disableNetwork -> enableNetwork and reach another user.
  const storageState = await page.evaluate(() => {
    let localStorageWritable = false;
    try {
      const key = `__hnl_runtime_golden_${Date.now()}`;
      localStorage.setItem(key, '1');
      localStorageWritable = localStorage.getItem(key) === '1';
      localStorage.removeItem(key);
    } catch {}
    return {
      secureContext: window.isSecureContext,
      indexedDbSupported: typeof indexedDB !== 'undefined',
      localStorageWritable,
    };
  });
  assert(storageState.secureContext, `${label}: Hosting is not a secure context`);
  assert(storageState.indexedDbSupported, `${label}: IndexedDB unavailable for Firestore persistent cache`);
  assert(storageState.localStorageWritable, `${label}: localStorage unavailable for runtime metadata`);
  pass(`${label} Firestore offline browser prerequisites`, 'secure context + IndexedDB + localStorage');

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
