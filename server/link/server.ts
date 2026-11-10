import { Hono, type Context } from 'hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { store, type PeerRecord } from '../kernel/store.ts';
import { open as unseal, seal } from '../kernel/secrets.ts';
import { runLinkTool } from './tools.ts';
import { consumePairingCode } from './pairing.ts';
import { selfNode } from './identity.ts';
import { LINK_VERSION, signature, verifyRequest } from './protocol.ts';
import { runHeadless } from '../agent/orchestrator.ts';
import type { MemoryEntry, NodeKind, NodeScope } from '../../shared/types.ts';

type Peer = PeerRecord;

/**
 * The device-to-device surface. Mounted at /link (not /api) because it is the
 * protocol peers speak, not the UI's API.
 */
export function createLinkRouter() {
  const link = new Hono();

  link.get('/hello', (c) =>
    c.json({
      ok: true,
      protocol: LINK_VERSION,
      node: selfNode(),
      peers: store().listNodes().length,
      authRequired: true,
    }),
  );

  link.post('/pair', async (c) => {
    const raw = await c.req.text();
    let body: {
      code?: string;
      node?: { id?: string; name?: string; platform?: string; kind?: NodeKind; url?: string; scopes?: NodeScope[] };
    };
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return c.json({ ok: false, error: 'Malformed JSON' }, 400);
    }

    const result = consumePairingCode(body.code ?? '');
    if (!result.ok) return c.json({ ok: false, error: result.reason }, 403);

    const requester = body.node ?? {};
    const peerScopes = Array.isArray(requester.scopes) ? requester.scopes : [];
    // One pairing yields two credentials: one the peer presents to us, one we
    // present to the peer. That is what makes control mutual after one code.
    const inbound = randomBytes(32).toString('hex');
    const outbound = randomBytes(32).toString('hex');
    const node: Peer = {
      id: requester.id || randomUUID(),
      name: requester.name?.trim() || 'Paired device',
      platform: requester.platform || 'unknown',
      kind: (requester.kind as NodeKind) || 'desktop',
      url: (requester.url || '').replace(/\/+$/, ''),
      scopes: peerScopes, // what the peer granted us
      granted: result.scopes, // what we grant the peer
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      secret: seal(inbound),
      outbound: seal(outbound),
    };
    // Re-pairing rotates both credentials on both sides.
    store().saveNode(node);
    store().logLink({
      id: randomUUID(),
      at: Date.now(),
      direction: 'in',
      nodeId: node.id,
      nodeName: node.name,
      action: 'pair',
      ok: true,
      detail: `granted ${node.granted.join(', ') || 'nothing'}`,
      ms: 0,
    });

    return c.json({
      ok: true,
      protocol: LINK_VERSION,
      // The plaintext secret goes back exactly once, to the device that paired.
      nodeId: node.id,
      // What the peer presents to us:
      secret: inbound,
      // What we present to the peer:
      peerSecret: outbound,
      peer: selfNode(),
      scopes: result.scopes,
      granted: peerScopes,
    });
  });

  link.post('/ping', (c) => authed(c, async (peer) => {
    store().updateNode(peer.id, { lastSeen: Date.now() });
    return c.json({ ok: true, node: selfNode(), now: Date.now() });
  }));

  link.post('/invoke', (c) => authed(c, async (peer) => {
    const body = await bodyOf(c);
    const result = await runLinkTool({
      tool: String(body.tool ?? ''),
      args: (body.args ?? {}) as Record<string, unknown>,
      scopes: peer.granted,
      peer,
    });
    return c.json(result, result.ok ? 200 : 400);
  }));

  link.post('/task', (c) => authed(c, async (peer) => {
    if (!peer.granted.includes('agents')) {
      return c.json({ ok: false, error: 'This device did not grant the "agents" capability.' }, 403);
    }
    const body = await bodyOf(c);
    const prompt = String(body.prompt ?? '').trim();
    if (!prompt) return c.json({ ok: false, error: 'Empty prompt' }, 400);
    try {
      const result = await runHeadless({
        prompt,
        agentId: body.agentId ? String(body.agentId) : undefined,
        timeoutMs: Math.min(Number(body.timeoutMs) || 120_000, 180_000),
      });
      store().logLink({
        id: randomUUID(),
        at: Date.now(),
        direction: 'in',
        nodeId: peer.id,
        nodeName: peer.name,
        action: 'task',
        ok: true,
        detail: prompt.slice(0, 200),
        ms: result.usage.ms ?? 0,
      });
      return c.json({ ok: true, output: result.content, traces: result.traces, ms: result.usage.ms ?? 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store().logLink({
        id: randomUUID(),
        at: Date.now(),
        direction: 'in',
        nodeId: peer.id,
        nodeName: peer.name,
        action: 'task',
        ok: false,
        detail: message.slice(0, 200),
        ms: 0,
      });
      return c.json({ ok: false, error: message }, 400);
    }
  }));

  link.post('/memory/push', (c) => authed(c, async (peer) => {
    if (!peer.granted.includes('memory')) return c.json({ ok: false, error: 'No memory capability' }, 403);
    const body = await bodyOf(c);
    const entries = Array.isArray(body.entries) ? (body.entries as MemoryEntry[]) : [];
    let merged = 0;
    for (const entry of entries.slice(0, 500)) {
      if (!entry?.id || !entry?.hash) continue;
      store().upsertMemory({
        ...entry,
        source: entry.source || peer.name,
        sourceNodeId: entry.sourceNodeId || peer.id,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        pinned: !!entry.pinned,
      });
      merged += 1;
    }
    store().updateNode(peer.id, { lastSeen: Date.now() });
    return c.json({ ok: true, merged });
  }));

  link.post('/memory/pull', (c) => authed(c, async (peer) => {
    if (!peer.granted.includes('memory')) return c.json({ ok: false, error: 'No memory capability' }, 403);
    const body = await bodyOf(c);
    const since = Number(body.since) || 0;
    const entries = store()
      .listMemory({ limit: 500 })
      .filter((entry) => entry.updatedAt > since);
    return c.json({ ok: true, entries, now: Date.now() });
  }));

  return link;
}

async function bodyOf(c: Context): Promise<Record<string, any>> {
  try {
    return (await c.req.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

/**
 * Verifies the signature for a peer request. The raw body must be read once and
 * then re-parsed, so Hono's cached body is used via c.req.text().
 */
async function authed(c: Context, handler: (peer: Peer) => Promise<Response> | Response) {
  const raw = await c.req.text();
  const nodeId = c.req.header('x-vesper-node') ?? '';
  const peer = store().getNode(nodeId);
  if (!peer) return c.json({ ok: false, error: 'Unknown device. Pair again.' }, 401);

  const secret = unseal(peer.secret);
  const verdict = verifyRequest(secret, {
    'x-vesper-ts': c.req.header('x-vesper-ts'),
    'x-vesper-nonce': c.req.header('x-vesper-nonce'),
    'x-vesper-sig': c.req.header('x-vesper-sig'),
  }, raw);
  if (!verdict.ok) {
    if (process.env.VESPER_LINK_DEBUG) {
      console.error('[link] auth failed', {
        node: peer.id,
        reason: verdict.reason,
        secretLength: secret.length,
        rawLength: raw.length,
        sig: c.req.header('x-vesper-sig')?.slice(0, 12),
        expected: signature(secret, c.req.header('x-vesper-ts') ?? '', c.req.header('x-vesper-nonce') ?? '', raw).slice(0, 12),
      });
    }
    store().logLink({
      id: randomUUID(),
      at: Date.now(),
      direction: 'in',
      nodeId: peer.id,
      nodeName: peer.name,
      action: 'auth',
      ok: false,
      detail: verdict.reason,
      ms: 0,
    });
    return c.json({ ok: false, error: verdict.reason }, 401);
  }
  return handler(peer);
}

