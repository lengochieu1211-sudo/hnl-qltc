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
// Android 15 (targetSdk 35) forces edge-to-edge. Only the native Activity can
// reliably reserve the OS gesture/three-button nav area on older WebViews.
assert(androidBuild.includes("'--target-sdk-version', '35'"), 'Android build retains targetSdk 35; no API-level rollback to hide navigation overlap');
assert(mainActivity.includes('installAndroid15SystemBarInsets(startupRoot);'), 'Android 15 root must install system-bar inset handling before its WebView is attached');
assert(mainActivity.includes('if (Build.VERSION.SDK_INT < 35) return;'), 'Pre-Android 15 already-inset windows must not receive double padding');
assert(mainActivity.includes('root.setOnApplyWindowInsetsListener((view, insets) -> {'), 'Root must track live Android window insets');
assert(mainActivity.includes('WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()'), 'Inset calculation must cover navigation gestures, three-button nav and display cutouts');
assert(mainActivity.includes('view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)'), 'Native root must protect all edges and keep WebView controls above navigation bar');
assert(mainActivity.includes('return insets;'), 'WebView must still receive IME and other inset notifications');
assert(mainActivity.includes('startupRoot.requestApplyInsets();'), 'Root must request insets immediately after attaching its native content view');
assert(!mainActivity.includes('windowOptOutEdgeToEdgeEnforcement'), 'Never bypass targetSdk 35 edge-to-edge requirements');
const mobileNav = read('src/components/BottomNav.tsx');
assert(mobileNav.includes('fixed bottom-0 left-0 right-0') && mobileNav.includes("paddingBottom: 'env(safe-area-inset-bottom, 0px)'"), 'Web/PWA bottom navigation must retain its existing safe-area behavior');
const app = read('src/App.tsx');
assert(app.includes("const obscured = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);") && app.includes('setIsSoftKeyboardOpen(obscured > 140)'), 'Android keyboard visibility must remain managed by VisualViewport');

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
assert(androidBuild.includes('legacyNoDpiSplash') && androidBuild.includes('legacyNoDpiSystemSplash') && androidBuild.includes('foreach ($legacySplash in @($legacyNoDpiSplash, $legacyNoDpiSystemSplash))') && androidBuild.includes('Remove-Item -LiteralPath $legacySplash -Force'), 'Android build removes stale native/system nodpi splash outputs');

console.log('ANDROID WRAPPER GOLDEN PASS');
