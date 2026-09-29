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

async function verifyStaleAssetCacheGuard(page, label) {
  const stalePath = `/assets/__hnl_runtime_stale_${Date.now()}.js`;
  const probe = await page.evaluate(async (path) => {
    const indexResponse = await fetch('/index.html', { cache: 'no-store' });
    const indexBody = await indexResponse.text();
    const parsedIndex = new DOMParser().parseFromString(indexBody, 'text/html');
    const entryScript = Array.from(parsedIndex.scripts)
      .map((script) => script.getAttribute('src') || '')
      .find((src) => {
        try {
          const pathname = new URL(src, location.href).pathname;
          return pathname.startsWith('/assets/') && /\.js$/i.test(pathname);
        } catch {
          return false;
        }
      });
    if (!entryScript) return { error: 'CURRENT_ENTRY_JS_NOT_FOUND' };

    const entryResponse = await fetch(entryScript, { cache: 'no-store' });
    const entryContentType = String(entryResponse.headers.get('content-type') || '').toLowerCase();
    const entryPrefix = (await entryResponse.text()).slice(0, 96).trim().toLowerCase();

    const staleResponse = await fetch(path, { cache: 'no-store' });
    const staleContentType = String(staleResponse.headers.get('content-type') || '').toLowerCase();
    const staleBody = await staleResponse.text();

    let cached = false;
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        if (await cache.match(path)) {
          cached = true;
          break;
        }
      }
    }

    return {
      current: {
        status: entryResponse.status,
        contentType: entryContentType,
        prefix: entryPrefix,
      },
      stale: {
        status: staleResponse.status,
        contentType: staleContentType,
        prefix: staleBody.slice(0, 96).trim().toLowerCase(),
        matchesIndex: staleBody.trim() === indexBody.trim(),
        cached,
      },
    };
  }, stalePath);

  assert(!probe.error, `${label}: current hashed JS entry not found`);
  assert(probe.current.status === 200, `${label}: current hashed JS must return 200, got HTTP ${probe.current.status}`);
  assert(probe.current.contentType.includes('javascript'), `${label}: current hashed JS has non-JavaScript MIME: ${probe.current.contentType || 'unknown'}`);
  assert(!probe.current.prefix.startsWith('<!doctype html') && !probe.current.prefix.startsWith('<html'), `${label}: current hashed JS body resolved to HTML`);

  assert(probe.stale.status === 404, `${label}: stale hashed JS must return 404, got HTTP ${probe.stale.status}`);
  assert(!probe.stale.matchesIndex, `${label}: stale hashed JS was rewritten to app index.html`);
  assert(!probe.stale.cached, `${label}: stale hashed JS response poisoned CacheStorage`);
  pass(`${label} hashed asset boundary`, `current JS 200/${probe.current.contentType || 'unknown'} · stale 404 · not app shell · not cached`);
}

