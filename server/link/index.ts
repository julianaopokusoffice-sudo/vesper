import { store, type PeerRecord } from '../kernel/store.ts';
import { identity, selfNode, updateIdentity } from './identity.ts';
import { activePairingCode, issuePairingCode } from './pairing.ts';
import { pairWithPeer, peerFromId, probePeer, syncMemoryAll } from './client.ts';
import type { LinkState, NodeKind, NodeScope, PairedNode } from '../../shared/types.ts';

export { issuePairingCode, activePairingCode } from './pairing.ts';
export {
  pairWithPeer,
  peerFromId,
  peerFromId as peerById,
  probePeer,
  syncMemoryAll,
  invokePeer,
  runTaskOnPeer,
  syncMemoryWithPeer,
} from './client.ts';
export { selfNode, updateIdentity, identity } from './identity.ts';

const ONLINE_WINDOW_MS = 2 * 60_000;

function decorate(node: PeerRecord): PairedNode {
  const { secret: _secret, outbound: _outbound, ...rest } = node;
  return { ...rest, online: Date.now() - node.lastSeen < ONLINE_WINDOW_MS };
}

export function linkState(): LinkState {
  const peers = store().listNodes().map(decorate);
  return {
    self: selfNode(),
    peers,
    audit: store().listLinkAudit(40),
    pairingCode: activePairingCode(),
  };
}

export function nodeKind(value: string): NodeKind {
  return value === 'phone' || value === 'server' ? value : 'desktop';
}

export function parseScopes(value: unknown): NodeScope[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const allowed: NodeScope[] = ['memory', 'files', 'shell', 'agents'];
  return [...new Set(raw.filter((s): s is NodeScope => allowed.includes(s as NodeScope)))];
}

/** Re-derive what peers may do here; changing this revokes instantly. */
export function setGranted(nodeId: string, granted: NodeScope[]): PairedNode | null {
  return store().updateNode(nodeId, { granted });
}

export function renameIdentity(name: string) {
  return updateIdentity({ name: name.trim() || identity().name });
}
