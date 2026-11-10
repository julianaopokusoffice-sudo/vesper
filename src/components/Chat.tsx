import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Sparkles, Telescope, Users2 } from 'lucide-react';
import type { Agent, Message } from '@shared/types';
import { useStore, type Lane } from '@/lib/store';
import { MessageView } from './Message';
import { CouncilGrid, LaneCard } from './Council';
import { Composer } from './Composer';
import { TraceList } from './TraceList';
import { Markdown } from './Markdown';
import { Mark } from './Mark';
import { cn, Chip, Glyph, Kbd } from './ui';
import { Sources } from './Sources';
import { ActivityOrb, activityFor, activityLabel } from './ActivityOrb';

export function ChatView() {
  const messages = useStore((s) => s.messages);
  const run = useStore((s) => s.run);
  const agents = useStore((s) => s.agents);
  const activeId = useStore((s) => s.activeThreadId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const liveText = run?.lanes.reduce((sum, lane) => sum + lane.text.length + lane.traces.length, 0) ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, liveText, pinned, activeId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const nodes = useMemo(() => buildNodes(messages, agents), [messages, agents]);
  const hasContent = messages.length > 0 || !!run;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {!hasContent ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-7 px-4 py-7 sm:px-6">
            {nodes}
            {run && <LiveRun />}
            <div className="h-2" />
          </div>
        )}
      </div>

      <AnimatePresence>
        {!pinned && hasContent && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              setPinned(true);
            }}
            className="absolute bottom-[104px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-ink-900/95 px-2.5 py-1 text-[10.5px] text-muted shadow-panel backdrop-blur hover:text-fg"
          >
            <ArrowDown size={11} /> latest
          </motion.button>
        )}
      </AnimatePresence>

      <Composer />
    </div>
  );
}

function buildNodes(messages: Message[], agents: Agent[]) {
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index]!;
    if (message.role === 'user') {
      nodes.push(<MessageView key={message.id} message={message} />);
      index += 1;
      continue;
    }
    if (message.lane === 'agent') {
      const group: Message[] = [];
      while (index < messages.length && messages[index]!.lane === 'agent') {
        group.push(messages[index]!);
        index += 1;
      }
      nodes.push(<CouncilGrid key={group[0]!.id} messages={group} agents={agents} />);
      continue;
    }
    const agent = agents.find((a) => a.id === message.agentId);
    nodes.push(<MessageView key={message.id} message={message} agent={agent} isLast={index === messages.length - 1} />);
    index += 1;
  }
  return nodes;
}

