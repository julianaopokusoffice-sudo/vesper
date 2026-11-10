import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CornerDownLeft,
  MessagesSquare,
  BookMarked,
  Brain,
  Code2,
  AudioLines,
  Globe2,
  Network,
  PanelRight,
  Plug,
  TerminalSquare,
  Plus,
  Puzzle,
  Search,
  Settings2,
  Sparkles,
  Telescope,
  Timer,
  Users,
  Users2,
} from 'lucide-react';
import { useStore, type View } from '@/lib/store';
import { Glyph, cn } from './ui';
import { relativeTime } from '@/lib/format';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);
  const setView = useStore((s) => s.setView);
  const newThread = useStore((s) => s.newThread);
  const threads = useStore((s) => s.threads);
  const selectThread = useStore((s) => s.selectThread);
  const agents = useStore((s) => s.agents);
  const setThreadAgent = useStore((s) => s.setThreadAgent);
  const setMode = useStore((s) => s.setMode);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: 'new', group: 'Actions', label: 'New thread', hint: '⌘N', icon: <Plus size={13} />, run: () => void newThread() },
      { id: 'council', group: 'Actions', label: 'Switch to council mode', icon: <Users2 size={13} />, run: () => void setMode('council') },
      { id: 'research', group: 'Actions', label: 'Switch to deep research', icon: <Telescope size={13} />, run: () => void setMode('research') },
      { id: 'single', group: 'Actions', label: 'Switch to single agent', icon: <MessagesSquare size={13} />, run: () => void setMode('single') },
      { id: 'inspector', group: 'Actions', label: 'Toggle inspector', icon: <PanelRight size={13} />, run: toggleInspector },
      ...[
        ['chat', 'Threads', <MessagesSquare size={13} key="c" />],
        ['agents', 'Agents', <Users size={13} key="a" />],
        ['skills', 'Skills', <Sparkles size={13} key="s" />],
        ['plugins', 'Plugins', <Puzzle size={13} key="p" />],
        ['memory', 'Memory', <Brain size={13} key="m" />],
        ['library', 'Library', <BookMarked size={13} key="l" />],
        ['workspace', 'Workspace', <Code2 size={13} key="w" />],
        ['browser', 'Browser', <Globe2 size={13} key="b" />],
        ['crew', 'Crew', <TerminalSquare size={13} key="x" />],
        ['voice', 'Voice mode', <AudioLines size={13} key="v" />],
        ['automations', 'Automations', <Timer size={13} key="t" />],
        ['connectors', 'Connectors', <Plug size={13} key="n" />],
        ['link', 'Devices', <Network size={13} key="d" />],
        ['settings', 'Settings', <Settings2 size={13} key="g" />],
      ].map(([view, label, icon]) => ({
        id: `go-${view}`,
        group: 'Navigate',
        label: `Go to ${label}`,
        icon: icon as React.ReactNode,
        run: () => setView(view as View),
      })),
    ];

    const agentCommands: Command[] = agents.map((agent) => ({
      id: `agent-${agent.id}`,
      group: 'Agents',
      label: `Send as ${agent.name}`,
      hint: agent.role,
      icon: <Glyph agent={agent} size="sm" />,
      run: () => {
        void setThreadAgent(agent.id);
        setView('chat');
      },
    }));

    const threadCommands: Command[] = threads.slice(0, 8).map((thread) => ({
      id: `thread-${thread.id}`,
      group: 'Threads',
      label: thread.title,
      hint: relativeTime(thread.updatedAt),
      icon: <ArrowRight size={12} />,
      run: () => void selectThread(thread.id),
    }));

    return [...nav, ...agentCommands, ...threadCommands];
  }, [agents, threads, newThread, setMode, toggleInspector, setView, setThreadAgent, selectThread]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((command) => `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const command = filtered[cursor];
        if (command) {
          command.run();
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, cursor, setOpen]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const command of filtered) {
      const list = map.get(command.group) ?? [];
      list.push(command);
      map.set(command.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  let flatIndex = -1;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <div className="fixed inset-0 bg-ink-1000/70 backdrop-blur-[3px]" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.995 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-ink-900/95 shadow-panel"
          >
            <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
              <Search size={14} className="text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands, agents, threads…"
                className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-faint/80"
              />
              <span className="flex items-center gap-1 font-mono text-[9.5px] text-faint">
                <CornerDownLeft size={10} /> open
              </span>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {groups.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-faint">No matches.</p>}
              {groups.map(([group, items]) => (
                <div key={group} className="mb-1.5">
                  <div className="px-2 py-1">
                    <span className="label">{group}</span>
                  </div>
                  {items.map((command) => {
                    flatIndex += 1;
                    const active = flatIndex === cursor;
                    return (
                      <button
                        key={command.id}
                        data-active={active}
                        onMouseEnter={() => setCursor(filtered.indexOf(command))}
                        onClick={() => {
                          command.run();
                          setOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left transition-colors',
                          active ? 'bg-accent/[0.1] text-fg' : 'text-fg-2 hover:bg-white/[0.04]',
                        )}
                      >
                        <span className={cn('grid h-5 w-5 shrink-0 place-items-center', active ? 'text-accent' : 'text-faint')}>
                          {command.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{command.label}</span>
                        {command.hint && <span className="shrink-0 font-mono text-[10px] text-faint">{command.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-line-soft bg-ink-950/50 px-3 py-1.5 font-mono text-[9.5px] text-faint">
              <span>↑↓ navigate · ↵ run · esc close</span>
              <span>vesper console</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
