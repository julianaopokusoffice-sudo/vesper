import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS, ensureDirs } from './paths.ts';

/**
 * Secrets are encrypted at rest with AES-256-GCM. The key is a 32-byte random
 * value stored next to the database with 0600 permissions, stretched per-value
 * with scrypt. This protects against casual disk/backup exposure — it is not a
 * hardware enclave. The Electron build can additionally bind the key to the OS
 * keychain (see electron/main.cjs).
 */
function masterKey(): Buffer {
  ensureDirs();
  if (!existsSync(PATHS.keyfile)) {
    writeFileSync(PATHS.keyfile, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(PATHS.keyfile, 'utf8').trim(), 'base64');
}

let cachedKey: Buffer | null = null;
function key() {
  cachedKey ??= masterKey();
  return cachedKey;
}

const PREFIX = 'vsp1:';

export function seal(plaintext: string): string {
  if (!plaintext) return '';
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const derived = scryptSync(key(), salt, 32);
  const cipher = createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + [salt, iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function open(sealed: string): string {
  if (!sealed) return '';
  if (!sealed.startsWith(PREFIX)) return sealed; // legacy / plaintext
  try {
    const [salt, iv, tag, data] = sealed.slice(PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64'));
    const derived = scryptSync(key(), salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Show only the tail of a key so the UI can confirm which one is set. */
export function mask(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••';
  return `••••${secret.slice(-4)}`;
}
