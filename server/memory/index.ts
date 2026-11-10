import { createHash, randomUUID } from 'node:crypto';
import { store } from '../kernel/store.ts';
import { selfNode } from '../link/identity.ts';
import type { MemoryEntry, MemoryKind } from '../../shared/types.ts';

export function hashEntry(input: { kind: string; title: string; body: string }): string {
  return createHash('sha256')
    .update(`${input.kind}\u0000${input.title.trim()}\u0000${input.body.trim()}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Memory is deliberately small and boring: titled notes with tags, a source
 * device, and a content hash. Two devices converge by last-write-wins per id,
 * and identical content collapses onto the existing row instead of duplicating
 * — which is what makes "sync my memory" safe to run repeatedly.
 */
export function saveMemory(input: {
  kind?: MemoryKind;
  title: string;
  body: string;
  tags?: string[];
  pinned?: boolean;
  source?: string;
  sourceNodeId?: string;
  id?: string;
  createdAt?: number;
  updatedAt?: number;
}): MemoryEntry {
  const now = Date.now();
  const title = input.title.trim();
  const body = (input.body ?? '').trim();
  if (!title && !body) throw new Error('Memory needs a title or a body.');
  const kind: MemoryKind = input.kind ?? 'fact';
  const hash = hashEntry({ kind, title: title || body.slice(0, 80), body });

  if (!input.id) {
    const clash = store().findByHash(hash);
    if (clash) {
      // Same content already known (possibly from another device): keep one copy.
      return store().upsertMemory({ ...clash, pinned: clash.pinned || !!input.pinned, updatedAt: Math.max(clash.updatedAt, now) });
    }
  }

  const me = selfNode();
  const entry: MemoryEntry = {
    id: input.id ?? randomUUID(),
    kind,
    title: title || body.slice(0, 80),
    body,
    tags: normalizeTags(input.tags ?? []),
    source: input.source ?? me.name,
    sourceNodeId: input.sourceNodeId ?? me.id,
    pinned: !!input.pinned,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    hash,
  };
  return store().upsertMemory(entry);
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

/**
 * The block injected into every system prompt. Pinned entries first, then the
 * most recent ones, hard-capped so memory can never crowd out the actual task.
 */
export function memoryContext(limit = 10): string {
  const entries = store().listMemory({ limit: 200 });
  if (!entries.length) return '';
  const chosen = [...entries.filter((e) => e.pinned), ...entries.filter((e) => !e.pinned)].slice(0, limit);
  if (!chosen.length) return '';
  const lines = chosen.map((entry) => {
    const tags = entry.tags.length ? ` [${entry.tags.join(', ')}]` : '';
    const body = entry.body.replace(/\s+/g, ' ').slice(0, 320);
    return `- (${entry.kind}${tags}) **${entry.title}** — ${body}${entry.body.length > 320 ? '…' : ''}`;
  });
  return ['## Shared memory (accumulated across your paired devices)', ...lines].join('\n');
}

export function memoryStats() {
  const entries = store().listMemory({ limit: 500 });
  const sources = new Set(entries.map((e) => e.source));
  return { count: entries.length, pinned: entries.filter((e) => e.pinned).length, sources: sources.size };
}
