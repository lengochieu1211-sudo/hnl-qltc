import { APP_VERSION } from '../config/appVersion';
import { CURRENT_DATA_SCHEMA_VERSION } from '../config/dataSchema';
import { getRuntimeBuildMetadata } from '../config/buildMetadata';

const LOG_KEY = 'qlct_runtime_diagnostics_v1';
const MAX_ENTRIES = 200;

export interface RuntimeDiagnosticEntry {
  at: number;
  level: 'info' | 'warn' | 'error';
  area: string;
  message: string;
  projectId?: string;
  code?: string;
}

function sanitizeText(value: unknown, max = 300): string {
  return String(value ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, max);
}

function sanitizeDiagnosticValue(value: unknown, keyHint = '', depth = 0): unknown {
  if (depth > 5) return '[truncated-depth]';
  if (/api.?key|token|secret|password|authorization|credential/i.test(keyHint)) return '[redacted]';
  if (typeof value === 'string') return sanitizeText(value, 1000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item, keyHint, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 150).forEach(([key, item]) => {
      out[key] = sanitizeDiagnosticValue(item, key, depth + 1);
    });
    return out;
  }
  return sanitizeText(value, 1000);
}

export function appendRuntimeDiagnostic(entry: Omit<RuntimeDiagnosticEntry, 'at'> & { at?: number }): void {
  if (typeof window === 'undefined') return;
  try {
    const current = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    const list: RuntimeDiagnosticEntry[] = Array.isArray(current) ? current : [];
    list.push({
      at: Number(entry.at || Date.now()),
      level: entry.level,
      area: sanitizeText(entry.area, 80),
      message: sanitizeText(entry.message),
      ...(entry.projectId ? { projectId: sanitizeText(entry.projectId, 100) } : {}),
      ...(entry.code ? { code: sanitizeText(entry.code, 100) } : {}),
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch (_) {
    // Diagnostics are best-effort and must never crash the app.
  }
}

export function getRuntimeDiagnostics(): RuntimeDiagnosticEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch (_) {
    return [];
  }
}

export function clearRuntimeDiagnostics(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(LOG_KEY); } catch (_) {}
}

export function buildDiagnosticBundle(extra: Record<string, unknown> = {}) {
  return {
    appVersion: APP_VERSION,
    ...getRuntimeBuildMetadata(),
    dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    ...(sanitizeDiagnosticValue(extra) as Record<string, unknown>),
    runtimeLog: getRuntimeDiagnostics(),
  };
}
