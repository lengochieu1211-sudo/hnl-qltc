/**
 * Cryptographic utility functions using standard Web Crypto API (SubtleCrypto).
 * Provides AES-GCM 256-bit encryption for backups and salted PBKDF2 hashing for PIN app locks.
 * Zero external libraries needed, runs 100% offline and free.
 */

export interface EncryptedBackupPayload {
  isEncrypted: true;
  version: 1;
  algorithm: 'AES-GCM';
  salt: string; // Base64
  iv: string;   // Base64
  ciphertext: string; // Base64
  exportedAt: string;
  appVersion?: string;
  hint?: string;
}

export type EncryptedBackupContainer = EncryptedBackupPayload;

// Convert ArrayBuffer to Base64
function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to Uint8Array
function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives an AES-GCM 256-bit key from a user password and salt using PBKDF2.
 */
async function deriveAesKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/**
 * Encrypts arbitrary JavaScript object data using AES-GCM 256-bit with PBKDF2 key derivation.
 */
export async function encryptBackupData(data: any, password: string, hint?: string): Promise<EncryptedBackupPayload> {
  if (!password || password.trim() === '') {
    throw new Error('Mật khẩu mã hóa không được để trống.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ['encrypt']);

  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const enc = new TextEncoder();
  const encodedData = enc.encode(jsonStr);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    encodedData
  );

  return {
    isEncrypted: true,
    version: 1,
    algorithm: 'AES-GCM',
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(encryptedBuffer),
    exportedAt: new Date().toISOString(),
    hint: hint?.trim() || undefined
  };
}

/**
 * Decrypts an EncryptedBackupPayload using the provided password.
 */
export async function decryptBackupData(payload: EncryptedBackupPayload, password: string): Promise<any> {
  if (!password || password.trim() === '') {
    throw new Error('Vui lòng nhập mật khẩu để giải mã tệp sao lưu.');
  }

  try {
    const salt = base64ToBuffer(payload.salt);
    const iv = base64ToBuffer(payload.iv);
    const ciphertext = base64ToBuffer(payload.ciphertext);

    const key = await deriveAesKey(password, salt, ['decrypt']);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    const jsonStr = dec.decode(decryptedBuffer);
    return JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error('Mật khẩu giải mã không chính xác hoặc tệp sao lưu đã bị thay đổi.');
  }
}

/**
 * Checks if a parsed object is an encrypted backup payload.
 */
export function isEncryptedBackup(obj: any): obj is EncryptedBackupPayload {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    obj.isEncrypted === true &&
    typeof obj.ciphertext === 'string' &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string'
  );
}

// -------------------------------------------------------------
// PIN APP LOCK (PBKDF2 SHA-256 salted hash)
// -------------------------------------------------------------

export interface PinLockConfig {
  enabled: boolean;
  pinHash?: string;
  pinSalt?: string;
  pinOwnerUid?: string;
  pinOwnerEmail?: string;
  autoLockMinutes: number; // 1, 5, 15, or 0 (immediate)
  lockOnBackground: boolean;
  lastUnlockedAt?: number;
}

/**
 * Hashes a 4-6 digit PIN with a unique random salt.
 */
export async function hashPin(pin: string, existingSalt?: string): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder();
  const salt = existingSalt ? base64ToBuffer(existingSalt) : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  return {
    hash: bufferToBase64(derivedBits),
    salt: bufferToBase64(salt)
  };
}

/**
 * Verifies a PIN against the stored salted hash.
 */
export async function verifyPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    const { hash } = await hashPin(pin, storedSalt);
    return hash === storedHash;
  } catch (_) {
    return false;
  }
}
