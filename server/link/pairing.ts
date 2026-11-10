import { randomInt } from 'node:crypto';
import type { NodeScope } from '../../shared/types.ts';

/** No 0/O/1/I: these codes get read aloud and typed on a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_MS = 10 * 60_000;

interface Code {
  code: string;
  scopes: NodeScope[];
  expiresAt: number;
}

let active: Code | null = null;

export function issuePairingCode(scopes: NodeScope[], ttlMs = TTL_MS): Code {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const code: Code = {
    code: `${raw.slice(0, 4)}-${raw.slice(4)}`,
    scopes: scopes.length ? scopes : ['memory', 'files', 'agents'],
    expiresAt: Date.now() + ttlMs,
  };
  active = code;
  return code;
}

export function activePairingCode(): { code: string; expiresAt: number } | undefined {
  if (!active) return undefined;
  if (active.expiresAt < Date.now()) {
    active = null;
    return undefined;
  }
  return { code: active.code, expiresAt: active.expiresAt };
}

export function consumePairingCode(input: string): { ok: true; scopes: NodeScope[] } | { ok: false; reason: string } {
  const code = normalize(input);
  if (!active) return { ok: false, reason: 'No pairing code is active. Generate one on the other device first.' };
  if (active.expiresAt < Date.now()) {
    active = null;
    return { ok: false, reason: 'That pairing code expired. Generate a new one.' };
  }
  if (normalize(active.code) !== code) return { ok: false, reason: 'Wrong pairing code.' };
  const scopes = active.scopes;
  active = null; // single use
  return { ok: true, scopes };
}

export function normalize(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidScope(value: string): value is NodeScope {
  return value === 'memory' || value === 'files' || value === 'shell' || value === 'agents';
}