async function verifyRapidPrimaryNavigation(page, label) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const desktopLike = viewport.width >= 1024;

  const result = await page.evaluate(async ({ desktopLike }) => {
    const main = document.querySelector('main[data-hnl-active-tab]');
    if (!main) throw new Error('Main navigation diagnostic surface missing');

    const navSurfaceName = desktopLike ? 'desktop' : 'mobile';
    const navSurface = document.querySelector(`[data-hnl-nav-surface="${navSurfaceName}"]`);
    if (!navSurface || getComputedStyle(navSurface).display === 'none' || navSurface.getClientRects().length === 0) {
      throw new Error(`Visible ${navSurfaceName} navigation surface missing`);
    }
    const visibleNavButton = (tab) => Array.from(navSurface.querySelectorAll(`button[data-hnl-nav-tab="${tab}"]`))
      .find((button) => getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0);
    const preferred = desktopLike
      ? ['home', 'floorplan', 'crew', 'warehouse', 'volume', 'chat', 'ai', 'config']
      : ['home', 'floorplan', 'crew', 'warehouse'];
    const available = preferred.filter((tab) => Boolean(visibleNavButton(tab)));
    const minimum = desktopLike ? 6 : 4;
    if (available.length < minimum) throw new Error(`Not enough visible primary nav tabs for rapid-switch test: ${available.join(',')}`);

    const currentActive = main.getAttribute('data-hnl-active-tab') || '';
    const singleTab = available.find((tab) => tab !== currentActive) || available[0];
    const singleButton = visibleNavButton(singleTab);
    const singleStartedAt = performance.now();
    singleButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', isPrimary: true }));
    singleButton.click();
    const singleDeadline = performance.now() + 1500;
    while (performance.now() < singleDeadline && main.getAttribute('data-hnl-active-tab') !== singleTab) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    const singleSwitchMs = performance.now() - singleStartedAt;
    const singleActive = main.getAttribute('data-hnl-active-tab') || '';

    const singleMountedDeadline = performance.now() + 1500;
    while (performance.now() < singleMountedDeadline && main.getAttribute('data-hnl-mounted-tab') !== singleTab) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    const singleMountedMs = performance.now() - singleStartedAt;
    const singleMounted = main.getAttribute('data-hnl-mounted-tab') || '';
    const singleInstance = main.querySelector(`[data-hnl-tab-instance="${singleTab}"]`);
    await new Promise((resolve) => setTimeout(resolve, 380));

    const commits = [];
    const targets = [];
    const observer = new MutationObserver(() => {
      const mounted = main.getAttribute('data-hnl-mounted-tab') || '';
      if (!commits.length || commits[commits.length - 1] !== mounted) commits.push(mounted);
    });
    observer.observe(main, { attributes: true, attributeFilter: ['data-hnl-mounted-tab'] });

    const targetLatencies = [];
    const startedAt = performance.now();
    for (const tab of available) {
      const button = visibleNavButton(tab);
      const clickAt = performance.now();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', isPrimary: true }));
      button.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const target = main.getAttribute('data-hnl-navigation-target') || '';
      targets.push(target);
      targetLatencies.push({ tab, ms: performance.now() - clickAt, target });
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    const finalTab = available[available.length - 1];
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline && main.getAttribute('data-hnl-mounted-tab') !== finalTab) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    observer.disconnect();

    // Capture the rapid-navigation outcome before the intentional same-tab/revisit probes
    // below mutate the visual and mounted destinations again.
    const rapidFinalActive = main.getAttribute('data-hnl-active-tab') || '';
    const rapidFinalMounted = main.getAttribute('data-hnl-mounted-tab') || '';
    const rapidFinalTarget = main.getAttribute('data-hnl-navigation-target') || '';

    const sameTabButton = visibleNavButton(finalTab);
    const sameTabBefore = main.getAttribute('data-hnl-mounted-tab') || '';
    const sameTabInstanceBefore = main.querySelector(`[data-hnl-tab-instance="${finalTab}"]`);
    const hasVisibleSwitching = () => Array.from(main.querySelectorAll('[data-hnl-tab-switching="true"]'))
      .some((node) => {
        const element = node;
        return getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
      });
    const sameTabSwitchingBefore = hasVisibleSwitching();
    sameTabButton.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 32));
    const sameTabAfter = main.getAttribute('data-hnl-mounted-tab') || '';
    const sameTabInstanceAfter = main.querySelector(`[data-hnl-tab-instance="${finalTab}"]`);
    const sameTabPreservedInstance = Boolean(sameTabInstanceBefore && sameTabInstanceAfter && sameTabInstanceBefore === sameTabInstanceAfter);
    const sameTabSwitchingAfter = hasVisibleSwitching();

    // Revisit a tab whose chunk has already loaded. This measures render/remount cost,
    // not network download cost, and mirrors the user's "đã bấm rồi mà bấm lại vẫn lâu".
    const revisitButton = visibleNavButton(singleTab);
    const revisitStartedAt = performance.now();
    revisitButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', isPrimary: true }));
    revisitButton.click();
    const revisitVisualDeadline = performance.now() + 500;
    while (performance.now() < revisitVisualDeadline && main.getAttribute('data-hnl-active-tab') !== singleTab) {
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    const revisitVisualMs = performance.now() - revisitStartedAt;
    const revisitMountedDeadline = performance.now() + 1500;
    while (performance.now() < revisitMountedDeadline && main.getAttribute('data-hnl-mounted-tab') !== singleTab) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    const revisitMountedMs = performance.now() - revisitStartedAt;
    const revisitMounted = main.getAttribute('data-hnl-mounted-tab') || '';
    const revisitInstance = main.querySelector(`[data-hnl-tab-instance="${singleTab}"]`);
    const revisitPreservedInstance = Boolean(singleInstance && revisitInstance && singleInstance === revisitInstance);
    const revisitSwitching = Boolean(main.querySelector('[data-hnl-tab-switching="true"]'));

    return {
      available,
      singleTab,
      singleActive,
      singleSwitchMs,
      singleMounted,
      singleMountedMs,
      finalTab,
      finalActive: rapidFinalActive,
      finalMounted: rapidFinalMounted,
      finalTarget: rapidFinalTarget,
      commits,
      targets,
      targetLatencies,
      sameTabBefore,
      sameTabAfter,
      sameTabPreservedInstance,
      sameTabSwitchingBefore,
      sameTabSwitchingAfter,
      revisitVisualMs,
      revisitMountedMs,
      revisitMounted,
      revisitPreservedInstance,
      revisitSwitching,
      totalMs: performance.now() - startedAt,
    };
  }, { desktopLike });

  assert(result.singleActive === result.singleTab, `${label}: visible destination shell did not settle on one click (${result.singleActive} != ${result.singleTab})`);
  assert(result.singleSwitchMs <= 120, `${label}: visible destination shell exceeded 120ms (${result.singleSwitchMs.toFixed(1)}ms)`);
  assert(result.singleMounted === result.singleTab, `${label}: heavy content did not settle on one click (${result.singleMounted} != ${result.singleTab})`);
  assert(result.singleMountedMs <= 900, `${label}: first heavy-content mount exceeded 900ms (${result.singleMountedMs.toFixed(1)}ms)`);
  assert(result.finalActive === result.finalTab, `${label}: rapid navigation visual shell did not settle on last click (${result.finalActive} != ${result.finalTab})`);
  assert(result.finalMounted === result.finalTab, `${label}: rapid navigation heavy content did not settle on last click (${result.finalMounted} != ${result.finalTab})`);
  assert(result.targets.every((target, index) => target === result.available[index]), `${label}: requested nav target did not respond to every rapid click — ${JSON.stringify(result.targetLatencies)}`);
  const maxTargetLatency = Math.max(...result.targetLatencies.map((entry) => entry.ms));
  assert(maxTargetLatency <= 220, `${label}: rapid navigation target feedback exceeded 220ms (${maxTargetLatency.toFixed(1)}ms)`);
  const heavyTabs = new Set(['floorplan', 'crew', 'warehouse', 'volume', 'config', 'chat', 'ai']);
  const intermediateHeavyCommits = result.commits.filter((tab) => tab && tab !== result.finalTab && heavyTabs.has(tab));
  assert(intermediateHeavyCommits.length === 0, `${label}: intermediate heavy tabs committed during rapid navigation — ${JSON.stringify(result.commits)}`);
  assert(result.sameTabBefore === result.finalTab && result.sameTabAfter === result.finalTab, `${label}: re-tapping active tab changed mounted content`);
  assert(result.sameTabPreservedInstance, `${label}: re-tapping active tab remounted its existing DOM instance`);
  assert(!(result.sameTabSwitchingBefore === false && result.sameTabSwitchingAfter === true), `${label}: re-tapping active tab introduced a new visible loading state`);
  assert(result.revisitMounted === result.singleTab, `${label}: warmed tab revisit did not settle to ${result.singleTab}`);
  assert(result.revisitPreservedInstance, `${label}: warmed primary tab was remounted instead of reusing its existing DOM instance`);
  assert(!result.revisitSwitching, `${label}: warmed primary tab revisit displayed a loading state`);
  assert(result.revisitVisualMs <= 120, `${label}: warmed tab revisit shell exceeded 120ms (${result.revisitVisualMs.toFixed(1)}ms)`);
  assert(result.revisitMountedMs <= 180, `${label}: warmed tab revisit commit exceeded 180ms (${result.revisitMountedMs.toFixed(1)}ms)`);
  assert(result.totalMs <= 2200, `${label}: rapid navigation settle path exceeded 2200ms (${result.totalMs.toFixed(1)}ms)`);
  pass(`${label} primary navigation responsiveness`, `shell ${result.singleSwitchMs.toFixed(1)}ms · first content ${result.singleMountedMs.toFixed(1)}ms · revisit ${result.revisitMountedMs.toFixed(1)}ms · ${result.available.length} rapid tabs · max target ${maxTargetLatency.toFixed(1)}ms`);
}

