export type ContactTarget = {
  name: string;
  phone?: string;
  zaloPhone?: string;
};

export type ContactContext = {
  type?: 'member' | 'defect' | 'crew' | 'journal' | 'room' | 'generic';
  projectId?: string;
  entityId?: string;
  shareText?: string;
  shareUrl?: string;
};

export type NormalizedPhone = {
  original: string;
  digits: string;
  national: string;
  e164: string;
  dial: string;
  valid: boolean;
};

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

const EMPTY_PHONE: NormalizedPhone = {
  original: '',
  digits: '',
  national: '',
  e164: '',
  dial: '',
  valid: false,
};

/**
 * Normalize a Vietnamese phone number for runtime actions only.
 * The original database value must remain unchanged.
 */
export function normalizePhone(input?: string | null): NormalizedPhone {
  const original = String(input || '').trim();
  if (!original) return EMPTY_PHONE;

  const compact = original
    .replace(/[\s.()\-]/g, '')
    .replace(/(?!^)\+/g, '');
  const digits = compact.replace(/\D/g, '');

  let national = '';
  let e164 = '';

  if (/^0\d{9}$/.test(digits)) {
    national = digits;
    e164 = `+84${digits.slice(1)}`;
  } else if (/^84\d{9}$/.test(digits)) {
    national = `0${digits.slice(2)}`;
    e164 = `+${digits}`;
  } else if (/^\d{9}$/.test(digits)) {
    // Accept the common Vietnamese form without the leading zero.
    national = `0${digits}`;
    e164 = `+84${digits}`;
  }

  // Keep non-VN international numbers callable, but do not pretend they are VN numbers.
  const genericInternational = compact.startsWith('+') && digits.length >= 9 && digits.length <= 15
    ? `+${digits}`
    : '';
  const dial = e164 || genericInternational;

  return {
    original,
    digits,
    national,
    e164,
    dial,
    valid: Boolean(dial),
  };
}

export function getContactPhone(target: ContactTarget): NormalizedPhone {
  return normalizePhone(target.zaloPhone || target.phone);
}

export function buildContactShareText(target: ContactTarget): string {
  const phone = normalizePhone(target.phone || target.zaloPhone);
  const lines = [`HNL QLTC – Liên hệ`, `Tên: ${target.name || 'Chưa cập nhật'}`];
  if (phone.original) lines.push(`SĐT: ${phone.original}`);
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    // Fall through to the DOM clipboard fallback.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (_) {
    return false;
  }
}

export function callPhone(input?: string | null): boolean {
  const phone = normalizePhone(input);
  if (!phone.valid) return false;
  window.location.href = `tel:${phone.dial}`;
  return true;
}

function getAndroidContactBridge(): any | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).AndroidContact;
  return bridge && typeof bridge === 'object' ? bridge : null;
}

/** Open Zalo generically. This never targets a private chat or auto-sends a message. */
export function openZalo(): boolean {
  const bridge = getAndroidContactBridge();
  try {
    if (bridge && typeof bridge.openZalo === 'function') {
      return bridge.openZalo() !== false;
    }
  } catch (_) {
    // Continue with the official web entry.
  }

  try {
    const opened = window.open('https://zalo.me/', '_blank', 'noopener,noreferrer');
    return Boolean(opened);
  } catch (_) {
    return false;
  }
}

export async function sharePreparedText(params: {
  title?: string;
  text: string;
  url?: string;
}): Promise<ShareResult> {
  const title = String(params.title || 'HNL QLTC');
  const text = String(params.text || '').trim();
  const url = String(params.url || '').trim();
  const combined = [text, url].filter(Boolean).join('\n');
  if (!combined) return 'failed';

  const bridge = getAndroidContactBridge();
  try {
    if (bridge && typeof bridge.shareText === 'function') {
      const ok = bridge.shareText(title, combined);
      if (ok !== false) return 'shared';
    }
  } catch (_) {
    // Fall through to Web Share / clipboard.
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title,
        text: text || undefined,
        url: url || undefined,
      });
      return 'shared';
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }

  return (await copyText(combined)) ? 'copied' : 'failed';
}
