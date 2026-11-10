import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, FolderOpen, FolderTree, GitBranch, Info, ShieldAlert, Sparkles, Wrench, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatCost, formatNumber } from '@/lib/format';
import { cn, Chip, Glyph, SectionLabel, Tooltip } from './ui';
import { ChatSidebar } from './ChatSidebar';

export function Inspector() {
  const inspector = useStore((s) => s.inspector);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const agents = useStore((s) => s.agents);
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeThreadId);
  const messages = useStore((s) => s.messages);
  const tools = useStore((s) => s.tools);
  const skills = useStore((s) => s.skills);
  const plugins = useStore((s) => s.plugins);
  const app = useStore((s) => s.app);
  const setView = useStore((s) => s.setView);
  const setFocusedAgent = useStore((s) => s.setFocusedAgent);
  const focusedAgentId = useStore((s) => s.focusedAgentId);
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<'context' | 'files' | 'git'>('context');

  if (!inspector) return null;

  const thread = threads.find((t) => t.id === activeId);
  const agent = agents.find((a) => a.id === (thread?.agentId ?? focusedAgentId)) ?? agents[0];
  const model = agent?.model ?? settings.defaultModel;

  const allowAll = agent?.tools.includes('*') ?? true;
  const coreTools = tools.filter((t) => allowAll || agent?.tools.includes(t.name));
  const pluginTools = plugins.filter((p) => p.enabled).flatMap((p) => p.tools.map((t) => ({ ...t, plugin: p.name })));
  const pinnedSkills = (agent?.skills ?? []).map((id) => skills.find((s) => s.id === id)).filter(Boolean);

  const totals = messages.reduce(
    (acc, message) => {
      acc.prompt += message.usage?.promptTokens ?? 0;
      acc.completion += message.usage?.completionTokens ?? 0;
      acc.cost += message.usage?.costUSD ?? 0;
      return acc;
    },
    { prompt: 0, completion: 0, cost: 0 },
  );

  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22 }}
      className="relative z-10 hidden w-[304px] shrink-0 flex-col overflow-y-auto border-l border-line-soft bg-ink-950/40 backdrop-blur-xl xl:flex"
    >
      <div className="flex h-[54px] shrink-0 items-center gap-1 px-3">
        <div className="flex items-center rounded-lg border border-line bg-ink-1000/50 p-0.5">
          {([
            { id: 'context' as const, icon: Info, label: 'Context' },
            { id: 'files' as const, icon: FolderTree, label: 'Files' },
            { id: 'git' as const, icon: GitBranch, label: 'Changes' },
          ]).map(({ id, icon: Icon, label }) => (
            <Tooltip key={id} text={label}>
              <button
                onClick={() => setTab(id)}
                aria-label={label}
                aria-pressed={tab === id}
                className={cn(
                  'grid h-7 w-8 place-items-center rounded-md transition-colors',
                  tab === id ? 'bg-ink-850 text-accent' : 'text-faint hover:text-fg-2',
                )}
              >
                <Icon size={13} strokeWidth={1.8} />
              </button>
            </Tooltip>
          ))}
        </div>
        <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">sidebar</span>
        <button onClick={toggleInspector} className="ml-auto text-faint hover:text-fg" aria-label="Hide inspector">
          <X size={14} />
        </button>
      </div>

      {tab !== 'context' && <ChatSidebar tab={tab} />}

      <div className={tab === 'context' ? 'contents' : 'hidden'}>

      {agent && (
        <div className="px-4">
          <div className="relative overflow-hidden rounded-xl border border-line bg-ink-900/60 p-3">
            <div
              className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl"
              style={{ background: `${agent.accent}22` }}
            />
            <div className="flex items-start gap-2.5">
              <Glyph agent={agent} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate text-[15px] font-medium text-fg">{agent.name}</h3>
                  {agent.builtin && <Chip>buitin</Chip>}
                </div>
                <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: agent.accent }}>
                  {agent.role}
                </p>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{agent.description}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <Stat label="model" value={model?.id ?? '—'} />
              <Stat label="temp" value={agent.temperature.toFixed(2)} />
              <Stat label="max steps" value={String(agent.maxSteps)} />
              <Stat label="tools" value={`${coreTools.length + pluginTools.length}`} />
            </div>

            <button
              onClick={() => {
                setFocusedAgent(agent.id);
                setView('agents');
              }}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-ink-950/50 py-1.5 text-[11.5px] text-fg-2 transition-colors hover:border-accent/40 hover:text-accent"
            >
              Edit persona <ArrowUpRight size={11} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 px-4">
        <SectionLabel right={<span className="font-mono text-[10px] text-faint">{coreTools.length + pluginTools.length}</span>}>
          <span className="flex items-center gap-1.5">
            <Wrench size={10} /> tools
          </span>
        </SectionLabel>
        <div className="mt-2 flex flex-col gap-1">
          {coreTools.slice(0, 7).map((tool) => (
            <div key={tool.name} className="flex items-center gap-1.5 rounded-md px-1 py-[3px]">
              <span className="mono truncate text-[11px] text-fg-2">{tool.name}</span>
              {tool.requiresApproval && (
                <Tooltip text="Asks for approval before running">
                  <span className="flex items-center gap-0.5 rounded border border-accent/25 px-1 font-mono text-[8.5px] uppercase text-accent/90">
                    <ShieldAlert size={7} /> gate
                  </span>
                </Tooltip>
              )}
            </div>
          ))}
          {coreTools.length > 7 && (
            <span className="px-1 font-mono text-[10px] text-faint">+{coreTools.length - 7} more core tools</span>
          )}
          {pluginTools.map((tool) => (
            <div key={`${tool.plugin}-${tool.name}`} className="flex items-center gap-1.5 rounded-md px-1 py-[3px]">
              <span className="mono truncate text-[11px] text-fg-2">{tool.name}</span>
              <Chip tone="cool">{tool.plugin}</Chip>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 px-4">
        <SectionLabel right={<span className="font-mono text-[10px] text-faint">{skills.filter((s) => s.enabled).length} active</span>}>
          <span className="flex items-center gap-1.5">
            <Sparkles size={10} /> skills
          </span>
        </SectionLabel>
        <div className="mt-2 flex flex-col gap-1">
          {pinnedSkills.map((skill) => (
            <div key={skill!.id} className="rounded-md border border-line-soft bg-ink-1000/30 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="mono text-[10.5px] text-fg-2">{skill!.id}</span>
                <Chip tone="accent">pinned</Chip>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-faint">{skill!.description}</p>
            </div>
          ))}
          {!pinnedSkills.length && (
            <p className="px-1 text-[10.5px] leading-snug text-faint">
              No pinned skills. Available skills are listed in the prompt and loaded on demand.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 px-4 pb-4">
        <SectionLabel>thread</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Stat label="messages" value={String(messages.length)} />
          <Stat label="tokens" value={formatNumber(totals.prompt + totals.completion)} />
          <Stat label="prompt" value={formatNumber(totals.prompt)} />
          <Stat label="cost" value={formatCost(totals.cost)} />
        </div>
        <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-line-soft bg-ink-1000/30 px-2 py-1.5">
          <FolderOpen size={11} className="mt-[2px] shrink-0 text-faint" />
          <span className="mono break-all text-[10px] leading-snug text-faint">{app?.workspace}</span>
        </div>
        <div className="mt-2 flex items-start gap-1.5 px-1">
          <Info size={11} className="mt-[2px] shrink-0 text-faint" />
          <span className="text-[10px] leading-snug text-faint">
            Keys encrypted at rest · {plugins.filter((p) => p.enabled).length} plugins loaded · v{app?.version}
          </span>
        </div>
      </div>
      </div>
    </motion.aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-soft bg-ink-1000/30 px-1.5 py-1">
      <span className="label block text-[8.5px]">{label}</span>
      <span className={cn('mono block truncate text-[11px] text-fg-2')} title={value}>
        {value}
      </span>
    </div>
  );
}