async function verifyMobileMoreNavigation(page, label) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) return;

  const result = await page.evaluate(async () => {
    const main = document.querySelector('main[data-hnl-active-tab]');
    const navSurface = document.querySelector('[data-hnl-nav-surface="mobile"]');
    if (!main || !navSurface) throw new Error('Mobile navigation diagnostic surface missing');
    const visibleButton = (tab) => Array.from(navSurface.querySelectorAll(`button[data-hnl-nav-tab="${tab}"]`))
      .find((button) => getComputedStyle(button).display !== 'none' && button.getClientRects().length > 0);
    const more = visibleButton('more');
    if (!more) throw new Error('Visible mobile More button missing');

    const required = ['volume', 'chat', 'config'];
    const optional = ['checklist', 'ai', 'superadmin'];
    const tested = [];
    const targetLatencies = [];
    const settleLatencies = [];

    for (const tab of [...required, ...optional]) {
      if (!visibleButton(tab)) {
        more.click();
        const menuDeadline = performance.now() + 800;
        while (performance.now() < menuDeadline && !visibleButton(tab)) {
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      }
      const button = visibleButton(tab);
      if (!button) {
        // Optional entries can legitimately be absent for this project/account.
        if (required.includes(tab)) throw new Error(`Required mobile More destination missing: ${tab}`);
        const openMore = visibleButton('more');
        if (openMore) openMore.click();
        continue;
      }

      const clickAt = performance.now();
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true }));
      button.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const target = main.getAttribute('data-hnl-navigation-target') || '';
      targetLatencies.push({ tab, ms: performance.now() - clickAt, target });

      const settleStartedAt = performance.now();
      const settleDeadline = performance.now() + 1500;
      while (performance.now() < settleDeadline && main.getAttribute('data-hnl-mounted-tab') !== tab) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      settleLatencies.push({ tab, ms: performance.now() - settleStartedAt, active: main.getAttribute('data-hnl-mounted-tab') || '' });
      tested.push(tab);
      await new Promise((resolve) => setTimeout(resolve, 380));
    }

    return { required, tested, targetLatencies, settleLatencies };
  });

  assert(result.required.every((tab) => result.tested.includes(tab)), `${label}: mobile More paths did not cover required destinations — ${JSON.stringify(result.tested)}`);
  assert(result.targetLatencies.every((entry) => entry.target === entry.tab), `${label}: mobile More destination feedback mismatch — ${JSON.stringify(result.targetLatencies)}`);
  const maxTargetLatency = Math.max(...result.targetLatencies.map((entry) => entry.ms));
  const maxSettleLatency = Math.max(...result.settleLatencies.map((entry) => entry.ms));
  assert(maxTargetLatency <= 220, `${label}: mobile More target feedback exceeded 220ms (${maxTargetLatency.toFixed(1)}ms)`);
  assert(result.settleLatencies.every((entry) => entry.active === entry.tab && entry.ms <= 900), `${label}: mobile More destination settle exceeded 900ms — ${JSON.stringify(result.settleLatencies)}`);
  pass(`${label} mobile More navigation paths`, `${result.tested.join('→')} · max target ${maxTargetLatency.toFixed(1)}ms · max settle ${maxSettleLatency.toFixed(1)}ms`);
}

