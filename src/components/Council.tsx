import { motion } from 'motion/react';
import { AlertTriangle, Crown } from 'lucide-react';
import type { Agent, Message, Usage } from '@shared/types';
import type { OrbState } from 'thinking-orbs';
import { Markdown } from './Markdown';
import { TraceList } from './TraceList';
import { cn, Chip, Glyph } from './ui';
import { formatCost, formatNumber } from '@/lib/format';
import type { Lane } from '@/lib/store';
import { ActivityOrb, activityFor, activityLabel } from './ActivityOrb';

function LaneShell({
  agent,
  accent,
  label,
  synthesis,
  status,
  state,
  usage,
  error,
  children,
}: {
  agent?: Agent;
  accent: string;
  label?: string;
  synthesis?: boolean;
  status: 'streaming' | 'done' | 'error';
  state?: OrbState;
  usage?: Usage;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-ink-950/45',
        synthesis ? 'border-accent/25' : 'border-line-soft',
        status === 'error' && 'border-danger/30',
      )}
      style={synthesis ? { background: 'linear-gradient(180deg, oklch(0.805 0.148 78 / 0.055), transparent 40%)' } : undefined}
    >
      <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
        {agent ? <Glyph agent={agent} size="sm" /> : <span className="h-6 w-6 rounded-md" style={{ background: `${accent}22` }} />}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-fg">{agent?.name ?? label}</span>
            {synthesis && (
              <Chip tone="accent">
                <Crown size={8} /> chair
              </Chip>
            )}
          </div>
          <span className="block truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">
            {agent?.role ?? 'agent'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {status === 'streaming' ? (
            <ActivityOrb state={state ?? 'working'} label={activityLabel(state ?? 'working')} />
          ) : status === 'error' ? (
            <AlertTriangle size={11} className="text-danger" />
          ) : (
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: accent }} />
          )}
          {usage && (
            <span className="font-mono text-[9.5px] text-faint">
              {formatNumber(usage.completionTokens)} tok · {formatCost(usage.costUSD)}
            </span>
          )}
        </div>
      </div>
      <div className="min-h-[104px] flex-1 px-3.5 py-2.5">
        {children}
        {error && (
          <p className="mt-2 rounded-md border border-danger/25 bg-danger/[0.07] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function LaneCard({ lane, agent, index }: { lane: Lane; agent?: Agent; index: number }) {
  const status = lane.error ? 'error' : lane.done ? 'done' : 'streaming';
  const synthesis = lane.lane === 'synthesis';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className={cn('min-w-0', synthesis && 'col-span-full')}
    >
      <LaneShell
        agent={agent}
        accent={lane.accent}
        label={lane.label ?? lane.name}
        synthesis={synthesis}
        status={status}
        state={activityFor(lane, { synthesis })}
        usage={lane.done ? lane.usage : undefined}
        error={lane.error}
      >
        {lane.text ? (
          <Markdown className={cn('text-[13px]', !lane.done && lane.text.length > 0 && 'caret')}>{lane.text}</Markdown>
        ) : (
          <div className="flex items-center gap-2 py-4 pl-1">
            <ActivityOrb state={activityFor(lane, { synthesis })} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
              {activityLabel(activityFor(lane, { synthesis }))}
            </span>
          </div>
        )}
        <TraceList traces={lane.traces} dense />
      </LaneShell>
    </motion.div>
  );
}

export function CouncilGrid({ messages, agents }: { messages: Message[]; agents: Agent[] }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
      {messages.map((message, index) => {
        const agent = agents.find((a) => a.id === message.agentId);
        return (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.04, 0.2), duration: 0.22 }}
            className="min-w-0"
          >
            <LaneShell
              agent={agent}
              accent={agent?.accent ?? '#f0b429'}
              status="done"
              usage={message.usage}
            >
              <Markdown className="text-[13px]">{message.content}</Markdown>
              <TraceList traces={message.traces} dense />
            </LaneShell>
          </motion.div>
        );
      })}
    </div>
  );
}
