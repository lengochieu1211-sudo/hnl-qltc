import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`ANDROID WRAPPER GOLDEN FAIL: ${message}`);
  console.log(`PASS ANDROID WRAPPER: ${message}`);
}

const styles = read('android-wrapper/res/values/styles.xml');
const styles31 = read('android-wrapper/res/values-v31/styles.xml');
const startupWindow = read('android-wrapper/res/drawable/startup_window.xml');
const splashLogo = read('android-wrapper/res/drawable/splash_logo.xml');
const startupColors = read('android-wrapper/res/values/colors.xml');
const startupColorsNight = read('android-wrapper/res/values-night/colors.xml');
const mainTsx = read('src/main.tsx');
const workflow = read('.github/workflows/android-apk-dev.yml');
const mainActivity = read('android-wrapper/src/com/qlct/app/MainActivity.java');

assert(styles.includes('@drawable/startup_window'), 'pre-Android-12 launch window uses branded startup drawable');
assert(styles31.includes('android:windowSplashScreenBackground') && styles31.includes('@color/hnl_startup_background'), 'Android 12+ system splash uses the shared startup background');
assert(styles31.includes('android:windowSplashScreenAnimatedIcon') && styles31.includes('@drawable/splash_logo'), 'Android 12+ system splash uses the padded HNL splash logo');
assert(startupWindow.includes('@color/hnl_startup_background') && startupWindow.includes('@drawable/splash_logo'), 'launch window uses the same shared background and padded logo');
assert(splashLogo.includes('android:insetLeft="20dp"') && splashLogo.includes('@mipmap/ic_launcher'), 'splash logo keeps a 20dp safe inset around the canonical HNL icon');
assert(startupColors.includes('#F8FAFC') && startupColorsNight.includes('#0F172A'), 'light/dark startup backgrounds are explicitly aligned');
assert(mainActivity.includes('createStartupSplashView()') && mainActivity.includes('webView.setVisibility(View.INVISIBLE)'), 'native splash stays above hidden WebView during cold start');
assert(mainActivity.includes('new AndroidStartupBridge()') && mainActivity.includes('public void markReady()'), 'native wrapper exposes a startup-ready bridge');
assert(!mainActivity.includes('if (allowFallback) showStartupContent();'), 'page commit/finished callbacks cannot reveal WebView before React paints');
assert(mainTsx.includes('notifyAndroidStartupReadyAfterPaint') && mainTsx.includes('AndroidStartup?.markReady?.()'), 'web bootstrap signals native Android only after React paint');
assert(mainTsx.includes('requestAnimationFrame(() =>') && mainTsx.includes('window.requestAnimationFrame(notify)'), 'startup handoff waits two animation frames before splash removal');

assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_BASE64'), 'DEV workflow supports a dedicated fixed DEV keystore');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow supports a dedicated DEV keystore password');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEY_ALIAS'), 'DEV workflow supports a dedicated DEV key alias');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_BASE64'), 'DEV workflow does not consume the PROD keystore secret');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow does not consume the PROD keystore password secret');
assert(workflow.includes('one-off DEV key'), 'DEV workflow warns when fixed signing is not configured');

console.log('ANDROID WRAPPER GOLDEN PASS');