async function verifySettingsFeatureSheets(page, label) {
  const viewport = page.viewportSize();
  const desktopRail = Boolean(viewport && viewport.width >= 1024);
  const moreButton = page.getByRole('button', { name: 'Thêm', exact: true });
  if (!desktopRail) {
    assert(await moreButton.count() > 0, `${label}: Thêm mobile bottom-nav button not found`);
    await moreButton.click();
  }

  const settingsButton = page.getByRole('button', { name: 'Cài đặt', exact: true }).first();
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

  if (desktopRail) {
    const settingsRailBox = await settingsButton.boundingBox();
    assert(settingsRailBox, `${label}: desktop left navigation disappeared after closing Settings sheets`);
    assert(!viewport || settingsRailBox.x >= -2, `${label}: desktop left navigation moved outside the viewport after closing Settings sheets`);
  } else {
    const bottomNavBox = await moreButton.boundingBox();
    assert(bottomNavBox, `${label}: mobile bottom navigation disappeared after closing Settings sheets`);
    assert(!viewport || bottomNavBox.y + bottomNavBox.height <= viewport.height + 2, `${label}: mobile bottom navigation is pushed behind viewport after closing Settings sheets`);
  }
  pass(`${label} Settings page returns to normal responsive navigation after sheets close`);
}

