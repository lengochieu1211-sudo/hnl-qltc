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
const build = read('desktop-wrapper/build-launcher.ps1');
const workflow = read('.github/workflows/windows-exe.yml');
const iconGolden = read('scripts/windows-icon-golden.ps1');
const indexHtml = read('index.html');
const manifest = JSON.parse(read('public/manifest.json'));
const releaseTag = read('desktop-wrapper/release-tag.txt').trim();
const iconSource = readPngSize('public/icon.png');
const taskbar192 = readPngSize('public/icon-3d-192.png');
const taskbar512 = readPngSize('public/icon-3d-512.png');

assert(launcher.includes('https://hnlqltc.web.app/?app=desktop'), 'desktop wrapper targets short PROD Hosting');
assert(!launcher.includes('https://com-example-qlct-61329.web.app/?app=desktop'), 'legacy desktop Hosting URL is removed');
assert(launcher.includes('"QLTCAnPhu"') && launcher.includes('"EdgeProfile"'), 'legacy Edge profile path is preserved for local/offline data continuity');
assert(!launcher.includes('Service Worker') && !launcher.includes('CacheStorage'), 'launcher no longer deletes service-worker offline cache on every start');
assert(launcher.includes('Google') && launcher.includes('Chrome'), 'Chrome fallback is available when Edge is unavailable');
assert(launcher.includes('--app='), 'desktop runtime is browser app-mode, so running Taskbar icon is web/PWA-owned');
assert(build.includes('HNL-QLTC-Windows.exe'), 'build script creates one portable Windows EXE');
assert(build.includes('release-tag.txt'), 'build script uses release tag for cache/version isolation');
assert(releaseTag === '6.3.0-rc2.2.16', 'desktop release tag matches RC2.2.16');

assert(iconSource.width >= 1024 && iconSource.height >= 1024 && iconSource.bytes > 1_000_000, 'HQ HNL logo source is retained at >=1024px');
assert(taskbar192.width === 192 && taskbar192.height === 192, 'browser app-mode has dedicated 192x192 HNL icon');
assert(taskbar512.width === 512 && taskbar512.height === 512, 'browser app-mode has dedicated 512x512 HNL icon');
assert(indexHtml.includes('/icon-3d-192.png') && indexHtml.includes('/icon-3d-512.png'), 'running browser app-mode advertises HQ PNG icon sources');
assert(!indexHtml.includes('/favicon-3d.ico'), 'legacy single-frame 16x16 favicon is not used by running app-mode');
const manifestIconSizes = new Set((manifest.icons || []).map((item) => `${item.src}|${item.sizes}`));
assert(manifestIconSizes.has('/icon-3d-192.png|192x192'), 'PWA manifest includes 192x192 HNL icon');
assert(manifestIconSizes.has('/icon-3d-512.png|512x512'), 'PWA manifest includes 512x512 HNL icon');
assert((manifest.icons || []).length === 2, 'PWA manifest has no duplicate icon entry');

assert(build.includes("public\\icon.png"), 'EXE file icon is generated from the canonical HNL logo source');
assert(build.includes('Write-HnlIcoFromPng'), 'build generates a native multi-resolution ICO from the HNL logo');
for (const size of [16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 256]) {
  assert(build.includes(String(size)), `ICO generation includes ${size}x${size} frame`);
  assert(iconGolden.includes(String(size)), `runtime EXE icon golden verifies ${size}x${size} extraction`);
}
assert(build.includes('Optimize-HnlSmallIconFrame'), 'small Windows EXE/taskbar-compatible frames receive dedicated sharpening/contrast optimization');
assert(build.includes('Generated multi-resolution ICO'), 'build reports generated HQ ICO evidence');
assert(!fs.existsSync('desktop-wrapper/QLTCAnPhu.ico'), 'obsolete 854-byte blurry launcher ICO is removed from source');
assert(iconGolden.includes('PrivateExtractIcons'), 'runtime golden extracts icons directly from the built EXE using Win32');
assert(iconGolden.includes('icon-contact-sheet.png'), 'runtime golden creates visual contact-sheet evidence');

assert(workflow.includes('windows-latest'), 'Windows GitHub runner is used');
assert(workflow.includes('npm run test:stability'), 'EXE CI includes stability gate');
assert(workflow.includes('npm run typecheck') && workflow.includes('npm run lint'), 'EXE CI includes TypeScript and lint');
assert(workflow.includes('npm run build'), 'EXE CI certifies web build before launcher packaging');
assert(workflow.includes('windows-icon-golden.ps1'), 'EXE CI runs Windows icon golden gate after packaging');
assert(workflow.includes('icon-golden-evidence'), 'EXE CI uploads icon visual evidence');
assert(workflow.includes('HNL-QLTC-Windows.exe'), 'EXE artifact is uploaded');
console.log('DESKTOP LAUNCHER GOLDEN PASS');
