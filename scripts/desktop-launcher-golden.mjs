import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`DESKTOP GOLDEN FAIL: ${message}`);
  console.log(`PASS DESKTOP: ${message}`);
}

function readPngSize(path) {
  const buf = fs.readFileSync(path);
  assert(buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG', 'desktop icon source is a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

const launcher = read('desktop-wrapper/QLTCAnPhuLauncher.cs');
const localStore = read('desktop-wrapper/DesktopLocalStore.cs');
const build = read('desktop-wrapper/build-launcher.ps1');
const workflow = read('.github/workflows/windows-exe.yml');
const iconGolden = read('scripts/windows-icon-golden.ps1');
const indexHtml = read('index.html');
const manifest = JSON.parse(read('public/manifest.json'));
const releaseTag = read('desktop-wrapper/release-tag.txt').trim();
const iconSource = readPngSize('public/icon.png');
const taskbar192 = readPngSize('public/hnl-logo-original-192.png');
const taskbar512 = readPngSize('public/hnl-logo-original-512.png');
const runtimeTaskbarSizes = [16, 20, 24, 28, 32, 40, 48];

assert(launcher.includes('https://hnlqltc.web.app/?app=desktop'), 'desktop wrapper targets short PROD Hosting');
assert(!launcher.includes('https://com-example-qlct-61329.web.app/?app=desktop'), 'legacy desktop Hosting URL is removed');
assert(launcher.includes('"QLTCAnPhu"') && launcher.includes('"EdgeProfile"'), 'legacy Edge profile path is preserved for local/offline data continuity');
assert(!launcher.includes('Service Worker') && !launcher.includes('CacheStorage'), 'launcher no longer deletes service-worker offline cache on every start');
assert(launcher.includes('Google') && launcher.includes('Chrome'), 'Chrome fallback is available when Edge is unavailable');
assert(launcher.includes('--app='), 'desktop runtime is browser app-mode, so running Taskbar icon is web/PWA-owned');
assert(launcher.includes('HNL QLTC Windows Desktop Suite'), 'launcher exposes the Windows Desktop Suite shell');
assert(launcher.includes('Application.Run(new DesktopSuiteForm())'), 'EXE opens the native Desktop Suite dashboard before launching the web app');
assert(launcher.includes('SpecialFolder.MyDocuments') && launcher.includes('\"HNL QLTC\"'), 'Desktop Suite creates a user-visible HNL QLTC workspace under Documents');
for (const folder of ['Backup', 'Imports', 'Exports', 'Excel', 'PDF', 'Reports', 'Photos', 'Diagnostics', 'Logs']) {
  assert(launcher.includes(`\"${folder}\"`), `Desktop Suite declares ${folder} workspace area`);
}
assert(launcher.includes('HNL-QLTC-DESKTOP-DIAGNOSTIC-'), 'Desktop Suite can export a diagnostic snapshot');
assert(launcher.includes('HostingHealthUrl') && launcher.includes('R2HealthUrl') && launcher.includes('AiHealthUrl'), 'diagnostics cover Hosting, R2 and AI Gateway');
assert(launcher.includes('NotifyIcon') && launcher.includes('Desktop Suite vẫn đang chạy ở khay hệ thống'), 'Desktop Suite supports Windows system tray');
assert(!launcher.includes('deletePhoto') && !launcher.includes('purgeBinary'), 'Desktop Suite shell has no destructive cloud-media operation');
assert(launcher.includes('Local Workspace & Queue') && launcher.includes('Quét lại chỉ mục'), 'Desktop Suite exposes local workspace indexing controls');
assert(launcher.includes('DesktopPaths.LocalDatabase') && launcher.includes('workspace.db'), 'Desktop Suite stores its local SQLite database under LocalAppData');
assert(localStore.includes('winsqlite3.dll'), 'local workspace uses Windows inbox winsqlite3 without an external database DLL');
assert(localStore.includes('CREATE TABLE IF NOT EXISTS workspace_files') && localStore.includes('CREATE TABLE IF NOT EXISTS sync_queue'), 'SQLite schema contains workspace mirror and durable sync queue');
assert(localStore.includes('ready_for_app_sync') && localStore.includes('prepare_binary'), 'background queue prepares changed Imports/Photos files before app sync');
assert(localStore.includes('SHA256.Create()'), 'background preparation hashes staged files with SHA-256');
assert(localStore.includes('Cloudflare R2 binary') && localStore.includes('SQLite is local mirror/cache only'), 'SQLite explicitly remains a local mirror/cache, not cloud authority');
assert(!localStore.includes('HttpWebRequest') && !localStore.includes('R2HealthUrl') && !localStore.includes('firebase'), 'local store has no direct cloud-write transport');
assert(build.includes('HNL-QLTC-Windows.exe'), 'build script creates one portable Windows EXE');
assert(build.includes('/reference:System.Drawing.dll'), 'build script references System.Drawing for the native Desktop Suite UI');
assert(build.includes('DesktopLocalStore.cs'), 'build compiles the SQLite local workspace engine');
assert(build.includes('release-tag.txt'), 'build script uses release tag for cache/version isolation');
assert(releaseTag === '6.3.0-rc2.2.18', 'desktop release tag matches RC2.2.18 SQLite Workspace');

assert(iconSource.width >= 1024 && iconSource.height >= 1024 && iconSource.bytes > 1_000_000, 'HQ HNL logo source is retained at >=1024px');
assert(taskbar192.width === 192 && taskbar192.height === 192, 'browser app-mode has dedicated 192x192 HNL icon');
assert(taskbar512.width === 512 && taskbar512.height === 512, 'browser app-mode has dedicated 512x512 HNL icon');
for (const size of runtimeTaskbarSizes) {
  const icon = readPngSize(`public/hnl-logo-original-${size}.png`);
  assert(icon.width === size && icon.height === size, `browser app-mode has exact original-logo ${size}x${size} HNL icon`);
  assert(indexHtml.includes(`sizes="${size}x${size}" href="/hnl-logo-original-${size}.png?v=20260909-original1"`), `HTML advertises exact ${size}x${size} runtime icon`);
}
assert(indexHtml.includes('/hnl-logo-original-192.png?v=20260909-original1') && indexHtml.includes('/hnl-logo-original-512.png?v=20260909-original1'), 'running browser app-mode retains canonical HNL install-icon fallbacks');
assert(!indexHtml.includes('/icon-taskbar.svg'), 'running browser app-mode no longer asks Chrome/Edge to downsample the vector taskbar icon');
assert(!indexHtml.includes('/favicon-3d.ico'), 'legacy single-frame 16x16 favicon is not used by running app-mode');
const manifestIconSizes = new Set((manifest.icons || []).map((item) => `${item.src}|${item.sizes}|${item.type}`));
for (const size of runtimeTaskbarSizes) {
  assert(manifestIconSizes.has(`/hnl-logo-original-${size}.png?v=20260909-original1|${size}x${size}|image/png`), `PWA manifest includes exact ${size}x${size} runtime PNG`);
}
assert(manifestIconSizes.has('/hnl-logo-original-192.png?v=20260909-original1|192x192|image/png'), 'PWA manifest retains 192x192 HNL PNG fallback');
assert(manifestIconSizes.has('/hnl-logo-original-512.png?v=20260909-original1|512x512|image/png'), 'PWA manifest retains 512x512 HNL PNG fallback');
assert(!(manifest.icons || []).some((item) => String(item.src || '').includes('icon-taskbar.svg')), 'PWA manifest does not prioritize the blurred vector runtime icon');
assert((manifest.icons || []).length === runtimeTaskbarSizes.length + 2, 'PWA manifest contains exact small runtime frames plus two HQ install fallbacks');
for (const size of runtimeTaskbarSizes) {
  assert(read('public/sw.js').includes(`/hnl-logo-original-${size}.png`), `service worker app shell pre-caches ${size}x${size} runtime icon`);
}

assert(build.includes("public\\icon.png"), 'EXE file icon is generated from the canonical HNL logo source');
assert(build.includes('Write-HnlIcoFromPng'), 'build generates a native multi-resolution ICO from the HNL logo');
for (const size of [16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 256]) {
  assert(build.includes(String(size)), `ICO generation includes ${size}x${size} frame`);
  assert(iconGolden.includes(String(size)), `runtime EXE icon golden verifies ${size}x${size} extraction`);
}
assert(!build.includes('Optimize-HnlSmallIconFrame'), 'Windows EXE small frames are not visually altered by a custom sharpening/contrast pass');
assert(build.includes('Generated multi-resolution ICO'), 'build reports generated HQ ICO evidence');
assert(!fs.existsSync('desktop-wrapper/QLTCAnPhu.ico'), 'obsolete 854-byte blurry launcher ICO is removed from source');
assert(iconGolden.includes('PrivateExtractIcons'), 'runtime golden extracts icons directly from the built EXE using Win32');
assert(iconGolden.includes('hnl-logo-original-') && iconGolden.includes('$runtimeSizes = @(16,20,24,28,32,40,48)'), 'Windows golden validates exact runtime frames derived from the canonical HNL logo');
assert(iconGolden.includes('runtime-original-logo-contact-sheet.png'), 'Windows golden emits dedicated original-logo runtime contact-sheet evidence');
assert(iconGolden.includes('icon-contact-sheet.png'), 'runtime golden creates visual contact-sheet evidence');

assert(workflow.includes('- dev') && workflow.includes('- main'), 'Windows EXE CI runs on both DEV certification pushes and main releases');
assert(workflow.includes('windows-latest'), 'Windows GitHub runner is used');
assert(workflow.includes('npm run test:stability'), 'EXE CI includes stability gate');
assert(workflow.includes('npm run typecheck') && workflow.includes('npm run lint'), 'EXE CI includes TypeScript and lint');
assert(workflow.includes('npm run build'), 'EXE CI certifies web build before launcher packaging');
assert(workflow.includes('windows-icon-golden.ps1'), 'EXE CI runs Windows icon golden gate after packaging');
assert(workflow.includes('windows-desktop-local-store-golden.ps1'), 'EXE CI runs Windows SQLite workspace runtime golden');
assert(workflow.includes('icon-golden-evidence'), 'EXE CI uploads icon visual evidence');
assert(workflow.includes('HNL-QLTC-Windows.exe'), 'EXE artifact is uploaded');
console.log('DESKTOP LAUNCHER GOLDEN PASS');