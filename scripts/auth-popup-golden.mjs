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
const prodWorkflow = read('.github/workflows/firebase-hosting-merge.yml');

assert(main.includes("import('./lib/authPersistence')"), 'bootstrap loads Auth persistence preflight');
assert(main.includes('await prepareFirebaseAuthPersistence()'), 'bootstrap awaits Auth persistence before rendering UI');
assert(main.indexOf('await prepareFirebaseAuthPersistence()') < main.indexOf("import('./App.tsx')"), 'Auth persistence is ready before App import/login handlers');
assert(persistence.includes('browserLocalPersistence'), 'Auth prefers browser localStorage persistence');
assert(persistence.includes('browserSessionPersistence'), 'Auth has sessionStorage fallback');
assert(persistence.includes('inMemoryPersistence'), 'Auth has memory fallback when browser storage is unavailable');
assert(persistence.includes('setPersistence(auth'), 'Auth persistence is explicitly set instead of default IndexedDB persistence');
assert(!persistence.includes('indexedDBLocalPersistence'), 'Auth does not select IndexedDB persistence');
assert(firebase.includes("export * from './firebaseBase'"), 'Firebase facade delegates all auth/data behavior to one implementation');
assert(!firebase.includes('signInWithPopup(base.auth'), 'Firebase facade does not override Android browser transport separately');
assert(firebaseBase.includes('signInWithRedirect(auth, provider)'), 'shared mobile auth implementation keeps redirect flow');
assert(firebaseBase.includes('signInWithPopup(auth, provider)'), 'shared desktop auth implementation keeps popup flow');
assert(prodWorkflow.includes('VITE_FIREBASE_AUTH_DOMAIN: hnlqltc.web.app'), 'PROD Web Auth helper uses same Firebase Hosting origin');
assert(prodWorkflow.includes('VITE_FIREBASE_PROJECT_ID: com-example-qlct-61329'), 'PROD Firebase project ID is unchanged');
assert(prodWorkflow.includes('VITE_FIREBASE_APP_ID: 1:119152410850:web:c2aee2135428af34ef5ebb'), 'PROD Firebase app ID is unchanged');
assert(firebase.includes('persistentLocalCache()'), 'Firestore persistent IndexedDB offline cache remains enabled through delegated source guard');

console.log('AUTH POPUP GOLDEN PASS');
