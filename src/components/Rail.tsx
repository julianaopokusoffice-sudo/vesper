import { useEffect, useState } from 'react';
import { BookMarked, Boxes, Brain, Clapperboard, Code2, Command, Globe2, MessagesSquare, Network, Package, Plug, Puzzle, Settings2, Sparkles, TerminalSquare, Timer, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore, type View } from '@/lib/store';
import { Mark } from './Mark';
import { cn, Tooltip } from './ui';

const PRIMARY: { id: View; icon: typeof MessagesSquare; label: string }[] = [
  { id: 'chat', icon: MessagesSquare, label: 'Threads' },
  { id: 'agents', icon: Users, label: 'Agents' },
  { id: 'skills', icon: Sparkles, label: 'Skills' },
  { id: 'plugins', icon: Puzzle, label: 'Plugins' },
  { id: 'memory', icon: Brain, label: 'Memory' },
  { id: 'library', icon: BookMarked, label: 'Library' },
  { id: 'workspace', icon: Code2, label: 'Workspace' },
  { id: 'browser', icon: Globe2, label: 'Browser' },
  { id: 'crew', icon: TerminalSquare, label: 'Crew' },
  { id: 'automations', icon: Timer, label: 'Automations' },
  { id: 'connectors', icon: Plug, label: 'Connectors' },
  { id: 'studio', icon: Clapperboard, label: 'Studio' },
  { id: 'artifacts', icon: Package, label: 'Deliverables' },
  { id: 'link', icon: Network, label: 'Devices' },
];

export function Rail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const providers = useStore((s) => s.providers);
  const setPalette = useStore((s) => s.setPalette);
  const peers = useStore((s) => s.link?.peers ?? []);
  const active = providers.find((p) => p.hasKey) ?? providers.find((p) => p.id === 'demo');
  const onlinePeers = peers.filter((p) => p.online).length;
  const browserAttention = useStore((s) => s.browserAttention);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    api
      .update()
      .then((info) => setUpdateAvailable(info.available))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <nav className="relative z-20 hidden w-[62px] shrink-0 flex-col items-center gap-1 border-r border-line-soft bg-ink-950/60 py-3 backdrop-blur-xl md:flex">
        <div className="mb-3 grid h-9 w-9 place-items-center">
          <Mark size={26} className="drop-shadow-[0_0_14px_oklch(0.805_0.148_78/0.35)]" />
        </div>

        {PRIMARY.map(({ id, icon: Icon, label }) => (
          <Tooltip key={id} text={label} side="right">
            <button
              onClick={() => setView(id)}
              aria-label={label}
              className={cn(
                'group relative grid h-10 w-10 place-items-center rounded-xl transition-all duration-150',
                view === id ? 'bg-ink-850 text-accent' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
              )}
            >
              {view === id && (
                <span className="absolute -left-[13px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-accent shadow-[0_0_10px_oklch(0.805_0.148_78/0.7)]" />
              )}
              <Icon size={17} strokeWidth={1.7} />
              {id === 'link' && onlinePeers > 0 && (
                <span className="absolute right-1.5 top-1.5 h-[5px] w-[5px] rounded-full bg-ok" />
              )}
              {id === 'browser' && browserAttention && (
                <span className="absolute right-1.5 top-1.5 h-[5px] w-[5px] rounded-full bg-accent shadow-[0_0_8px_oklch(0.805_0.148_78/0.8)]" />
              )}
            </button>
          </Tooltip>
        ))}

        <div className="my-1 h-px w-6 bg-line-soft" />

        <Tooltip text="Command palette" side="right">
          <button
            onClick={() => setPalette(true)}
            aria-label="Command palette"
            className="grid h-10 w-10 place-items-center rounded-xl text-muted transition-colors hover:bg-white/[0.04] hover:text-fg"
          >
            <Command size={16} strokeWidth={1.7} />
          </button>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip text={`${active?.label ?? 'No provider'}${active?.hasKey ? '' : ' · demo'}`} side="right">
          <div className="mb-1 grid h-8 w-8 place-items-center rounded-lg border border-line bg-ink-900/70">
            <span className={cn('h-[6px] w-[6px] rounded-full', active?.hasKey ? 'bg-ok pulse-dot' : 'bg-accent pulse-dot')} />
          </div>
        </Tooltip>

        <Tooltip text="Settings" side="right">
          <button
            onClick={() => setView('settings')}
            aria-label="Settings"
            className={cn(                'relative grid h-10 w-10 place-items-center rounded-xl transition-colors',
                view === 'settings' ? 'bg-ink-850 text-accent' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
            )}
          >
            <Settings2 size={17} strokeWidth={1.7} />
            {updateAvailable && (
              <span className="absolute right-1.5 top-1.5 h-[5px] w-[5px] rounded-full bg-accent shadow-[0_0_8px_oklch(0.805_0.148_78/0.8)]" />
            )}
          </button>
        </Tooltip>

        <Tooltip text={`${peers.length} paired · local-first`} side="right">
          <div className="mt-1 grid h-7 w-7 place-items-center rounded-full border border-line bg-ink-850">
            <Boxes size={13} className="text-faint" />
          </div>
        </Tooltip>
      </nav>

      {/* Mobile: thumb-reachable bottom bar. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(58px+env(safe-area-inset-bottom))] items-center justify-around border-t border-line bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {/* Phones get the daily loop — chat, agents, memory, devices — not the
            editing suite. The studio is a desktop surface by design. */}
        {[
          PRIMARY.find((item) => item.id === 'chat')!,
          PRIMARY.find((item) => item.id === 'agents')!,
          PRIMARY.find((item) => item.id === 'memory')!,
          PRIMARY.find((item) => item.id === 'link')!,
          { id: 'settings' as View, icon: Settings2, label: 'Settings' },
        ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-label={label}
              className={cn(
                'relative flex h-full flex-1 flex-col items-center justify-center gap-1 transition-colors',
                view === id ? 'text-accent' : 'text-muted',
              )}
            >
              {view === id && <span className="absolute top-0 h-[2px] w-8 rounded-b bg-accent shadow-[0_0_10px_oklch(0.805_0.148_78/0.7)]" />}
              <Icon size={18} strokeWidth={1.8} />
              <span className="font-mono text-[8.5px] uppercase tracking-[0.08em]">{label}</span>
              {id === 'link' && onlinePeers > 0 && (
                <span className="absolute right-1/4 top-3 h-[5px] w-[5px] rounded-full bg-ok" />
              )}
            </button>
          ),
        )}
      </nav>
    </>
  );
}
