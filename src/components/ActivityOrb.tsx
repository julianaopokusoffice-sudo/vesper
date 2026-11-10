import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import type { ToolTrace } from '@shared/types';
import { cn } from './ui';

/**
 * The agent's pulse. `thinking-orbs` renders a dotted, stateful mark on a plain
 * canvas — working while it reasons, searching while it reads the web, weaving
 * while the council merges. The animation is the status text; the label is for
 * screen readers and for the moments the state is not obvious.
 */
export function ActivityOrb({
  state,
  size = 20,
  label,
  className,
}: {
  state: OrbState;
  size?: 20 | 32 | 64;
  label?: string;
  className?: string;
}) {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme="dark"
      aria-label={label ?? activityLabel(state)}
      className={cn('shrink-0', className)}
    />
  );
}

interface LaneLike {
  done: boolean;
  text: string;
  traces: ToolTrace[];
  error?: string;
  lane?: 'agent' | 'synthesis';
}

const READING = /web_search|fetch_url|search_papers|read_paper|library_|connector_read|browse|search/i;

/** Pick the verb that matches what the lane is actually doing right now. */
export function activityFor(
  lane: LaneLike | undefined,
  options: { research?: boolean; synthesis?: boolean } = {},
): OrbState {
  if (options.synthesis || lane?.lane === 'synthesis') return 'composing';
  if (!lane) return 'connecting';
  if (lane.error) return 'breathing';
  const running = [...lane.traces].reverse().find((trace) => trace.ok === undefined);
  if (running) return READING.test(running.name) ? 'searching' : 'solving';
  if (lane.done) return 'breathing';
  if (options.research) return 'searching';
  return 'working';
}

export function activityLabel(state: OrbState): string {
  switch (state) {
    case 'connecting':
      return 'connecting';
    case 'searching':
      return 'searching';
    case 'solving':
      return 'working through tools';
    case 'listening':
      return 'listening';
    case 'weaving':
      return 'weaving the answers';
    case 'composing':
      return 'composing';
    case 'shaping':
      return 'shaping the answer';
    case 'breathing':
      return 'idle';
    default:
      return 'working';
  }
}
