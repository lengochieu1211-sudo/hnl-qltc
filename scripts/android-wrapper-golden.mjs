import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`ANDROID WRAPPER GOLDEN FAIL: ${message}`);
  console.log(`PASS ANDROID WRAPPER: ${message}`);
}

const styles = read('android-wrapper/res/values/styles.xml');
const styles31 = read('android-wrapper/res/values-v31/styles.xml');
const startupWindow = read('android-wrapper/res/drawable/startup_window.xml');
const startupColors = read('android-wrapper/res/values/colors.xml');
const startupColorsNight = read('android-wrapper/res/values-night/colors.xml');
const mainTsx = read('src/main.tsx');
const workflow = read('.github/workflows/android-apk-dev.yml');
const mainActivity = read('android-wrapper/src/com/qlct/app/MainActivity.java');
const androidBuild = read('android-wrapper/build-apk.ps1');

assert(styles.includes('@drawable/startup_window'), 'pre-Android-12 launch window uses branded startup drawable');
assert(styles.includes('android:colorBackground') && styles.includes('@color/hnl_startup_background'), 'legacy launch preview resolves the shared HNL startup background');
assert(styles31.includes('android:colorBackground') && styles31.includes('@color/hnl_startup_background'), 'Android 12+ launch preview resolves the shared HNL startup background before system splash');
assert(styles31.includes('android:windowSplashScreenBackground') && styles31.includes('@color/hnl_startup_background'), 'Android 12+ system splash uses the shared startup background');
assert(styles31.includes('android:windowSplashScreenAnimatedIcon') && styles31.includes('@drawable/hnl_system_splash_logo'), 'Android 12+ system splash uses a separately padded HNL PNG sized to match the native splash');
assert(startupWindow.includes('@color/hnl_startup_background') && startupWindow.includes('@drawable/hnl_splash_logo'), 'launch window uses the same shared background and generated padded logo');
assert(startupColors.includes('#F8FAFC') && startupColorsNight.includes('#0F172A'), 'light/dark startup backgrounds are explicitly aligned');
assert(mainActivity.includes('createStartupSplashView()') && mainActivity.includes('webView.setVisibility(View.INVISIBLE)'), 'native splash stays above hidden WebView during cold start');
assert(mainActivity.includes('new AndroidStartupBridge()') && mainActivity.includes('public void markReady()'), 'native wrapper exposes a startup-ready bridge');
const nativeSplashAttachIndex = mainActivity.indexOf('setContentView(startupRoot);');
const coldWebViewCreateIndex = mainActivity.indexOf('webView = new WebView(this);');
assert(nativeSplashAttachIndex >= 0 && coldWebViewCreateIndex > nativeSplashAttachIndex, 'native HNL splash is attached before cold WebView construction');
assert(mainActivity.includes('initializeWebRuntime(startupRoot, savedInstanceState)') && mainActivity.includes('32L'), 'cold WebView initialization is deferred until after the first native splash frame');
assert(!mainActivity.includes('if (allowFallback) showStartupContent();'), 'page commit/finished callbacks cannot reveal WebView before React paints');
assert(mainTsx.includes('notifyAndroidStartupReadyAfterPaint') && mainTsx.includes('AndroidStartup?.markReady?.()'), 'web bootstrap signals native Android only after React paint');
assert(mainTsx.includes('requestAnimationFrame(() =>') && mainTsx.includes('window.requestAnimationFrame(notify)'), 'startup handoff waits two animation frames before splash removal');

assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_BASE64'), 'DEV workflow supports a dedicated fixed DEV keystore');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow supports a dedicated DEV keystore password');
assert(workflow.includes('HNL_QLTC_DEV_ANDROID_KEY_ALIAS'), 'DEV workflow supports a dedicated DEV key alias');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_BASE64'), 'DEV workflow does not consume the PROD keystore secret');
assert(!workflow.includes('secrets.QLCT_ANDROID_KEYSTORE_PASSWORD'), 'DEV workflow does not consume the PROD keystore password secret');
assert(workflow.includes('one-off DEV key'), 'DEV workflow warns when fixed signing is not configured');
assert(androidBuild.includes('HNL-QLTC-SPLASH-SOURCE.png') && androidBuild.includes("9ab45895172034ccb4e1386a41a49e5222a32310dc30b48f5b2cea6e14a5c34d"), 'Android splash is pinned to the user-approved 1254px Drive master');
assert(androidBuild.includes("'drawable-mdpi' = @{ Canvas = 288; Logo = 172; SystemLogo = 104 }") && androidBuild.includes("'drawable-xxxhdpi' = @{ Canvas = 1152; Logo = 688; SystemLogo = 416 }"), 'Android native/system splashes build density-aware PNGs from the same master without high-DPI upscaling');
assert(androidBuild.includes("hnl_system_splash_logo.png") && androidBuild.includes('Android system splash densities: mdpi=288/104'), 'Android system splash has extra safe-area padding to avoid a large-to-small logo jump');
assert(androidBuild.includes('legacyNoDpiSplash') && androidBuild.includes('Remove-Item -LiteralPath $legacyNoDpiSplash -Force'), 'Android build removes stale APK383 nodpi splash output');

console.log('ANDROID WRAPPER GOLDEN PASS');
