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

async function waitForSettingsSheet(page, sheetKey, visible) {
  const sheet = page.locator(`[data-hnl-settings-sheet="${sheetKey}"]`);
  await sheet.waitFor({ state: visible ? 'visible' : 'hidden', timeout: 10000 });
  return sheet;
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
  const trashSelector = '#trash-recovery-card';
  const syncCard = page.locator(syncSelector);
  const healthCard = page.locator(healthSelector);
  const trashCard = page.locator(trashSelector);
  await syncCard.waitFor({ state: 'visible', timeout: 10000 });
  await healthCard.waitFor({ state: 'visible', timeout: 10000 });
  await trashCard.waitFor({ state: 'visible', timeout: 10000 });

  const settingsCards = [
    { name: 'Trung tâm đồng bộ & sao lưu dự án', selector: syncSelector, card: syncCard, closeMode: 'x' },
    { name: 'HNL Health Center', selector: healthSelector, card: healthCard, closeMode: 'history' },
    {
      name: 'Cài đặt định dạng số & ngày tháng',
      selector: null,
      card: page.locator('details').filter({ hasText: 'Cài đặt định dạng số & ngày tháng' }).first(),
      closeMode: 'escape',
    },
    {
      name: 'Chất lượng ảnh & dung lượng',
      selector: null,
      card: page.locator('details').filter({ hasText: 'Chất lượng ảnh & dung lượng' }).first(),
      closeMode: 'backdrop',
    },
    { name: 'Dữ liệu đã ẩn & lịch sử', selector: trashSelector, card: trashCard, closeMode: 'x' },
  ];

  for (const [index, item] of settingsCards.entries()) {
    await item.card.waitFor({ state: 'visible', timeout: 10000 });
    assert(!(await item.card.evaluate((el) => el.open)), `${label}: Settings card ${index + 1} must start collapsed`);
    assert(
      (await item.card.getAttribute('data-hnl-settings-sheet-open')) === 'false',
      `${label}: Settings card ${index + 1} must advertise closed sheet state`,
    );
  }

  const sharedStyles = await Promise.all(settingsCards.map(({ card }) => card.evaluate((el) => {
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

  for (const [index, item] of settingsCards.entries()) {
    const summary = item.card.locator('summary').first();
    const sheetKey = await item.card.getAttribute('data-hnl-settings-sheet-card');
    assert(sheetKey, `${label}: ${item.name} has no feature-sheet key`);

    await summary.click();
    if (item.selector) {
      await waitForDetailsOpen(page, item.selector, true);
    } else {
      await page.waitForFunction(
        (key) => document.querySelector(`[data-hnl-settings-sheet-card="${key}"]`)?.open === true,
        sheetKey,
        { timeout: 10000 },
      );
    }

    const sheet = await waitForSettingsSheet(page, sheetKey, true);
    const backdrop = page.locator(`[data-hnl-settings-sheet-backdrop="${sheetKey}"]`);
    await backdrop.waitFor({ state: 'visible', timeout: 10000 });

    const metrics = await page.evaluate((key) => {
      const dialog = document.querySelector(`[data-hnl-settings-sheet="${key}"]`);
      const backdropElement = document.querySelector(`[data-hnl-settings-sheet-backdrop="${key}"]`);
      const style = dialog ? getComputedStyle(dialog) : null;
      const rect = dialog?.getBoundingClientRect();
      const offenders = dialog
        ? Array.from(dialog.querySelectorAll('*'))
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
            .filter((entry) => entry.right > window.innerWidth + 1 || entry.scrollWidth - entry.clientWidth > 1)
            .sort((a, b) => Math.max(b.right - window.innerWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - window.innerWidth, a.scrollWidth - a.clientWidth))
            .slice(0, 6)
        : [];
      return {
        role: dialog?.getAttribute('role') || '',
        ariaModal: dialog?.getAttribute('aria-modal') || '',
        position: style?.position || '',
        width: rect?.width ?? -1,
        overflowX: dialog ? dialog.scrollWidth - dialog.clientWidth : -1,
        bodyOverflow: document.body.style.overflow,
        backdropVisible: Boolean(backdropElement && getComputedStyle(backdropElement).display !== 'none'),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        topGap: rect?.top ?? -1,
        bottomGap: rect ? window.innerHeight - rect.bottom : -1,
        height: rect?.height ?? -1,
        scrollBodyClientHeight: dialog?.querySelector(`[data-hnl-settings-sheet-scrollbody="${key}"]`)?.clientHeight ?? -1,
        scrollBodyScrollHeight: dialog?.querySelector(`[data-hnl-settings-sheet-scrollbody="${key}"]`)?.scrollHeight ?? -1,
        offenders,
        headerIconWidth: dialog?.querySelector('header > div:first-child svg')?.getBoundingClientRect().width ?? -1,
        closeWidth: dialog?.querySelector('header button')?.getBoundingClientRect().width ?? -1,
        closeBackground: dialog ? getComputedStyle(dialog.querySelector('header button')).backgroundColor : '',
        closeBorderWidth: dialog ? getComputedStyle(dialog.querySelector('header button')).borderTopWidth : '',
        closeBoxShadow: dialog ? getComputedStyle(dialog.querySelector('header button')).boxShadow : '',
        titleFontSize: dialog ? parseFloat(getComputedStyle(dialog.querySelector('h2')).fontSize) : -1,
      };
    }, sheetKey);

    assert(metrics.role === 'dialog', `${label}: ${item.name} sheet lost dialog role`);
    assert(metrics.ariaModal === 'true', `${label}: ${item.name} sheet is not modal`);
    assert(metrics.position === 'fixed', `${label}: ${item.name} must open as a fixed feature sheet`);
    assert(metrics.backdropVisible, `${label}: ${item.name} sheet backdrop is not visible`);
    assert(metrics.bodyOverflow === 'hidden', `${label}: ${item.name} sheet must lock background page scroll`);
    assert(metrics.width <= metrics.viewportWidth + 1, `${label}: ${item.name} sheet exceeds viewport width`);
    assert(metrics.height > 0 && metrics.height <= metrics.viewportHeight + 1, `${label}: ${item.name} sheet exceeds viewport height`);
    if (metrics.viewportWidth >= 1024) {
      assert(metrics.topGap >= 20, `${label}: ${item.name} desktop sheet is clipped at the top (${metrics.topGap}px gap)`);
      assert(metrics.bottomGap >= 20, `${label}: ${item.name} desktop sheet is hidden at the bottom (${metrics.bottomGap}px gap)`);
    } else {
      assert(metrics.bottomGap >= -1 && metrics.bottomGap <= 2, `${label}: ${item.name} mobile sheet must remain bottom-anchored (${metrics.bottomGap}px gap)`);
    }
    assert(metrics.scrollBodyClientHeight > 0, `${label}: ${item.name} lost its independent scroll body`);
    assert(metrics.scrollBodyScrollHeight >= metrics.scrollBodyClientHeight, `${label}: ${item.name} scroll body has invalid geometry`);
    const scrollReach = await page.evaluate((key) => {
      const body = document.querySelector(`[data-hnl-settings-sheet-scrollbody="${key}"]`);
      if (!body) return { remaining: -1, bottomGap: -1 };
      body.scrollTop = body.scrollHeight;
      const rect = body.getBoundingClientRect();
      return {
        remaining: body.scrollHeight - body.clientHeight - body.scrollTop,
        bottomGap: window.innerHeight - rect.bottom,
      };
    }, sheetKey);
    assert(scrollReach.remaining <= 1, `${label}: ${item.name} cannot scroll to its final content (${scrollReach.remaining}px remaining)`);
    assert(scrollReach.bottomGap >= -1, `${label}: ${item.name} scroll body extends below the viewport (${scrollReach.bottomGap}px)`);
    assert(metrics.overflowX <= 1, `${label}: ${item.name} sheet overflows horizontally — ${JSON.stringify(metrics.offenders)}`);
    assert(metrics.headerIconWidth > 0 && metrics.headerIconWidth <= 24.5, `${label}: ${item.name} header icon is too large (${metrics.headerIconWidth}px)`);
    assert(metrics.closeWidth > 0 && metrics.closeWidth <= 41, `${label}: ${item.name} close target is too large (${metrics.closeWidth}px)`);
    assert(metrics.closeBackground === 'rgba(0, 0, 0, 0)', `${label}: ${item.name} close X regained a visible background (${metrics.closeBackground})`);
    assert(metrics.closeBorderWidth === '0px', `${label}: ${item.name} close X regained a visible border (${metrics.closeBorderWidth})`);
    assert(metrics.closeBoxShadow === 'none', `${label}: ${item.name} close X regained a shadow (${metrics.closeBoxShadow})`);
    assert(metrics.titleFontSize > 0 && metrics.titleFontSize <= 17.5, `${label}: ${item.name} title is too large (${metrics.titleFontSize}px)`);

    const closeButton = sheet.getByRole('button', { name: /^Đóng / }).first();
    await closeButton.waitFor({ state: 'visible', timeout: 10000 });

    if (index === 0) {
      const syncAdvanced = sheet.getByText('Cài đặt sao lưu nâng cao', { exact: true });
      const restrictedBackupNotice = sheet.getByText('Sao lưu/khôi phục dữ liệu:', { exact: true });
      const duplicateSyncStatus = sheet.getByText('Trạng thái đồng bộ', { exact: true });
      const adminBackupSurfaceVisible = await syncAdvanced.isVisible();
      const viewerBackupGuardVisible = await restrictedBackupNotice.isVisible();
      assert(adminBackupSurfaceVisible || viewerBackupGuardVisible, `${label}: Sync Center sheet lost existing backup/RBAC content`);
      assert(await duplicateSyncStatus.count() === 0, `${label}: Sync Center duplicates Health Center sync diagnostics`);
      pass(`${label} Sync Center feature sheet keeps existing business controls`, adminBackupSurfaceVisible ? 'ADMIN surface' : 'VIEWER guard');
      pass(`${label} Sync Center avoids duplicate Health diagnostics`);
    }

    if (item.closeMode === 'x') {
      await closeButton.click();
    } else if (item.closeMode === 'history') {
      await page.evaluate(() => window.history.back());
    } else if (item.closeMode === 'escape') {
      await page.keyboard.press('Escape');
    } else if (item.closeMode === 'backdrop') {
      await backdrop.click({ position: { x: 8, y: 8 } });
    }

    if (item.selector) {
      await waitForDetailsOpen(page, item.selector, false);
    } else {
      await page.waitForFunction(
        (key) => document.querySelector(`[data-hnl-settings-sheet-card="${key}"]`)?.open === false,
        sheetKey,
        { timeout: 10000 },
      );
    }
    await waitForSettingsSheet(page, sheetKey, false);
    await backdrop.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden', null, { timeout: 10000 });
    const historyMarker = await page.evaluate(() => window.history.state?.__hnlFeatureSheet || null);
    assert(!historyMarker, `${label}: ${item.name} left a stale feature-sheet history marker after close`);
  }

  pass(`${label} five Settings entries open in shared feature sheets`);
  pass(`${label} Settings sheet close contract`, 'X + Back + Escape + backdrop');

  const bottomNavBox = await moreButton.boundingBox();
  assert(bottomNavBox, `${label}: bottom navigation disappeared after closing Settings sheets`);
  const viewport = page.viewportSize();
  assert(!viewport || bottomNavBox.y + bottomNavBox.height <= viewport.height + 2, `${label}: bottom navigation is pushed behind viewport after closing Settings sheets`);
  pass(`${label} Settings page returns to normal scroll/navigation after sheets close`);
}

async function verifyMaterialNeedFeatureSheet(page, label) {
  const warehouseButton = page.getByRole('button', { name: 'Kho vật tư', exact: true }).first();
  assert(await warehouseButton.count() > 0, `${label}: Kho vật tư bottom-nav button not found`);
  await warehouseButton.click();

  const trigger = page.locator('[role="button"][aria-controls="material-need-details"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await trigger.click();

  const sheet = await waitForSettingsSheet(page, 'material-need-details', true);
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector('[data-hnl-settings-sheet="material-need-details"]');
    const rect = dialog?.getBoundingClientRect();
    const body = dialog?.querySelector('[data-hnl-settings-sheet-scrollbody="material-need-details"]');
    if (body) body.scrollTop = body.scrollHeight;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      topGap: rect?.top ?? -1,
      bottomGap: rect ? window.innerHeight - rect.bottom : -1,
      remaining: body ? body.scrollHeight - body.clientHeight - body.scrollTop : -1,
      overflowX: dialog ? dialog.scrollWidth - dialog.clientWidth : -1,
    };
  });

  if (metrics.viewportWidth >= 1024) {
    assert(metrics.topGap >= 20, `${label}: Material Need desktop sheet is clipped at the top (${metrics.topGap}px gap)`);
    assert(metrics.bottomGap >= 20, `${label}: Material Need desktop sheet is hidden at the bottom (${metrics.bottomGap}px gap)`);
  } else {
    assert(metrics.bottomGap >= -1 && metrics.bottomGap <= 2, `${label}: Material Need mobile sheet must remain bottom-anchored (${metrics.bottomGap}px gap)`);
  }
  assert(metrics.remaining <= 1, `${label}: Material Need cannot scroll to its final content (${metrics.remaining}px remaining)`);
  assert(metrics.overflowX <= 1, `${label}: Material Need feature sheet overflows horizontally (${metrics.overflowX}px)`);
  pass(`${label} Material Need feature sheet vertical viewport fit`, `${Math.round(metrics.topGap)}px top / ${Math.round(metrics.bottomGap)}px bottom`);

  const closeButton = sheet.getByRole('button', { name: /^Đóng Gợi ý vật tư tổng hợp$/ }).first();
  await closeButton.waitFor({ state: 'visible', timeout: 10000 });
  await closeButton.click();
  await waitForSettingsSheet(page, 'material-need-details', false);
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
  await verifyMaterialNeedFeatureSheet(page, label);

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


async function verifyColdStartOffline(browser) {
  const label = 'cold-start-offline';
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'vi-VN',
    serviceWorkers: 'allow',
    ignoreHTTPSErrors: false,
  });
  let page = await context.newPage();
  const attachEvidence = (targetPage) => {
    targetPage.on('pageerror', error => report.pageErrors.push({ label, message: String(error?.message || error) }));
    targetPage.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push({ label, text: message.text() });
    });
    targetPage.on('request', request => {
      const url = request.url();
      if (url.includes(prodProjectId) || url.startsWith(prodR2Url)) {
        report.forbiddenRequests.push({ label, method: request.method(), url });
      }
    });
  };
  attachEvidence(page);

  await page.goto(`${hostingUrl}/?runtimeGoldenColdStartInstall=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 });

  // CacheStorage is part of the executable app-shell contract. Wait until the current
  // build's Service Worker has atomically installed at least one hashed JS chunk.
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return false;
    await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith('hnl-thi-cong-cache-')) continue;
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      if (keys.some((request) => new URL(request.url).pathname.startsWith('/assets/') && /\.js$/i.test(new URL(request.url).pathname))) {
        return true;
      }
    }
    return false;
  }, null, { timeout: 30000 });

  let swState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const assets = [];
    for (const cacheName of cacheNames) {
      if (!cacheName.startsWith('hnl-thi-cong-cache-')) continue;
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      for (const request of keys) {
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith('/assets/')) assets.push(pathname);
      }
    }
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      scope: registration.scope,
      cacheNames,
      assets: [...new Set(assets)].sort(),
    };
  });

  // First installation can claim just after the initial navigation. Reload once online
  // to make the controller relationship explicit before the browser cache is removed.
  if (!swState.controlled) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
    swState = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const assets = [];
      for (const cacheName of cacheNames) {
        if (!cacheName.startsWith('hnl-thi-cong-cache-')) continue;
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const request of keys) {
          const pathname = new URL(request.url).pathname;
          if (pathname.startsWith('/assets/')) assets.push(pathname);
        }
      }
      return { controlled: Boolean(navigator.serviceWorker.controller), scope: (await navigator.serviceWorker.ready).scope, cacheNames, assets: [...new Set(assets)].sort() };
    });
  }
  assert(swState.controlled, 'cold-start: page is not controlled by Service Worker');
  assert(swState.assets.some((asset) => /\.js$/i.test(asset)), 'cold-start: CacheStorage has no hashed JS chunk');
  pass('cold-start Service Worker controls installed build', `${swState.assets.length} hashed assets cached`);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  pass('cold-start HTTP browser cache cleared');

  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  attachEvidence(page);

  const offlineResponse = await page.goto(`${hostingUrl}/?runtimeGoldenColdStartOffline=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  assert(offlineResponse, 'cold-start offline navigation produced no response');
  assert(offlineResponse.status() === 200, `cold-start offline navigation HTTP ${offlineResponse.status()}`);
  assert(offlineResponse.fromServiceWorker(), 'cold-start offline navigation was not served by Service Worker');
  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 });
  const title = await page.title();
  assert(title === 'HNL Quản Lý Thi Công', `cold-start offline unexpected title: ${title}`);
  pass('cold-start offline React boot from CacheStorage', title);

  await context.setOffline(false);
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  await runViewport(browser, 'desktop', { width: 1440, height: 900 }, 'runtime-evidence/desktop.png');
  await runViewport(browser, 'desktop-720p', { width: 1280, height: 720 }, 'runtime-evidence/desktop-720p.png');
  await runViewport(browser, 'desktop-compact', { width: 1088, height: 610 }, 'runtime-evidence/desktop-compact.png');
  await runViewport(browser, 'mobile', { width: 393, height: 852 }, 'runtime-evidence/mobile.png');
  await verifyColdStartOffline(browser);

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
