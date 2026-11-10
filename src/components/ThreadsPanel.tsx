import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Pin, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { groupThreads, relativeTime } from '@/lib/format';
import { cn, IconButton, Kbd, Tooltip } from './ui';
import { Wordmark } from './Mark';

export function ThreadsPanel() {
  const threads = useStore((s) => s.threads);
  const agents = useStore((s) => s.agents);
  const activeId = useStore((s) => s.activeThreadId);
  const selectThread = useStore((s) => s.selectThread);
  const newThread = useStore((s) => s.newThread);
  const deleteThread = useStore((s) => s.deleteThread);
  const pinThread = useStore((s) => s.pinThread);
  const app = useStore((s) => s.app);
  const providers = useStore((s) => s.providers);
  const [query, setQuery] = useState('');
  const open = useStore((s) => s.threadsOpen);
  const setOpen = useStore((s) => s.setThreadsOpen);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q) || (t.preview ?? '').toLowerCase().includes(q));
  }, [threads, query]);

  const groups = groupThreads(filtered);
  const demo = !providers.some((p) => p.hasKey);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-1000/70 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[286px] shrink-0 flex-col border-r border-line-soft bg-ink-950/95 backdrop-blur-xl transition-transform duration-200 md:static md:z-10 md:w-[262px] md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
      <div className="flex h-[54px] shrink-0 items-center justify-between px-4">
        <Wordmark />
        <div className="flex items-center gap-1">
          <Tooltip text="New thread · ⌘N">
            <button
              onClick={() => {
                void newThread();
                setOpen(false);
              }}
              className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-ink-900/80 text-muted transition-colors hover:border-accent/40 hover:text-accent"
              aria-label="New thread"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
          <button
            onClick={() => setOpen(false)}
            className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-fg md:hidden"
            aria-label="Close threads"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="focus-ring flex items-center gap-2 rounded-lg border border-line-soft bg-ink-1000/40 px-2.5 py-1.5 transition-all">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads"
            className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-faint/80"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="font-mono text-[10px] text-faint hover:text-fg">
              esc
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-faint">
            {query ? 'No threads match that search.' : 'No threads yet. Start one below.'}
          </p>
        )}

        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="label">{group.label}</span>
              <span className="font-mono text-[10px] text-faint/70">{group.items.length}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((thread) => {
                const agent = agents.find((a) => a.id === thread.agentId);
                const active = thread.id === activeId;
                return (
                  <motion.div
                    key={thread.id}
                    layout="position"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      'group relative rounded-lg border border-transparent px-2 py-[7px] transition-colors',
                      active ? 'border-line bg-ink-850/90' : 'hover:bg-white/[0.03]',
                    )}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 h-[60%] w-[2px] -translate-y-1/2 rounded-r"
                        style={{ background: agent?.accent ?? '#f0b429' }}
                      />
                    )}
                    <button
                      onClick={() => {
                        void selectThread(thread.id);
                        setOpen(false);
                      }}
                      className="block w-full text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-[5px] w-[5px] shrink-0 rounded-full"
                          style={{ background: agent?.accent ?? '#f0b429', opacity: active ? 1 : 0.65 }}
                        />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-[12.5px] leading-5',
                            active ? 'text-fg' : 'text-fg-2 group-hover:text-fg',
                          )}
                        >
                          {thread.title}
                        </span>
                        {thread.mode === 'council' && <Users size={11} className="shrink-0 text-faint" />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 pl-[13px] font-mono text-[10px] text-faint">
                        <span>{relativeTime(thread.updatedAt)}</span>
                        <span className="text-faint/40">·</span>
                        <span className="truncate">{thread.messageCount ?? 0} msg</span>
                      </div>
                    </button>

                    <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => pinThread(thread.id, !thread.pinned)}
                        className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-white/5 hover:text-fg"
                        aria-label={thread.pinned ? 'Unpin' : 'Pin'}
                      >
                        <Pin size={11} className={thread.pinned ? 'text-accent' : ''} fill={thread.pinned ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => deleteThread(thread.id)}
                        className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-danger/10 hover:text-danger"
                        aria-label="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-line-soft p-3">
        <button
          onClick={() => newThread()}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-accent/40 hover:bg-accent/[0.04] hover:text-accent"
        >
          <Plus size={13} /> New thread
        </button>
        <div className="flex items-center justify-between font-mono text-[10px] text-faint">
          <span className="truncate" title={app?.workspace}>
            {demo ? 'offline demo model' : `${providers.find((p) => p.hasKey)?.label}`}
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('h-[5px] w-[5px] rounded-full', demo ? 'bg-accent' : 'bg-ok')} />
            {app?.platform}
          </span>
        </div>
      </div>
      </aside>
    </>
  );
}
