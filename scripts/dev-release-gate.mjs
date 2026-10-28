#!/usr/bin/env node
/**
 * HNL QLTC DEV-only hosting release identity gate.
 * Write at the end of the authorized DEV build; verify the exact deployed
 * commit and the bytes of index.html / entry JS before and after Golden.
 * This script never deploys or mutates Firebase/R2.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireSha = sha => {
  if (!/^[a-f0-9]{40}$/.test(String(sha || ''))) throw new Error('Exact 40-character DEV Git commit SHA is required');
  return sha;
};
const entryFromHtml = html => {
  const m = html.match(/(?:src|href)=["'](\/assets\/[^"']+\.js)["']/);
  if (!m) throw new Error('Cannot find hashed entry JS in index.html');
  return m[1];
};
const checkedAssetPath = path => {
  if (!/^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(path) || path.includes('..')) throw new Error('Unsafe or invalid entry JS path');
  return path;
};
async function generate({ dist, sha, buildId }) {
  requireSha(sha);
  if (!/^\d+-\d+$/.test(String(buildId || ''))) throw new Error('Build ID must be the GitHub run ID and attempt');
  const html = await readFile(join(dist, 'index.html'));
  const entryPath = checkedAssetPath(entryFromHtml(html.toString('utf8')));
  const entry = await readFile(join(dist, entryPath.slice(1)));
  return {
    schema: 1,
    environment: 'DEV',
    firebaseProjectId: 'hnl-qltc-dev',
    gitCommit: sha,
    buildId,
    indexSha256: sha256(html),
    entryPath,
    entrySha256: sha256(entry),
  };
}
async function verify({ url, sha, checkEntry = true, fetchImpl = fetch }) {
  requireSha(sha);
  const origin = new URL(url);
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('HTTPS DEV Hosting is required');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Pass the DEV site origin only');
  const get = async (path, label) => {
    const target = new URL(path, origin);
    target.searchParams.set('devReleaseGate', sha.slice(0, 12));
    const r = await fetchImpl(target, { cache: 'no-store', redirect: 'error' });
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const m = JSON.parse((await get('/hnl-dev-release.json', 'release manifest')).toString('utf8'));
  if (m.schema !== 1 || m.environment !== 'DEV' || m.firebaseProjectId !== 'hnl-qltc-dev' || m.gitCommit !== sha) {
    throw new Error('Wrong/stale DEV release manifest (project, schema or commit)');
  }
  if (!/^\d+-\d+$/.test(String(m.buildId || ''))) throw new Error('Missing DEV release build ID');
  const html = await get('/index.html', 'index.html');
  if (sha256(html) !== m.indexSha256) throw new Error('Hosted index.html does not match certified release');
  const entryPath = checkedAssetPath(entryFromHtml(html.toString('utf8')));
  if (entryPath !== m.entryPath) throw new Error('Hosted entry JS differs from certified release');
  if (checkEntry) {
    const entry = await get(entryPath, 'entry JS');
    if (sha256(entry) !== m.entrySha256) throw new Error('Hosted JS bytes differ from certified release');
  }
  process.stdout.write(`Exact DEV release verified: ${sha} (build ${m.buildId}; entry ${checkEntry ? 'SHA256 verified' : 'path verified'})\n`);
  return m;
}
async function selfTest() {
  const dist = await mkdtemp(join(tmpdir(), 'hnl-dev-release-gate-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/index-foo123.js"></script>');
  await writeFile(join(dist, 'assets/index-foo123.js'), 'console.log("DEV");');
  const sha = 'a'.repeat(40);
  const manifest = await generate({ dist, sha, buildId: '123-1' });
  await writeFile(join(dist, 'hnl-dev-release.json'), JSON.stringify(manifest));
  const server = createServer(async (req, res) => {
    try { const body = await readFile(join(dist, new URL(req.url, 'http://localhost').pathname.slice(1))); res.writeHead(200); res.end(body); }
    catch { res.writeHead(404); res.end('missing'); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await verify({ url, sha });
    let rejected = false;
    try { await verify({ url, sha: 'b'.repeat(40) }); } catch { rejected = true; }
    if (!rejected) throw new Error('Wrong commit was accepted');
    await writeFile(join(dist, 'index.html'), 'tampered');
    rejected = false;
    try { await verify({ url, sha }); } catch { rejected = true; }
    if (!rejected) throw new Error('Tampered index was accepted');
    await writeFile(join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/index-foo123.js"></script>');
    await writeFile(join(dist, 'assets/index-foo123.js'), 'tampered');
    rejected = false;
    try { await verify({ url, sha }); } catch { rejected = true; }
    if (!rejected) throw new Error('Tampered JS was accepted');
    console.log('DEV release gate self-test: PASS (SHA, HTML, JS tampering rejected)');
  } finally { server.close(); }
}
const [, , action, ...flags] = process.argv;
try {
  if (action === 'write') {
    if (process.env.VITE_APP_ENV !== 'DEV' || process.env.DEV_PROJECT_ID !== 'hnl-qltc-dev') throw new Error('DEV-only release manifest guard');
    const dist = resolve('dist');
    const manifest = await generate({ dist, sha: process.env.GITHUB_SHA, buildId: process.env.VITE_BUILD_ID });
    await writeFile(join(dist, 'hnl-dev-release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`DEV release manifest written: ${manifest.gitCommit}`);
  } else if (action === 'verify') {
    if (process.env.GITHUB_REF !== 'refs/heads/dev') throw new Error('Refusing to verify outside the DEV branch');
    await verify({ url: process.env.DEV_HOSTING_URL || 'https://hnl-qltc-dev.web.app/', sha: process.env.GITHUB_SHA, checkEntry: !flags.includes('--light') });
  } else if (action === 'self-test') await selfTest();
  else throw new Error('Usage: node scripts/dev-release-gate.mjs write|verify [--light]|self-test');
} catch (e) { console.error(`DEV release gate: ${e.message}`); process.exitCode = 1; }