async function verifyMaterialNeedFeatureSheet(page, label) {
  const warehouseButton = page.getByRole('button', { name: 'Kho vật tư', exact: true }).first();
  assert(await warehouseButton.count() > 0, `${label}: Kho vật tư navigation button not found`);
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

  await sheet.getByText('Tất cả căn', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
  await sheet.getByText('Tất cả hạng mục đã khai', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
  pass(`${label} Material Need multi-room + declared work-category filters visible`);

  const closeButton = sheet.getByRole('button', { name: /^Đóng Gợi ý vật tư tổng hợp$/ }).first();
  await closeButton.waitFor({ state: 'visible', timeout: 10000 });
  await closeButton.click();
  await waitForSettingsSheet(page, 'material-need-details', false);
}

const runtimeOfflineIdentity = {
  uid: 'runtime-golden-offline-admin',
  email: 'runtime-golden-offline-admin@example.test',
  displayName: 'Runtime Golden Offline Admin',
};

async function seedRememberedOfflineAdmin(context) {
  await context.addInitScript(({ identity }) => {
    try {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    } catch {}
    try {
      const now = Date.now();
      const projectId = 'default';
      localStorage.setItem('construction_offline_verified_auth_v1', JSON.stringify({
        ...identity,
        rememberedAt: now,
      }));
      localStorage.setItem(`construction_verified_project_role_v1_${encodeURIComponent(identity.uid)}__${encodeURIComponent(projectId)}`, JSON.stringify({
        version: 1,
        projectId,
        uid: identity.uid,
        email: identity.email,
        role: 'ADMIN',
        allowed: true,
        verifiedAt: now,
      }));
      localStorage.setItem('construction_projects_list', JSON.stringify([{
        id: projectId,
        name: 'Runtime Golden Project',
        createdAt: now,
        updatedAt: now,
        createdAtSource: 'local',
      }]));
      localStorage.setItem('active_project_id', projectId);
      sessionStorage.setItem('active_project_id', projectId);
    } catch {}
  }, { identity: runtimeOfflineIdentity });
}

async function verifySignedOutGate(browser, label, viewport, screenshotPath) {
  const context = await browser.newContext({ viewport, locale: 'vi-VN', serviceWorkers: 'allow', ignoreHTTPSErrors: false });
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

  const response = await page.goto(`${hostingUrl}/?runtimeGoldenSignedOut=${Date.now()}&viewport=${label}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  assert(response && response.status() === 200, `${label}: signed-out Hosting navigation failed`);
  await page.locator('[data-hnl-auth-gate="signed-out"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: 'Đăng nhập bằng Google', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  assert(await page.locator('aside').count() === 0, `${label}: desktop navigation rail leaked before login`);
  assert(await page.locator('button[title*="Trung tâm bảo mật" i]').count() === 0, `${label}: Security Center leaked before login`);
  assert(await page.getByText('Ghi nhận quân số', { exact: true }).count() === 0, `${label}: project UI leaked before login`);
  assert(report.forbiddenRequests.filter(x => x.label === label).length === 0, `${label}: signed-out browser contacted PROD backend`);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - window.innerWidth);
  assert(overflow <= 12, `${label}: signed-out auth screen horizontal overflow ${overflow}px`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  pass(`${label} dedicated signed-out Auth Gate`, 'project UI hidden until Google login');
  await context.close();
}

async function runViewport(browser, label, viewport, screenshotPath) {
  const context = await browser.newContext({
    viewport,
    locale: 'vi-VN',
    serviceWorkers: 'allow',
    ignoreHTTPSErrors: false,
  });
  await seedRememberedOfflineAdmin(context);
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
  assert(await page.locator('[data-hnl-auth-gate="signed-out"]').count() === 0, `${label}: remembered verified identity did not bypass the login screen`);
  pass(`${label} remembered verified offline identity resumes app without login prompt`);

  const title = await page.title();
  assert(title === 'HNL Quản Lý Thi Công', `${label}: unexpected title: ${title}`);
  pass(`${label} document title`, title);

  await verifyStaleAssetCacheGuard(page, label);

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

  await verifyRapidPrimaryNavigation(page, label);
  await verifyMobileMoreNavigation(page, label);

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

  const poisonGuard = await page.evaluate(async () => {
    const path = `/assets/__hnl_runtime_poison_${Date.now()}.js`;
    const cacheNames = await caches.keys();
    const activeCacheName = cacheNames.find((name) => name.startsWith('hnl-thi-cong-cache-'));
    if (!activeCacheName) return { error: 'HNL_CACHE_NOT_FOUND' };

    const cache = await caches.open(activeCacheName);
    await cache.put(path, new Response('<!doctype html><html><body>poison</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    const response = await fetch(path, { cache: 'no-store' });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const prefix = (await response.text()).slice(0, 96).trim().toLowerCase();

    let stillCached = false;
    for (const name of await caches.keys()) {
      const candidate = await caches.open(name);
      if (await candidate.match(path)) {
        stillCached = true;
        break;
      }
    }

    return { status: response.status, contentType, prefix, stillCached };
  });

  assert(!poisonGuard.error, `cold-start SW poison guard setup failed: ${poisonGuard.error || 'unknown'}`);
  assert(poisonGuard.status === 404, `cold-start SW poison guard expected 404, got ${poisonGuard.status}`);
  assert(!poisonGuard.contentType.includes('text/html') && !poisonGuard.prefix.startsWith('<!doctype html') && !poisonGuard.prefix.startsWith('<html'), 'cold-start SW poison guard returned HTML for JS URL');
  assert(!poisonGuard.stillCached, 'cold-start SW poison guard did not delete poisoned CacheStorage entry');
  pass('cold-start Service Worker purges poisoned hashed JS cache', 'HTTP 404 · text-safe · poisoned entry deleted');

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

async function verifyNarrowDesktopRuntime(browser) {
  const context = await browser.newContext({ viewport: { width: 820, height: 720 } });
  await seedRememberedOfflineAdmin(context);
  const page = await context.newPage();
  const response = await page.goto(`${hostingUrl}/?app=desktop&runtimeGoldenDesktopNarrow=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  assert(response && response.status() === 200, 'desktop EXE narrow runtime navigation failed');
  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, { timeout: 20000 });

  const rail = page.locator('aside').first();
  await rail.waitFor({ state: 'visible', timeout: 10000 });
  const railBox = await rail.boundingBox();
  assert(railBox && railBox.x >= -1 && railBox.width >= 80, 'desktop EXE narrow runtime left rail moved out of viewport');

  const moreButton = page.getByRole('button', { name: 'Thêm', exact: true });
  const moreButtonCount = await moreButton.count();
  if (moreButtonCount > 0) {
    assert(!(await moreButton.first().isVisible()), 'desktop EXE narrow runtime incorrectly switched to mobile bottom navigation');
  }
  pass('desktop EXE narrow runtime mobile bottom navigation is absent/hidden', moreButtonCount === 0 ? 'not rendered' : 'hidden');

  await page.screenshot({ path: 'runtime-evidence/desktop-exe-narrow.png', fullPage: false });
  pass('desktop EXE narrow viewport keeps fixed left navigation rail', `${Math.round(railBox.width)}px rail at x=${Math.round(railBox.x)}`);
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  await verifySignedOutGate(browser, 'login-desktop', { width: 1440, height: 900 }, 'runtime-evidence/login-desktop.png');
  await verifySignedOutGate(browser, 'login-mobile', { width: 393, height: 852 }, 'runtime-evidence/login-mobile.png');
  await runViewport(browser, 'desktop', { width: 1440, height: 900 }, 'runtime-evidence/desktop.png');
  await runViewport(browser, 'desktop-720p', { width: 1280, height: 720 }, 'runtime-evidence/desktop-720p.png');
  await runViewport(browser, 'desktop-compact', { width: 1088, height: 610 }, 'runtime-evidence/desktop-compact.png');
  await verifyNarrowDesktopRuntime(browser);
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
