import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Every peer-to-peer call is signed with the secret established at pairing time.
 * The signature covers the timestamp, a nonce, and a hash of the raw body, so a
 * captured request cannot be replayed or edited. This is a local-network
 * protocol: it is not a replacement for TLS on an untrusted network.
 */
export const LINK_VERSION = 1;
export const MAX_SKEW_MS = 5 * 60_000;
const NONCE_TTL_MS = 10 * 60_000;

export interface SignedHeaders {
  'x-vesper-node': string;
  'x-vesper-name'?: string;
  'x-vesper-ts': string;
  'x-vesper-nonce': string;
  'x-vesper-sig': string;
}

export function signBody(secret: string, rawBody: string): SignedHeaders {
  const ts = String(Date.now());
  const nonce = createHash('sha256').update(`${Math.random()}${ts}${process.hrtime.bigint()}`).digest('hex').slice(0, 24);
  return {
    'x-vesper-node': '',
    'x-vesper-ts': ts,
    'x-vesper-nonce': nonce,
    'x-vesper-sig': signature(secret, ts, nonce, rawBody),
  };
}

export function signature(secret: string, ts: string, nonce: string, rawBody: string): string {
  const bodyHash = createHash('sha256').update(rawBody ?? '').digest('hex');
  return createHmac('sha256', secret).update(`v${LINK_VERSION}.${ts}.${nonce}.${bodyHash}`).digest('hex');
}

const seenNonces = new Map<string, number>();

export function verifyRequest(
  secret: string,
  headers: Record<string, string | undefined>,
  rawBody: string,
): { ok: true } | { ok: false; reason: string } {
  const ts = headers['x-vesper-ts'];
  const nonce = headers['x-vesper-nonce'];
  const sig = headers['x-vesper-sig'];
  if (!ts || !nonce || !sig) return { ok: false, reason: 'Missing signing headers' };

  const age = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(age) || age > MAX_SKEW_MS) return { ok: false, reason: 'Timestamp outside the allowed window' };

  const expected = signature(secret, ts, nonce, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'Bad signature' };

  const now = Date.now();
  for (const [key, at] of seenNonces) {
    if (now - at > NONCE_TTL_MS) seenNonces.delete(key);
  }
  if (seenNonces.has(nonce)) return { ok: false, reason: 'Replayed nonce' };
  seenNonces.set(nonce, now);
  return { ok: true };
}
