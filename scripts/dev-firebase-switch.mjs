#!/usr/bin/env node
/**
 * Explicit, local-only Firebase DEV target selector.
 * No GitHub push, no Firebase deployment, no database copy, no network calls.
 * The active Vite config is written only to ignored .env.local (NOT .env.production).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEV_TARGETS = Object.freeze({
  primary: 'hnl-qltc-dev',
  backup: 'hnl-qltc-dev-backup',
});
const PROD_PROJECT = 'com-example-qlct-61329';
const HEADER = '# HNL_QLTC_MANAGED_DEV_TARGET=';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export function parseDotEnv(text) {
  const map = new Map();
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`DEV_TARGET_INVALID_ENV_LINE:${trimmed.slice(0, 45)}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (map.has(match[1])) throw new Error(`DEV_TARGET_DUPLICATE_KEY:${match[1]}`);
    map.set(match[1], value);
  }
  return map;
}
function invalid(value) {
  const s = String(value || '').trim();
  return !s || s.includes('YOUR_') || s.includes('<') || s.includes('>') || s.includes('PLACEHOLDER');
}
export function validateDevTarget(text, target) {
  if (!Object.hasOwn(DEV_TARGETS, target)) throw new Error('DEV_TARGET_UNKNOWN_TARGET');
  const values = parseDotEnv(text);
  const value = k => values.get(k) || '';
  if (value('VITE_APP_ENV') !== 'DEV') throw new Error('DEV_TARGET_MUST_BE_DEV');
  if (value('VITE_DEV_FIREBASE_TARGET') !== target) throw new Error('DEV_TARGET_MARKER_MISMATCH');
  if (value('VITE_FIREBASE_PROJECT_ID') !== DEV_TARGETS[target] || value('VITE_FIREBASE_PROJECT_ID') === PROD_PROJECT) throw new Error('DEV_TARGET_PROJECT_MISMATCH');
  for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID']) {
    if (invalid(value(key))) throw new Error(`DEV_TARGET_MISSING:${key}`);
  }
  if (![`${DEV_TARGETS[target]}.firebaseapp.com`, `${DEV_TARGETS[target]}.web.app`].includes(value('VITE_FIREBASE_AUTH_DOMAIN'))) throw new Error('DEV_TARGET_AUTH_DOMAIN_MISMATCH');
  const bucket = value('VITE_FIREBASE_STORAGE_BUCKET');
  if (bucket && bucket !== `${DEV_TARGETS[target]}.firebasestorage.app` && bucket !== `${DEV_TARGETS[target]}.appspot.com`) throw new Error('DEV_TARGET_STORAGE_BUCKET_MISMATCH');
  if (value('VITE_USE_FIREBASE_EMULATORS') === 'true') throw new Error('DEV_TARGET_EMULATOR_NOT_PRODUCTION_BACKEND');
  if (value('VITE_FIREBASE_FIRESTORE_DATABASE_ID') && value('VITE_FIREBASE_FIRESTORE_DATABASE_ID') !== '(default)') throw new Error('DEV_TARGET_UNEXPECTED_DATABASE');
  // A fallback project on Spark cannot deploy callable Functions and Storage.
  if (target === 'backup') {
    if (value('VITE_WAREHOUSE_TRUSTED_WRITER') !== 'false') throw new Error('DEV_BACKUP_TRUSTED_WRITER_REQUIRES_BLAZE');
    if (value('VITE_HNL_AI_ENABLED') !== 'false') throw new Error('DEV_BACKUP_AI_MUST_BE_DISABLED');
    if (value('VITE_BINARY_STORAGE_PROVIDER') !== 'r2') throw new Error('DEV_BACKUP_FIREBASE_STORAGE_REQUIRES_BLAZE');
  }
  const mediaUrl = value('VITE_R2_GATEWAY_URL');
  if (mediaUrl) {
    if (!/^https:\/\//.test(mediaUrl)) throw new Error('DEV_TARGET_R2_HTTPS_REQUIRED');
    if (target === 'backup' && new URL(mediaUrl).hostname !== 'hnl-qltc-r2-gateway-dev-backup.lengochieu1211.workers.dev') throw new Error('DEV_BACKUP_R2_MUST_BE_SEPARATE');
    if (mediaUrl.includes('hnl-qltc-r2-gateway.lengochieu1211.')) throw new Error('DEV_TARGET_PROD_R2_FORBIDDEN');
  }
  for (const [key, field] of values) {
    if (field.includes(PROD_PROJECT) && key.startsWith('VITE_')) throw new Error('DEV_TARGET_PROD_REFERENCE_FORBIDDEN');
  }
  return {target, projectId:DEV_TARGETS[target], mediaReady: Boolean(mediaUrl), values};
}
export function managedTarget(activeText) {
  const match = String(activeText).split(/\r?\n/,1)[0].match(/^# HNL_QLTC_MANAGED_DEV_TARGET=(primary|backup)$/);
  return match ? match[1] : null;
}

export function switchDevTarget({projectRoot=root, target, dryRun=false}) {
  if (!Object.hasOwn(DEV_TARGETS,target)) throw new Error('DEV_TARGET_UNKNOWN_TARGET');
  const currentPath = path.join(projectRoot,'.env.local');
  const sourcePath = path.join(projectRoot,`.env.dev-${target}.local`);
  if (!fs.existsSync(sourcePath)) throw new Error(`DEV_TARGET_FILE_REQUIRED:${path.basename(sourcePath)}`);
  const sourceText = fs.readFileSync(sourcePath,'utf8');
  const result=validateDevTarget(sourceText,target);
  if (fs.existsSync(currentPath)) {
    const old=fs.readFileSync(currentPath,'utf8');
    if (!managedTarget(old)) throw new Error('DEV_TARGET_REFUSING_UNMANAGED_ENV_LOCAL');
  }
  if (!dryRun) {
    const tmp=path.join(projectRoot,`.env.local.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tmp, `${HEADER}${target}\n${sourceText.trimEnd()}\n`, {mode:0o600,flag:'wx'});
      fs.renameSync(tmp,currentPath);
      fs.chmodSync(currentPath,0o600);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  return {target:result.target,projectId:result.projectId,mediaReady:result.mediaReady,activated:!dryRun};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const command=process.argv[2]||'status';
  try {
    if (command==='status') {
      const active=path.join(root,'.env.local');
      const target=fs.existsSync(active)?managedTarget(fs.readFileSync(active,'utf8')):null;
      console.log(JSON.stringify({target:target||'not-managed',projectId:target?DEV_TARGETS[target]:null,note:'Status of local build config only; this does not query project health or Firebase quota.'},null,2));
    } else if (command==='primary'||command==='backup') {
      const r=switchDevTarget({target:command,dryRun:process.argv.includes('--check')});
      console.log(JSON.stringify({...r,note:'Local .env.local only. Restart the Vite server and use an isolated DEV origin. No deploy, no data migration.'},null,2));
    } else {
      throw new Error('Usage: node scripts/dev-firebase-switch.mjs [status|primary|backup] [--check]');
    }
  } catch(error) {
    console.error(String(error?.message||error));process.exitCode=1;
  }
}
