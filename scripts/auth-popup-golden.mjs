import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(ok, message) {
  if (!ok) throw new Error(`AUTH POPUP GOLDEN FAIL: ${message}`);
  console.log(`PASS AUTH: ${message}`);
}

const main = read('src/main.tsx');
const persistence = read('src/lib/authPersistence.ts');
const firebase = read('src/lib/firebase.ts');

assert(main.includes("import('./lib/authPersistence')"), 'bootstrap loads Auth persistence preflight');
assert(main.includes('await prepareFirebaseAuthPersistence()'), 'bootstrap awaits Auth persistence before rendering UI');
assert(main.indexOf('await prepareFirebaseAuthPersistence()') < main.indexOf("import('./App.tsx')"), 'Auth persistence is ready before App import/login handlers');
assert(persistence.includes('browserLocalPersistence'), 'Auth prefers browser localStorage persistence');
assert(persistence.includes('browserSessionPersistence'), 'Auth has sessionStorage fallback');
assert(persistence.includes('inMemoryPersistence'), 'Auth has memory fallback when browser storage is unavailable');
assert(persistence.includes('setPersistence(auth'), 'Auth persistence is explicitly set instead of default IndexedDB persistence');
assert(!persistence.includes('indexedDBLocalPersistence'), 'Auth popup hotfix does not select IndexedDB persistence');
assert(firebase.includes('persistentLocalCache()'), 'Firestore persistent IndexedDB offline cache remains enabled');

console.log('AUTH POPUP GOLDEN PASS');
