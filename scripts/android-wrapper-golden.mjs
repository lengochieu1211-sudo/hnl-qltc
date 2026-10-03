import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`ANDROID WRAPPER GOLDEN FAIL: ${message}`);
  console.log(`PASS ANDROID WRAPPER: ${message}`);
}

const styles = read('android-wrapper/res/values/styles.xml');
const styles31 = read('android-wrapper/res/values-v31/styles.xml');
const startupWindow = read('android-wrapper/res/drawable/startup_window.xml');
const build = read('android-wrapper/build-apk.ps1');
const workflow = read('.github/workflows/android-apk-dev.yml');
const mainActivity = read('android-wrapper/src/com/qlct/app/MainActivity.java');

assert(styles.includes('@drawable/startup_window'), 'pre-Android-12 launch window uses branded startup drawable');
assert(styles31.includes('android:windowSplashScreenBackground'), 'Android 12+ system splash has explicit background');
assert(styles31.includes('android:windowSplashScreenAnimatedIcon'), 'Android 12+ system splash uses HNL launcher icon');
assert(startupWindow.includes('@mipmap/ic_launcher'), 'startup drawable uses canonical HNL launcher icon');
assert(mainActivity.includes('createStartupSplashView()') && mainActivity.includes('webView.setVisibility(View.INVISIBLE)'), 'native splash remains above hidden WebView during cold start');
assert(mainActivity.includes('onPageCommitVisible') && mainActivity.includes('showStartupContent()'), 'native splash hands off only when WebView content becomes visible');

assert(build.includes('QLCT_ANDROID_VERSION_CODE'), 'APK builder accepts workflow-controlled monotonic versionCode');
assert(build.includes('2100000000'), 'APK builder validates Android versionCode upper bound');

assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_BASE64'), 'DEV workflow uses dedicated DEV keystore secret');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow uses dedicated DEV keystore password secret');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEY_ALIAS'), 'DEV workflow uses dedicated DEV key alias secret');
assert(workflow.includes('QLCT_ANDROID_VERSION_CODE: 900${{ github.run_number }}'), 'DEV workflow increments versionCode per build');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_BASE64'), 'DEV workflow never consumes PROD keystore secret');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow never consumes PROD keystore password secret');
assert(workflow.includes('one-off development key and may require uninstall'), 'DEV build clearly warns when fixed signing is not configured');

console.log('ANDROID WRAPPER GOLDEN PASS');
