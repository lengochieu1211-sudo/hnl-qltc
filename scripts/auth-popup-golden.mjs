import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`AUTH POPUP GOLDEN FAIL: ${message}`);
  console.log(`PASS AUTH: ${message}`);
}

const main = read('src/main.tsx');
const persistence = read('src/lib/authPersistence.ts');
const firebase = read('src/lib/firebase.ts');
const firebaseBase = read('src/lib/firebaseBase.ts');
const app = read('src/App.tsx');
const authGate = read('src/components/AppAuthGate.tsx');
const authHeader = read('src/components/GoogleAuthHeader.tsx');
const androidBuild = read('android-wrapper/build-apk.ps1');
const prodWorkflow = read('.github/workflows/firebase-hosting-merge.yml');
const devBrowser = read('scripts/dev-hosted-browser-golden.mjs');

assert(main.includes("import('./lib/authPersistence')"), 'bootstrap loads Auth persistence preflight');
assert(main.includes('await prepareFirebaseAuthPersistence()'), 'bootstrap awaits Auth persistence before rendering UI');
assert(main.indexOf('await prepareFirebaseAuthPersistence()') < main.indexOf("import('./App.tsx')"), 'Auth persistence is ready before App import/login handlers');
assert(persistence.includes('browserLocalPersistence'), 'Auth prefers browser localStorage persistence');
assert(persistence.includes('browserSessionPersistence'), 'Auth has sessionStorage fallback');
assert(persistence.includes('inMemoryPersistence'), 'Auth has memory fallback when browser storage is unavailable');
assert(persistence.includes('setPersistence(auth'), 'Auth persistence is explicitly set instead of default IndexedDB persistence');
assert(!persistence.includes('indexedDBLocalPersistence'), 'Auth does not select IndexedDB persistence');
assert(firebaseBase.includes('subscribeToFirebaseAuthSettled'), 'Auth exposes a settled observer that waits for persisted Firebase identity restoration');
assert(authGate.includes("type AuthGateState = 'checking' | 'authenticated' | 'offline-remembered' | 'signed-out'"), 'entry gate models checking, signed-in, remembered-offline and signed-out states explicitly');
assert(authGate.includes('data-hnl-auth-gate="checking"'), 'checking auth state uses a dedicated restore splash without rendering the login card');
assert(authGate.includes("data-hnl-auth-gate={state}"), 'signed-out state is rendered by a dedicated full-screen auth surface');
assert(authGate.includes('Đăng nhập với Google'), 'dedicated entry screen exposes one clear Google sign-in action');
assert(authGate.includes('BUILD_METADATA.environment') && authGate.includes("appEnv === 'DEV'") && authGate.includes('DEV'), 'login surface visibly identifies DEV without changing auth logic');
assert(authGate.includes('/icon.png') && authGate.includes('drop-shadow-[') && !authGate.includes('HNL Construction') && !authGate.includes('Công ty Cổ phần Công nghiệp An Phú'), 'login uses the canonical HNL icon borderless in the approved centered blue layout without redundant company/top-left labels');
assert(authHeader.includes("BUILD_METADATA.environment === 'DEV'") && authHeader.includes('DEV'), 'authenticated header keeps a visible DEV badge across Web/APK/EXE');
assert(androidBuild.includes('HNL QLTC DEV') && androidBuild.includes('android:label'), 'Android DEV build rewrites launcher label while PROD keeps its normal label');
assert(authGate.includes('getRememberedVerifiedAuthIdentity'), 'offline entry reuses only the previously verified remembered identity');
assert(app.includes('function AuthenticatedApp()'), 'main project UI is isolated in an authenticated-only component');
assert(app.includes('<AppAuthGate>') && app.includes('<AuthenticatedApp />'), 'root App mounts project UI only through the Auth gate');
assert(devBrowser.includes('verifySignedOutGate'), 'hosted browser golden explicitly verifies the signed-out login-only surface');
assert(devBrowser.includes('seedRememberedOfflineAdmin'), 'hosted browser golden restores a verified offline lease without adding an application auth bypass');
assert(devBrowser.includes('project UI hidden until Google login'), 'hosted browser golden guards against project UI leaking before login');
assert(firebase.includes("export * from './firebaseBase'"), 'Firebase facade delegates all auth/data behavior to one implementation');
assert(!firebase.includes('signInWithPopup(base.auth'), 'Firebase facade does not override Android browser transport separately');
assert(firebaseBase.includes('signInWithRedirect(auth, provider)'), 'shared mobile auth implementation keeps redirect flow');
assert(firebaseBase.includes("provider.setCustomParameters({ prompt: 'select_account' })"), 'Google sign-in always requests account chooser');
assert(firebaseBase.indexOf("provider.setCustomParameters({ prompt: 'select_account' })") < firebaseBase.indexOf('signInWithRedirect(auth, provider)'), 'account chooser is configured before Android/mobile redirect starts');
assert(firebaseBase.includes('signInWithPopup(auth, provider)'), 'shared desktop auth implementation keeps popup flow');
assert(prodWorkflow.includes('VITE_FIREBASE_AUTH_DOMAIN: hnlqltc.web.app'), 'PROD Web Auth helper uses same Firebase Hosting origin');
assert(prodWorkflow.includes('VITE_FIREBASE_PROJECT_ID: com-example-qlct-61329'), 'PROD Firebase project ID is unchanged');
assert(prodWorkflow.includes('VITE_FIREBASE_APP_ID: 1:119152410850:web:c2aee2135428af34ef5ebb'), 'PROD Firebase app ID is unchanged');
assert(firebase.includes('persistentLocalCache()'), 'Firestore persistent IndexedDB offline cache remains enabled through delegated source guard');

console.log('AUTH POPUP GOLDEN PASS');
