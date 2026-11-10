import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Brain, Loader2, Pin, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-react';
import type { MemoryEntry, MemoryKind } from '@shared/types';
import { useStore } from '@/lib/store';
import { relativeTime } from '@/lib/format';
import { Button, Chip, Field, Modal, PageHeader, Toggle, cn, inputClass } from './ui';

const KINDS: MemoryKind[] = ['fact', 'decision', 'snippet', 'preference', 'question'];

const KIND_TONE: Record<MemoryKind, 'neutral' | 'accent' | 'ok' | 'cool' | 'violet'> = {
  fact: 'neutral',
  decision: 'accent',
  snippet: 'cool',
  preference: 'ok',
  question: 'violet',
};

export function MemoryView() {
  const memory = useStore((s) => s.memory);
  const link = useStore((s) => s.link);
  const syncMemory = useStore((s) => s.syncMemory);
  const deleteMemory = useStore((s) => s.deleteMemory);
  const toggleMemoryPin = useStore((s) => s.toggleMemoryPin);
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memory.filter((entry) => {
      if (kind !== 'all' && entry.kind !== kind) return false;
      if (!q) return true;
      return `${entry.title} ${entry.body} ${entry.tags.join(' ')}`.toLowerCase().includes(q);
    });
  }, [memory, query, kind]);

  const pinned = memory.filter((e) => e.pinned).length;
  const peers = link?.peers.length ?? 0;

  const syncAll = async () => {
    setSyncing(true);
    try {
      const results = await syncMemory();
      if (!results.length) toast('info', 'No paired devices to sync with yet.');
      else
        toast(
          'success',
          results
            .map((r) => (r.error ? `${r.node}: ${r.error}` : `${r.node}: +${r.pulled ?? 0}${r.error ? '' : ` / ↑${r.pushed ?? 0}`}`))
            .join(' · '),
        );
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader
          title="Memory"
          meta={<Chip tone="accent">{memory.length}</Chip>}
          subtitle="Facts, decisions and preferences that follow you between machines. Memory is injected into every agent prompt, and syncs over the signed device link — no cloud account, no vector database."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={syncAll} disabled={syncing || !peers}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync
              </Button>
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add
              </Button>
            </>
          }
        />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="entries" value={String(memory.length)} icon={<Brain size={11} />} />
          <Stat label="pinned" value={String(pinned)} icon={<Star size={11} />} />
          <Stat label="devices" value={String(peers + 1)} icon={<RefreshCw size={11} />} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="focus-ring flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line bg-ink-1000/40 px-2.5 py-1.5">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, bodies and tags"
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint/80"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>
              all
            </FilterChip>
            {KINDS.map((value) => (
              <FilterChip key={value} active={kind === value} onClick={() => setKind(value)}>
                {value}
              </FilterChip>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-line bg-ink-950/20 px-6 py-12 text-center">
            <Brain size={22} className="mx-auto text-faint" />
            <p className="mt-3 font-serif text-[19px] text-fg">{memory.length ? 'Nothing matches that filter' : 'Memory is empty'}</p>
            <p className="mx-auto mt-1 max-w-[46ch] text-[12px] leading-relaxed text-muted">
              Save the decisions you keep re-explaining, the constraints that are not in the code, and the preferences your
              teammates forget. Agents see them on every run, on every paired device.
            </p>
            <Button variant="subtle" size="sm" className="mt-4" onClick={() => setAdding(true)}>
              <Plus size={12} /> Add the first entry
            </Button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((entry, index) => (
              <motion.article
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.02, 0.16) }}
                className={cn(
                  'group flex flex-col rounded-xl border bg-ink-950/40 p-3.5 transition-colors',
                  entry.pinned ? 'border-accent/25' : 'border-line-soft hover:border-line',
                )}
              >
                <div className="flex items-start gap-2">
                  <Chip tone={KIND_TONE[entry.kind]}>{entry.kind}</Chip>
                  {entry.pinned && <Chip tone="accent">pinned</Chip>}
                  <div className="ml-auto flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => void toggleMemoryPin(entry)}
                      className={cn('grid h-6 w-6 place-items-center rounded hover:bg-white/5', entry.pinned ? 'text-accent' : 'text-faint hover:text-fg')}
                      aria-label={entry.pinned ? 'Unpin' : 'Pin'}
                    >
                      <Pin size={11} fill={entry.pinned ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => void deleteMemory(entry.id)}
                      className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                <h3 className="mt-2 text-[13px] font-medium leading-snug text-fg">{entry.title}</h3>
                <button onClick={() => setExpanded(expanded === entry.id ? null : entry.id)} className="mt-1 text-left">
                  <p className={cn('text-[11.5px] leading-relaxed text-muted', expanded !== entry.id && 'line-clamp-3')}>{entry.body}</p>
                </button>

                {entry.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.tags.map((tag) => (
                      <span key={tag} className="rounded border border-line-soft px-1 py-[1px] font-mono text-[9px] text-faint">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-2.5 flex items-center gap-1.5 border-t border-line-soft pt-2 font-mono text-[9.5px] text-faint">
                  <span className="truncate">{entry.source}</span>
                  <span className="text-faint/40">·</span>
                  <span>{relativeTime(entry.updatedAt)}</span>
                </div>
              </motion.article>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-line-soft bg-ink-950/30 p-4">
          <span className="label">how sync converges</span>
          <div className="mt-2 grid gap-3 text-[11.5px] leading-relaxed text-muted sm:grid-cols-3">
            <p>
              <span className="text-fg-2">Identity.</span> Every entry has a stable id and a content hash. Saving identical text twice
              collapses to one row.
            </p>
            <p>
              <span className="text-fg-2">Merge.</span> Devices exchange entries over the signed link and keep the newest edit per id.
              The source device stays attached, so you can see where a fact came from.
            </p>
            <p>
              <span className="text-fg-2">Prompt.</span> Pinned entries first, then recent ones, capped by count — memory can never
              crowd out the task you are actually doing.
            </p>
          </div>
        </div>
      </div>

      <AddMemoryModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-soft bg-ink-950/30 px-2.5 py-2">
      <span className="label flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="mono mt-0.5 block text-[15px] text-fg">{value}</span>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider transition-colors',
        active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-faint hover:text-fg-2',
      )}
    >
      {children}
    </button>
  );
}

function AddMemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saveMemory = useStore((s) => s.saveMemory);
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() && !body.trim()) return;
    setBusy(true);
    try {
      await saveMemory({ kind, title, body, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), pinned });
      setTitle('');
      setBody('');
      setTags('');
      setPinned(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to shared memory"
      subtitle="Written to this device first, then carried to paired devices on the next sync."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={busy || (!title.trim() && !body.trim())}>
            {busy ? 'Saving…' : 'Save entry'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Kind">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-2 pb-2">
            <span className="text-[11.5px] text-fg-2">Pin to every prompt</span>
            <Toggle checked={pinned} onChange={setPinned} label="Pin" />
          </div>
        </div>
        <Field label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="We deploy behind a private VPN" />
        </Field>
        <Field label="Body" hint="short, specific, load-bearing">
          <textarea
            className={cn(inputClass, 'min-h-[110px] resize-y text-[12px] leading-relaxed')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Staging is only reachable through the bastion at 10.0.0.4. Do not propose public tunnels."
          />
        </Field>
        <Field label="Tags" hint="comma separated">
          <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="infra, deploy, constraints" />
        </Field>
      </div>
    </Modal>
  );
}

export type { MemoryEntry };
