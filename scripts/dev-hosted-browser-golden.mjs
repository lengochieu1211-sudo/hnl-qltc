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

  const syncSelector = '#sync-backup-card';
  const healthSelector = '#system-sync-card';
  const syncCard = page.locator(syncSelector);
  const healthCard = page.locator(healthSelector);
  await syncCard.waitFor({ state: 'visible', timeout: 10000 });
  await healthCard.waitFor({ state: 'visible', timeout: 10000 });

  const settingsCards = [
    syncCard,
    healthCard,
    page.locator('details').filter({ hasText: 'Cài đặt định dạng số & ngày tháng' }).first(),
    page.locator('details').filter({ hasText: 'Chất lượng ảnh & dung lượng' }).first(),
    page.locator('#trash-recovery-card'),
  ];
  for (const [index, card] of settingsCards.entries()) {
    await card.waitFor({ state: 'visible', timeout: 10000 });
    assert(!(await card.evaluate(el => el.open)), `${label}: Settings card ${index + 1} must start collapsed`);
  }

  const sharedStyles = await Promise.all(settingsCards.map((card) => card.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      overflowX: el.scrollWidth - el.clientWidth,
    };
  })));
  for (let i = 1; i < sharedStyles.length; i += 1) {
    assert(sharedStyles[i].backgroundColor === sharedStyles[0].backgroundColor, `${label}: Settings cards do not share the same background`);
    assert(sharedStyles[i].borderRadius === sharedStyles[0].borderRadius, `${label}: Settings cards do not share the same radius`);
    assert(sharedStyles[i].borderWidth === sharedStyles[0].borderWidth, `${label}: Settings cards do not share the same border`);
    assert(sharedStyles[i].boxShadow === sharedStyles[0].boxShadow, `${label}: Settings cards do not share the same shadow`);
    assert(sharedStyles[i].overflowX <= 1, `${label}: Settings card ${i + 1} overflows horizontally`);
  }
  pass(`${label} five Settings cards share one design system`);

  const syncSummary = syncCard.locator('summary').first();
  const syncClosedBox = await syncSummary.boundingBox();
  assert(syncClosedBox, `${label}: Sync Center summary has no layout box`);
  assert(syncClosedBox.height <= 110, `${label}: Sync Center closed header is too tall (${syncClosedBox.height}px)`);
  const syncIconBox = await syncSummary.locator('svg').first().boundingBox();
  assert(syncIconBox && syncIconBox.width <= 22 && syncIconBox.height <= 22, `${label}: Sync Center icon is not compact`);
  const syncOverflow = await syncSummary.evaluate((el) => el.scrollWidth - el.clientWidth);
  assert(syncOverflow <= 1, `${label}: Sync Center closed header overflows horizontally`);
  pass(`${label} compact Sync Center closed state`, `${Math.round(syncClosedBox.height)}px header`);

  await syncSummary.click();
  await waitForDetailsOpen(page, syncSelector, true);
  await page.waitForTimeout(80);

  const syncOpenMetrics = await page.evaluate((selector) => {
    const details = document.querySelector(selector);
    const style = details ? getComputedStyle(details) : null;
    const rect = details?.getBoundingClientRect();
    return {
      position: style?.position || '',
      width: rect?.width ?? -1,
      overflowX: details ? details.scrollWidth - details.clientWidth : -1,
      bodyOverflow: document.body.style.overflow,
      backdropCount: document.querySelectorAll('[data-hnl-floating-backdrop="true"]').length,
      viewportWidth: window.innerWidth,
      offenders: details
        ? Array.from(details.querySelectorAll('*'))
            .map((el) => {
              const box = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                className: typeof el.className === 'string' ? el.className.slice(0, 180) : '',
                left: Math.round(box.left),
                right: Math.round(box.right),
                width: Math.round(box.width),
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
              };
            })
            .filter((item) => item.right > window.innerWidth + 1 || item.scrollWidth - item.clientWidth > 1)
            .sort((a, b) => Math.max(b.right - window.innerWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - window.innerWidth, a.scrollWidth - a.clientWidth))
            .slice(0, 6)
        : [],
    };
  }, syncSelector);
  assert(syncOpenMetrics.position !== 'fixed', `${label}: Sync Center must expand inline, not become a fixed page/sheet`);
  assert(syncOpenMetrics.backdropCount === 0, `${label}: inline Sync Center must not create a floating backdrop`);
  assert(syncOpenMetrics.bodyOverflow !== 'hidden', `${label}: inline Sync Center must not lock page scroll`);
  assert(syncOpenMetrics.width <= syncOpenMetrics.viewportWidth + 1, `${label}: Sync Center exceeds viewport width`);
  assert(syncOpenMetrics.overflowX <= 1, `${label}: opened Sync Center overflows horizontally — ${JSON.stringify(syncOpenMetrics.offenders)}`);

  const syncAdvanced = syncCard.getByText('Cài đặt sao lưu nâng cao', { exact: true });
  const restrictedBackupNotice = syncCard.getByText('Sao lưu/khôi phục dữ liệu:', { exact: true });
  const adminBackupSurfaceVisible = await syncAdvanced.isVisible();
  const viewerBackupGuardVisible = await restrictedBackupNotice.isVisible();
  assert(adminBackupSurfaceVisible || viewerBackupGuardVisible, `${label}: inline Sync Center lost existing backup/RBAC content`);
  pass(`${label} Sync Center opens inline with existing business controls`, adminBackupSurfaceVisible ? 'ADMIN surface' : 'VIEWER guard');

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(80);
  const bottomNavBox = await moreButton.boundingBox();
  assert(bottomNavBox, `${label}: bottom navigation disappeared after opening/scrolling Settings accordion`);
  const viewport = page.viewportSize();
  assert(!viewport || bottomNavBox.y + bottomNavBox.height <= viewport.height + 2, `${label}: bottom navigation is pushed behind viewport after accordion open`);
  pass(`${label} page scroll + bottom navigation remain usable while Sync Center is open`);

  await syncSummary.click();
  await waitForDetailsOpen(page, syncSelector, false);
  pass(`${label} Sync Center closes back into the same card`);

  const healthSummary = healthCard.locator('summary').first();
  await healthSummary.click();
  await waitForDetailsOpen(page, healthSelector, true);
  const healthMetrics = await page.evaluate((selector) => {
    const details = document.querySelector(selector);
    const style = details ? getComputedStyle(details) : null;
    return {
      position: style?.position || '',
      overflowX: details ? details.scrollWidth - details.clientWidth : -1,
      backdropCount: document.querySelectorAll('[data-hnl-floating-backdrop="true"]').length,
      bodyOverflow: document.body.style.overflow,
    };
  }, healthSelector);
  assert(healthMetrics.position !== 'fixed', `${label}: HNL Health Center must use the shared inline accordion behavior`);
  assert(healthMetrics.backdropCount === 0, `${label}: HNL Health Center created an obsolete sheet backdrop`);
  assert(healthMetrics.bodyOverflow !== 'hidden', `${label}: HNL Health Center locked page scroll`);
  assert(healthMetrics.overflowX <= 1, `${label}: HNL Health Center overflows horizontally`);
  await healthSummary.click();
  await waitForDetailsOpen(page, healthSelector, false);
  pass(`${label} HNL Health Center open/close uses shared inline accordion`);
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
