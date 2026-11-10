import { motion } from 'motion/react';
import { AudioLines, Command, Globe2, Menu, PanelRight, Telescope, Users2, Zap } from 'lucide-react';
import { useStore } from '@/lib/store';
import { cn, Chip, Glyph, IconButton, Tooltip } from './ui';
import { ProjectMenu } from './ProjectMenu';

export function TopBar() {
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeThreadId);
  const agents = useStore((s) => s.agents);
  const council = useStore((s) => s.council);
  const setCouncil = useStore((s) => s.setCouncil);
  const setMode = useStore((s) => s.setMode);
  const run = useStore((s) => s.run);
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const inspector = useStore((s) => s.inspector);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const setView = useStore((s) => s.setView);
  const setPalette = useStore((s) => s.setPalette);
  const setThreadsOpen = useStore((s) => s.setThreadsOpen);
  const browserAttention = useStore((s) => s.browserAttention);

  const thread = threads.find((t) => t.id === activeId);
  const mode = thread?.mode ?? 'single';
  const primary = agents.find((a) => a.id === thread?.agentId) ?? agents[0];
  const model = primary?.model ?? settings.defaultModel;
  const provider = providers.find((p) => p.id === model?.provider);
  const streaming = run && (run.status === 'streaming' || run.status === 'submitted');

  return (
    <header className="relative z-10 flex h-[54px] shrink-0 items-center gap-2 border-b border-line-soft bg-ink-1000/40 px-3 backdrop-blur-xl sm:gap-3 sm:px-4">
      <button
        onClick={() => setThreadsOpen(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-fg md:hidden"
        aria-label="Open threads"
      >
        <Menu size={17} />
      </button>
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="max-w-[38vw] truncate text-[14px] font-medium tracking-[-0.008em] text-fg sm:max-w-[38ch] sm:text-[14.5px]">
          {thread?.title ?? 'New thread'}
        </h1>
        <span className="hidden shrink-0 font-mono text-[10px] text-faint xl:inline">
          {thread ? `${thread.messageCount ?? 0} msg` : 'unsaved'}
        </span>
      </div>

      {streaming && (
        <div className="flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/[0.07] px-2 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            {run.lanes.filter((l) => l.done).length}/{run.lanes.length} done
          </span>
        </div>
      )}

      <div className="mx-auto flex items-center gap-2">
        <div className="hidden items-center rounded-lg border border-line bg-ink-1000/60 p-0.5 sm:flex">
          {(['single', 'council', 'research'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-[6px] px-2.5 py-[5px] text-[11.5px] font-medium transition-colors',
                mode === value ? 'text-fg' : 'text-muted hover:text-fg-2',
              )}
            >
              {mode === value && (
                <motion.span
                  layoutId="mode-pill"
                  className="absolute inset-0 rounded-[6px] border border-line bg-ink-850 shadow-[0_1px_0_oklch(1_0_0/0.05)_inset]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {value === 'single' ? <Zap size={11} /> : value === 'council' ? <Users2 size={11} /> : <Telescope size={11} />}
                {value === 'single' ? 'Single' : value === 'council' ? 'Council' : 'Research'}
              </span>
            </button>
          ))}
        </div>

        {mode === 'council' && (

          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="hidden items-center rounded-lg border border-line bg-ink-1000/40 px-1 py-0.5 lg:flex"
          >
            {agents.map((agent) => {
              const on = council.includes(agent.id);
              return (
                <Tooltip key={agent.id} text={`${agent.name} · ${agent.role}`}>
                  <button
                    onClick={() => setCouncil(on ? council.filter((id) => id !== agent.id) : [...council, agent.id])}
                    className={cn(
                      'relative -ml-1 rounded-md p-[1px] transition-all first:ml-0',
                      on ? 'opacity-100' : 'opacity-35 hover:opacity-70',
                    )}
                    aria-pressed={on}
                  >
                    <Glyph agent={agent} size="sm" />
                    {on && (
                      <span
                        className="absolute -bottom-[1px] left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full"
                        style={{ background: agent.accent }}
                      />
                    )}
                  </button>
                </Tooltip>
              );
            })}
            <span className="ml-1.5 pr-1 font-mono text-[10px] text-faint">{council.length}</span>
          </motion.div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip text="Browser · shared with agents">
          <button
            onClick={() => setView('browser')}
            aria-label="Browser"
            className="relative grid h-8 w-8 place-items-center rounded-md border border-line bg-ink-900/60 text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <Globe2 size={14} />
            {browserAttention && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_oklch(0.805_0.148_78/0.8)]" />
            )}
          </button>
        </Tooltip>
        <Tooltip text="Voice mode · speak to an agent">
          <button
            onClick={() => setView('voice')}
            aria-label="Voice mode"
            className="grid h-8 w-8 place-items-center rounded-md border border-line bg-ink-900/60 text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <AudioLines size={14} />
          </button>
        </Tooltip>
        <ProjectMenu />
        <Tooltip text={`Model for ${primary?.name ?? 'agent'} — click to change`}>
          <button
            onClick={() => setView('settings')}
            className="hidden items-center gap-1.5 rounded-md border border-line bg-ink-900/60 px-2 py-1 transition-colors hover:border-line-strong sm:flex"
          >
            <span className={cn('h-[5px] w-[5px] rounded-full', provider?.hasKey ? 'bg-ok' : 'bg-accent')} />
            <span className="font-mono text-[10.5px] text-fg-2">{model?.id ?? 'no model'}</span>
            {!provider?.hasKey && <Chip tone="accent">demo</Chip>}
          </button>
        </Tooltip>

        <Tooltip text="Command palette · ⌘K">
          <button
            onClick={() => setPalette(true)}
            className="hidden items-center gap-1.5 rounded-md border border-line bg-ink-900/60 px-2 py-1 text-faint transition-colors hover:border-line-strong hover:text-fg-2 sm:flex"
          >
            <Command size={11} />
            <span className="font-mono text-[10px]">K</span>
          </button>
        </Tooltip>

        <div className="hidden md:block">
          <IconButton label="Inspector" active={inspector} onClick={toggleInspector}>
            <PanelRight size={15} strokeWidth={1.7} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
