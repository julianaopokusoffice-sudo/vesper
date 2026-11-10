import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces, hostname, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PATHS } from '../kernel/paths.ts';
import type { NodeKind, PairedNode } from '../../shared/types.ts';

interface Identity {
  id: string;
  name: string;
  kind: NodeKind;
  /** Override the advertised URL, e.g. behind a tunnel. */
  publicUrl?: string;
}

const file = () => join(PATHS.home, 'node.json');
let cached: Identity | null = null;

export function identity(): Identity {
  if (cached) return cached;
  if (existsSync(file())) {
    try {
      const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Identity;
      if (parsed.id) {
        cached = parsed;
        return cached;
      }
    } catch {
      /* regenerate below */
    }
  }
  cached = {
    id: randomUUID(),
    name: defaultName(),
    kind: defaultKind(),
  };
  persist(cached);
  return cached;
}

function persist(next: Identity) {
  cached = next;
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function updateIdentity(patch: Partial<Pick<Identity, 'name' | 'kind' | 'publicUrl'>>): Identity {
  const next = { ...identity(), ...patch };
  persist(next);
  return next;
}

function defaultName(): string {
  const base = hostname().replace(/\.local$/i, '');
  return `${base} · ${defaultKind()}`;
}

function defaultKind(): NodeKind {
  const override = process.env.VESPER_NODE_KIND as NodeKind | undefined;
  if (override === 'phone' || override === 'desktop' || override === 'server') return override;
  if (platform() === 'android') return 'phone';
  if (process.env.VESPER_NODE_KIND === 'server') return 'server';
  return 'desktop';
}

/** Best-effort LAN address peers can reach. Overridable with VESPER_PUBLIC_URL. */
export function advertiseUrl(port = Number(process.env.VESPER_PORT ?? 8787)): string {
  const identityUrl = identity().publicUrl || process.env.VESPER_PUBLIC_URL;
  if (identityUrl) return identityUrl.replace(/\/+$/, '');
  const address = lanAddress();
  return `http://${address}:${port}`;
}

export function lanAddress(): string {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push(net.address);
    }
  }
  // Prefer normal private ranges over link-local / container bridges.
  const preferred = candidates.find((ip) => /^192\.168\./.test(ip)) ?? candidates.find((ip) => /^10\./.test(ip)) ?? candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
  return preferred ?? candidates[0] ?? '127.0.0.1';
}

export function selfNode(): PairedNode {
  const me = identity();
  return {
    id: me.id,
    name: me.name,
    platform: platform(),
    kind: me.kind,
    url: advertiseUrl(),
    scopes: ['memory', 'files', 'shell', 'agents'],
    granted: ['memory', 'files', 'shell', 'agents'],
    pairedAt: 0,
    lastSeen: Date.now(),
    online: true,
    self: true,
  };
}
