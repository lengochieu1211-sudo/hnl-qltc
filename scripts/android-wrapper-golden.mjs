import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`ANDROID WRAPPER GOLDEN FAIL: ${message}`);
  console.log(`PASS ANDROID WRAPPER: ${message}`);
}

const styles = read('android-wrapper/res/values/styles.xml');
const styles31 = read('android-wrapper/res/values-v31/styles.xml');
const startupWindow = read('android-wrapper/res/drawable/startup_window.xml');
const workflow = read('.github/workflows/android-apk-dev.yml');
const mainActivity = read('android-wrapper/src/com/qlct/app/MainActivity.java');

assert(styles.includes('@drawable/startup_window'), 'pre-Android-12 launch window uses branded startup drawable');
assert(styles31.includes('android:windowSplashScreenBackground'), 'Android 12+ system splash has explicit background');
assert(styles31.includes('android:windowSplashScreenAnimatedIcon'), 'Android 12+ system splash uses HNL launcher icon');
assert(startupWindow.includes('@mipmap/ic_launcher'), 'startup drawable uses canonical HNL launcher icon');
assert(mainActivity.includes('createStartupSplashView()') && mainActivity.includes('webView.setVisibility(View.INVISIBLE)'), 'native splash stays above hidden WebView during cold start');
assert(mainActivity.includes('onPageCommitVisible') && mainActivity.includes('showStartupContent()'), 'native splash hands off only when WebView content becomes visible');

assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_BASE64'), 'DEV workflow supports a dedicated fixed DEV keystore');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow supports a dedicated DEV keystore password');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEY_ALIAS'), 'DEV workflow supports a dedicated DEV key alias');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_BASE64'), 'DEV workflow does not consume the PROD keystore secret');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow does not consume the PROD keystore password secret');
assert(workflow.includes('one-off DEV key'), 'DEV workflow warns when fixed signing is not configured');

console.log('ANDROID WRAPPER GOLDEN PASS');
