import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Isolate the production TypeScript under Node's built-in type stripping without
// introducing another dependency or modifying production imports. The same source
// is executed, and only its extensionless test-local import is made explicit.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hnl-share-runtime-'));
const root = path.resolve('src/utils');
let shareSource = fs.readFileSync(path.join(root, 'shareUtils.ts'), 'utf8');
shareSource = shareSource.replace("import { sharePreparedText, ShareResult } from './contactUtils';", "import { sharePreparedText } from './contactUtils.ts';\nimport type { ShareResult } from './contactUtils.ts';");
fs.writeFileSync(path.join(scratch, 'shareUtils.ts'), shareSource);
fs.copyFileSync(path.join(root, 'contactUtils.ts'), path.join(scratch, 'contactUtils.ts'));
const { sharePreparedContent } = await import(pathToFileURL(path.join(scratch, 'shareUtils.ts')).href);

const photo = (id) => ({ id, fileName: `${id}.jpg`, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' });
const attachments = [photo('one'), photo('two')];
const request = { title: 'Quân số Đội Châu', text: 'Bản ghi quân số', attachments, allowTextFallback: false };
const setBrowser = (canShare, share) => {
  globalThis.window = {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { canShare, share, userActivation: { isActive: true } } });
};

try {
  let calls = [];
  setBrowser(({ files }) => files.length === 1, async (payload) => { calls.push(payload); });
  let result = await sharePreparedContent(request);
  assert.equal(result.status, 'shared');
  assert.equal(result.requestedFiles, 2);
  assert.equal(result.sharedFiles, 1, 'Single-image fallback must not pretend both photos were shared');
  assert.equal(calls.length, 1, 'Single-image share should open once');
  assert.equal(calls[0].files.length, 1);

  calls = [];
  setBrowser(() => true, async (payload) => { calls.push(payload); });
  result = await sharePreparedContent(request);
  assert.equal(result.status, 'shared');
  assert.equal(result.sharedFiles, 2);
  assert.equal(calls[0].files.length, 2);

  calls = [];
  setBrowser(() => true, async (payload) => {
    calls.push(payload);
    const error = new Error('Share forbidden');
    error.name = 'NotAllowedError';
    throw error;
  });
  result = await sharePreparedContent(request);
  assert.equal(result.status, 'failed');
  assert.equal(calls.length, 1, 'Do not reuse consumed activation');

  calls = [];
  setBrowser(() => false, async (payload) => { calls.push(payload); });
  result = await sharePreparedContent(request);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'browser-file-sharing-unavailable');
  assert.equal(calls.length, 0);

  calls = [];
  setBrowser(() => false, async (payload) => { calls.push(payload); });
  globalThis.window.AndroidContact = { shareFiles: (_title, _text, json) => JSON.parse(json).length === 1 };
  result = await sharePreparedContent(request);
  assert.equal(result.status, 'shared');
  assert.equal(result.sharedFiles, 1);
  assert.equal(calls.length, 0, 'APK must not silently fall through to Web Share');

  globalThis.window.AndroidContact = { shareFiles: () => false };
  result = await sharePreparedContent(request);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'native-share-failed');
  console.log('HNL QLTC share browser/native multi-file fallback runtime golden: PASS');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