function LiveRun() {
  const run = useStore((s) => s.run)!;
  const agents = useStore((s) => s.agents);
  const lanes = run.lanes;
  const synthesis = lanes.find((lane) => lane.lane === 'synthesis');
  const panel = lanes.filter((lane) => lane.lane !== 'synthesis');

  return (
    <div className="flex flex-col gap-3">
      {run.showOptimistic && run.input && (
        <div className="flex justify-end">
          <div className="max-w-[min(80%,44rem)] rounded-2xl rounded-br-md border border-line bg-ink-850/80 px-3.5 py-2.5 text-[13.5px] leading-[1.6] text-fg whitespace-pre-wrap">
            {run.input}
          </div>
        </div>
      )}

      {run.mode !== 'council' ? (
        <SingleLane lane={panel[0]} research={run.mode === 'research'} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Users2 size={12} className="text-accent" />
            <span className="label">council · {panel.length} lanes</span>
            <span className="h-px flex-1 bg-line-soft" />
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {panel.map((lane, index) => (
              <LaneCard key={lane.agentId} lane={lane} agent={agents.find((a) => a.id === lane.agentId)} index={index} />
            ))}
          </div>
          {synthesis && (
            <div className="grid grid-cols-1">
              <LaneCard lane={synthesis} agent={agents.find((a) => a.id === synthesis.agentId)} index={0} />
            </div>
          )}
          {run.status !== 'error' && !synthesis && panel.every((lane) => lane.done) && panel.length > 1 && (
            <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-ink-950/40 px-3 py-2">
              <ActivityOrb state="weaving" label="chair is merging the answers" />
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted">chair is merging the answers</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SingleLane({ lane, research }: { lane?: Lane; research?: boolean }) {
  const agents = useStore((s) => s.agents);
  const agent = lane ? agents.find((a) => a.id === lane.agentId) : undefined;
  if (!lane) {
    return (
      <div className="flex items-center gap-2 py-6">
        <ActivityOrb state="connecting" label="starting run" />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint">starting run</span>
      </div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col">
      <div className="flex items-center gap-2">
        {agent && <Glyph agent={agent} size="sm" />}
        <span className="text-[12.5px] font-medium text-fg">{agent?.name ?? lane.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{agent?.role ?? ''}</span>
        {research && (
          <Chip tone="accent">
            <Telescope size={8} /> deep research
          </Chip>
        )}
        {!lane.done && (
          <ActivityOrb
            state={activityFor(lane, { research })}
            label={`${agent?.name ?? lane.name} is ${activityLabel(activityFor(lane, { research }))}`}
          />
        )}
        {lane.done && lane.usage && (
          <span className="ml-auto font-mono text-[10px] text-faint">
            {lane.usage.completionTokens} tok{lane.usage.ms ? ` · ${(lane.usage.ms / 1000).toFixed(1)}s` : ''}
          </span>
        )}
      </div>
      <div className="mt-1.5 pl-[34px]">
        {lane.text ? (
          <Markdown className={cn(!lane.done && 'caret')}>{lane.text}</Markdown>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <ActivityOrb state={activityFor(lane, { research })} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
              {activityLabel(activityFor(lane, { research }))}
            </span>
          </div>
        )}
        <Sources sources={lane.sources} />
        <TraceList traces={lane.traces} />
        {lane.error && (
          <p className="mt-2 rounded-md border border-danger/25 bg-danger/[0.07] px-2.5 py-2 font-mono text-[10.5px] text-danger">
            {lane.error}
          </p>
        )}
      </div>
    </motion.div>
  );
}

const SUGGESTIONS = [
  'Explain a tricky bug in a streaming parser, then fix it.',
  'Plan a two-week security hardening sprint for a small web app.',
  'Compare SQLite and Postgres for a local-first desktop app.',
  'Review this pitch in one paragraph and tell me what is weak.',
];

function EmptyState() {
  const agents = useStore((s) => s.agents);
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeThreadId);
  const send = useStore((s) => s.send);
  const setThreadAgent = useStore((s) => s.setThreadAgent);
  const setCouncil = useStore((s) => s.setCouncil);
  const council = useStore((s) => s.council);
  const setMode = useStore((s) => s.setMode);
  const thread = threads.find((t) => t.id === activeId);
  const mode = thread?.mode ?? 'single';
  const demoOnly = useStore((s) => s.app?.demoOnly);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[52rem] flex-col justify-center px-5 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mx-auto w-full max-w-[560px]">
        <Mark size={38} className="drop-shadow-[0_0_24px_oklch(0.805_0.148_78/0.3)]" />
        <h2 className="mt-5 font-serif text-[36px] leading-[1.06] tracking-[-0.015em] text-fg sm:text-[42px]">
          A panel of specialists,
          <br />
          <em className="text-accent">on your machine.</em>
        </h2>
        <p className="mt-3 max-w-[42ch] text-[13.5px] leading-relaxed text-muted">
          Vesper is a local-first agent console. Pick a persona, switch on council mode to run several at once, and watch every
          tool call as it happens.
        </p>

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <span className="label">{mode === 'council' ? 'council roster — click to include' : 'send this thread to'}</span>
            <button
              onClick={() => setMode(mode === 'council' ? 'single' : 'council')}
              className="font-mono text-[10px] text-accent/80 hover:text-accent"
            >
              {mode === 'council' ? 'switch to single' : 'try council →'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agents.slice(0, 6).map((agent) => {
              const active = mode === 'council' ? council.includes(agent.id) : thread?.agentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => (mode === 'council' ? setCouncil(active ? council.filter((id) => id !== agent.id) : [...council, agent.id]) : setThreadAgent(agent.id))}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all',
                    active ? 'border-line-strong bg-ink-850' : 'border-line-soft bg-ink-950/40 hover:border-line hover:bg-ink-900/60',
                  )}
                >
                  <Glyph agent={agent} size="sm" />
                  <span className="text-left">
                    <span className={cn('block text-[11.5px] leading-tight', active ? 'text-fg' : 'text-fg-2')}>{agent.name}</span>
                    <span className="block font-mono text-[9px] uppercase tracking-wider text-faint">{agent.role}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion, index) => (
            <motion.button
              key={suggestion}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              onClick={() => void send(suggestion)}
              className="group flex items-start gap-2 rounded-lg border border-line-soft bg-ink-950/30 px-2.5 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent/[0.04]"
            >
              <Sparkles size={11} className="mt-[3px] shrink-0 text-faint group-hover:text-accent" />
              <span className="text-[11.5px] leading-snug text-muted group-hover:text-fg-2">{suggestion}</span>
            </motion.button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 font-mono text-[9.5px] uppercase tracking-wider text-faint/70">
          <span className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd> palette
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> send
          </span>
          <span>·</span>
          <span>{demoOnly ? 'offline demo model — no keys needed' : 'connected'}</span>
        </div>
      </motion.div>
    </div>
  );
}
