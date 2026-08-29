import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`DESKTOP GOLDEN FAIL: ${message}`);
  console.log(`PASS DESKTOP: ${message}`);
}

const launcher = read('desktop-wrapper/QLTCAnPhuLauncher.cs');
const build = read('desktop-wrapper/build-launcher.ps1');
const workflow = read('.github/workflows/windows-exe.yml');
const releaseTag = read('desktop-wrapper/release-tag.txt').trim();

assert(launcher.includes('https://hnlqltc.web.app/?app=desktop'), 'desktop wrapper targets short PROD Hosting');
assert(!launcher.includes('https://com-example-qlct-61329.web.app/?app=desktop'), 'legacy desktop Hosting URL is removed');
assert(launcher.includes('"QLTCAnPhu"') && launcher.includes('"EdgeProfile"'), 'legacy Edge profile path is preserved for local/offline data continuity');
assert(!launcher.includes('Service Worker') && !launcher.includes('CacheStorage'), 'launcher no longer deletes service-worker offline cache on every start');
assert(launcher.includes('Google') && launcher.includes('Chrome'), 'Chrome fallback is available when Edge is unavailable');
assert(build.includes('HNL-QLTC-Windows.exe'), 'build script creates one portable Windows EXE');
assert(build.includes('release-tag.txt'), 'build script uses release tag for cache/version isolation');
assert(releaseTag === '6.3.0-rc2.2.7', 'desktop release tag matches RC2.2.7');
assert(workflow.includes('windows-latest'), 'Windows GitHub runner is used');
assert(workflow.includes('npm run test:stability'), 'EXE CI includes stability gate');
assert(workflow.includes('npm run typecheck') && workflow.includes('npm run lint'), 'EXE CI includes TypeScript and lint');
assert(workflow.includes('npm run build'), 'EXE CI certifies web build before launcher packaging');
assert(workflow.includes('HNL-QLTC-Windows.exe'), 'EXE artifact is uploaded');
console.log('DESKTOP LAUNCHER GOLDEN PASS');
