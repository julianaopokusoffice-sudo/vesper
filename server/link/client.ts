import { randomUUID } from 'node:crypto';
import { store, type PeerRecord } from '../kernel/store.ts';
import { open as unseal, seal } from '../kernel/secrets.ts';
import { identity, selfNode } from './identity.ts';
import { signBody } from './protocol.ts';
import type { MemoryEntry, NodeKind, NodeScope, PairedNode, RemoteRunResult } from '../../shared/types.ts';

type Peer = PeerRecord;

export class LinkError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) throw new LinkError('Enter the other device’s address, e.g. http://192.168.1.20:8787');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new LinkError(`"${url}" is not a valid address`);
  }
}

async function call<T>(peer: Peer, path: string, body: Record<string, unknown>, timeoutMs = 25_000): Promise<T> {
  const raw = JSON.stringify(body ?? {});
  const secret = unseal(peer.outbound || peer.secret);
  const headers = {
    ...signBody(secret, raw),
    'x-vesper-node': identity().id,
    'x-vesper-name': identity().name,
    'content-type': 'application/json',
  };
  const started = Date.now();
  let ok = false;
  try {
    const res = await fetch(`${peer.url}${path}`, {
      method: 'POST',
      headers,
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    // A capability refusal comes back as { ok: false, output: 'Peer lacks …' };
    // surface that sentence instead of a bare status code.
    if (!res.ok || json.ok === false) {
      throw new LinkError(json.error ?? json.output ?? `Peer responded ${res.status}`, res.status);
    }
    ok = true;
    store().updateNode(peer.id, { lastSeen: Date.now() });
    return json as T;
  } catch (err) {
    if (err instanceof LinkError) throw err;
    const message =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        ? `No response from ${peer.name} within ${Math.round(timeoutMs / 1000)}s. Are you on the same network?`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new LinkError(message);
  } finally {
    store().logLink({
      id: randomUUID(),
      at: Date.now(),
      direction: 'out',
      nodeId: peer.id,
      nodeName: peer.name,
      action: path.replace(/^\//, ''),
      ok,
      detail: '',
      ms: Date.now() - started,
    });
  }
}

export async function pairWithPeer(input: {
  url: string;
  code: string;
  name?: string;
  scopes?: NodeScope[];
}): Promise<PairedNode> {
  const url = normalizeUrl(input.url);
  const scopes: NodeScope[] = input.scopes?.length ? input.scopes : ['memory', 'files', 'agents'];
  const me = selfNode();

  let hello: { ok?: boolean; node?: PairedNode };
  try {
    const res = await fetch(`${url}/link/hello`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    hello = (await res.json()) as typeof hello;
  } catch (err) {
    throw new LinkError(
      `Could not reach ${url}. Check the device is awake, Vesper is running there, and both devices are on the same network. (${
        err instanceof Error ? err.message : 'connection failed'
      })`,
    );
  }
  if (hello.node?.id === me.id) throw new LinkError('That address is this same device.');

  const res = await fetch(`${url}/link/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: input.code.trim(),
      node: {
        id: me.id,
        name: input.name?.trim() || me.name,
        platform: me.platform,
        kind: me.kind,
        url: me.url,
        scopes,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !json.ok) throw new LinkError(json.error ?? 'Pairing refused', res.status);

  const peer = hello.node;
  if (!peer) throw new LinkError('The other device did not identify itself.');

  const record: Peer = {
    id: peer.id,
    name: input.name?.trim() || peer.name || 'Paired device',
    platform: peer.platform || 'unknown',
    kind: (peer.kind as NodeKind) || 'desktop',
    url,
    scopes: Array.isArray(json.scopes) ? json.scopes : [], // what we may do there
    granted: Array.isArray(json.granted) ? json.granted : scopes, // what they may do here
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    // inbound: what the peer presents to us; outbound: what we present to them.
    secret: seal(String(json.peerSecret ?? '')),
    outbound: seal(String(json.secret ?? '')),
  };
  if (!json.secret || !json.peerSecret) throw new LinkError('Pairing succeeded but the key exchange was incomplete. Try again.');
  store().saveNode(record);
  store().logLink({
    id: randomUUID(),
    at: Date.now(),
    direction: 'out',
    nodeId: record.id,
    nodeName: record.name,
    action: 'pair',
    ok: true,
    detail: `can use ${record.scopes.join(', ') || 'nothing'}`,
    ms: 0,
  });
  return record;
}

export async function pingPeer(peer: Peer): Promise<boolean> {
  try {
    await call(peer, '/link/ping', {}, 5000);
    return true;
  } catch {
    return false;
  }
}

export async function probePeer(peer: Peer): Promise<PairedNode> {
  const online = await pingPeer(peer);
  const { secret, outbound, ...rest } = peer;
  return { ...rest, online };
}

export async function invokePeer(
  peer: Peer,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; output: string; ms: number }> {
  return call(peer, '/link/invoke', { tool, args }, 60_000);
}

export async function runTaskOnPeer(peer: Peer, prompt: string, agentId?: string): Promise<RemoteRunResult> {
  const json = await call<{ ok: boolean; output: string; traces?: any[]; ms: number }>(
    peer,
    '/link/task',
    { prompt, agentId },
    180_000,
  );
  return { ok: true, output: json.output ?? '', traces: json.traces, ms: json.ms ?? 0, node: peer.name };
}

export async function syncMemoryWithPeer(peer: Peer): Promise<{ pulled: number; pushed: number }> {
  const since = 0;
  const pulled = await call<{ ok: boolean; entries: MemoryEntry[] }>(peer, '/link/memory/pull', { since }, 30_000);
  let merged = 0;
  for (const entry of pulled.entries ?? []) {
    if (!entry?.id || !entry?.hash) continue;
    const existing = store().getMemory(entry.id);
    if (existing && existing.updatedAt >= entry.updatedAt) continue;
    store().upsertMemory({ ...entry, source: entry.source || peer.name, sourceNodeId: entry.sourceNodeId || peer.id });
    merged += 1;
  }

  const local = store().listMemory({ limit: 500 });
  const push = await call<{ ok: boolean; merged: number }>(peer, '/link/memory/push', { entries: local }, 30_000);
  return { pulled: merged, pushed: push.merged ?? 0 };
}

export async function syncMemoryAll(): Promise<{ node: string; nodeId: string; pulled?: number; pushed?: number; error?: string }[]> {
  const results = [];
  for (const peer of store().listNodes()) {
    try {
      const result = await syncMemoryWithPeer(peer);
      results.push({ node: peer.name, nodeId: peer.id, ...result });
    } catch (err) {
      results.push({ node: peer.name, nodeId: peer.id, error: err instanceof Error ? err.message : 'sync failed' });
    }
  }
  return results;
}

export function peerFromId(idOrName: string): Peer {
  const byId = store().getNode(idOrName);
  if (byId) return byId;
  const byName = store().findNodeByName(idOrName);
  if (byName) return byName;
  throw new LinkError(`No paired device called "${idOrName}". Run \`vesper devices\`.`);
}
