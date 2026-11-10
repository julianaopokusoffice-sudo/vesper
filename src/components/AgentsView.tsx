import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Download, Plus, Trash2, Upload, Wrench } from 'lucide-react';
import type { Agent, ProviderId } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import {
  Button,
  Chip,
  Field,
  Glyph,
  IconButton,
  Modal,
  PageHeader,
  SectionLabel,
  Tooltip,
  cn,
  inputClass,
} from './ui';

const ACCENTS = ['#f0b429', '#22d3ee', '#fb923c', '#86efac', '#f472b6', '#a78bfa', '#4ade80', '#60a5fa', '#f87171', '#e2e8f0'];

export function AgentsView() {
  const agents = useStore((s) => s.agents);
  const skills = useStore((s) => s.skills);
  const tools = useStore((s) => s.tools);
  const plugins = useStore((s) => s.plugins);
  const setView = useStore((s) => s.setView);
  const setThreadAgent = useStore((s) => s.setThreadAgent);
  const activeThreadId = useStore((s) => s.activeThreadId);
  const setCouncil = useStore((s) => s.setCouncil);
  const council = useStore((s) => s.council);
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const pluginToolCount = plugins.reduce((n, p) => n + p.tools.length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <PageHeader
          title="Agents"
          subtitle="Each agent is a persona with its own prompt, model, temperature and tool allow-list. Edits are stored locally; built-ins can be reset at any time."
          meta={<Chip tone="accent">{agents.length}</Chip>}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                <Upload size={13} /> Import .md
              </Button>
              <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
                <Plus size={13} /> New agent
              </Button>
            </>
          }
        />

        <div className="mt-5 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent, index) => {
            const toolCount = agent.tools.includes('*') ? tools.length + pluginToolCount : agent.tools.length;
            const inCouncil = council.includes(agent.id);
            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.2 }}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-line-soft bg-ink-950/40 p-3.5 transition-all hover:border-line hover:bg-ink-900/50"
              >
                <div
                  className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: `${agent.accent}22` }}
                />
                <div className="flex items-start gap-2.5">
                  <Glyph agent={agent} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-[14px] font-medium text-fg">{agent.name}</h3>
                      {agent.builtin && <Chip>built-in</Chip>}
                      {inCouncil && <Chip tone="accent">council</Chip>}
                    </div>
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: agent.accent }}>
                      {agent.role}
                    </p>
                  </div>
                </div>

                <p className="mt-2.5 line-clamp-2 min-h-[32px] text-[11.5px] leading-snug text-muted">{agent.description}</p>

                <div className="mt-3 flex items-center gap-1.5 font-mono text-[9.5px] text-faint">
                  <span className="truncate">{agent.model?.id ?? 'default model'}</span>
                  <span className="text-faint/40">·</span>
                  <span className="flex items-center gap-0.5">
                    <Wrench size={9} /> {toolCount}
                  </span>
                  <span className="text-faint/40">·</span>
                  <span>{agent.skills.length} skills</span>
                </div>

                <div className="mt-3 flex items-center gap-1.5 border-t border-line-soft pt-2.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      void setThreadAgent(agent.id);
                      if (activeThreadId) setView('chat');
                    }}
                  >
                    Use
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setCouncil(inCouncil ? council.filter((id) => id !== agent.id) : [...council, agent.id])}
                  >
                    {inCouncil ? 'Remove' : 'Council'}
                  </Button>
                  <button
                    onClick={() => setEditing(agent)}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-muted transition-colors hover:bg-white/5 hover:text-fg"
                  >
                    Edit <ArrowUpRight size={10} />
                  </button>
                </div>
              </motion.div>
            );
          })}

          <button
            onClick={() => setEditing('new')}
            className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-transparent text-faint transition-colors hover:border-accent/40 hover:bg-accent/[0.03] hover:text-accent"
          >
            <Plus size={18} />
            <span className="font-mono text-[10px] uppercase tracking-wider">new persona</span>
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-line-soft bg-ink-950/30 p-4">
          <SectionLabel>how personas work</SectionLabel>
          <div className="mt-2 grid gap-3 text-[11.5px] leading-relaxed text-muted sm:grid-cols-3">
            <p>
              A persona is just a system prompt plus a model binding. Nothing is hidden: open any agent and read the exact prompt
              the model receives.
            </p>
            <p>
              Tool permissions are per agent. Give a reviewer read-only tools and a builder the write tools — the runtime enforces
              the allow-list before any call.
            </p>
            <p>
              Personas are portable. Export writes a markdown file with frontmatter to <span className="mono text-fg-2">~/.vesper/agents</span>, and
              import accepts the same format.
            </p>
          </div>
        </div>
      </div>

      <AgentEditor agent={editing} onClose={() => setEditing(null)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      <SkillsHint available={skills.filter((s) => s.enabled).length} />
    </div>
  );
}

function SkillsHint({ available }: { available: number }) {
  return <span className="hidden">{available}</span>;
}

function AgentEditor({ agent, onClose }: { agent: Agent | 'new' | null; onClose: () => void }) {
  const tools = useStore((s) => s.tools);
  const skills = useStore((s) => s.skills);
  const providers = useStore((s) => s.providers);
  const updateAgentLocal = useStore((s) => s.updateAgentLocal);
  const removeAgentLocal = useStore((s) => s.removeAgentLocal);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!agent) return setDraft(null);
    if (agent === 'new') {
      setDraft({
        id: '',
        name: '',
        handle: '',
        role: 'Custom',
        description: '',
        system: 'You are a focused agent.\n\nMethod:\n- Lead with the answer.\n- Name the failure mode before the happy path.\n- Ask one clarifying question only if the answer would change your recommendation.',
        accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)]!,
        glyph: 'N',
        model: null,
        temperature: 0.7,
        maxSteps: 6,
        tools: ['*'],
        skills: [],
        builtin: false,
        createdAt: Date.now(),
      });
    } else {
      setDraft({ ...agent });
    }
  }, [agent]);

  const update = (patch: Partial<Agent>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = async () => {
    if (!draft?.name.trim()) return toast('error', 'Give the agent a name first.');
    setSaving(true);
    try {
      const saved =
        agent === 'new'
          ? await api.createAgent(draft)
          : await api.saveAgent({ ...draft, id: (agent as Agent).id });
      updateAgentLocal(saved);
      toast('success', `${saved.name} saved`);
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const allTools = draft?.tools.includes('*') ?? true;
  const provider = providers.find((p) => p.id === (draft?.model?.provider ?? settings.defaultModel.provider));

  return (
    <Modal
      open={!!agent && !!draft}
      onClose={onClose}
      title={agent === 'new' ? 'New persona' : `Edit ${(agent as Agent)?.name ?? ''}`}
      subtitle="The system prompt is sent verbatim. Tool permissions are enforced by the runtime, not the prompt."
      width="max-w-3xl"
      footer={
        <>
          {agent !== 'new' && agent && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const result = await api.exportAgent((agent as Agent).id);
                  toast('success', `Written to ${result.file}`);
                }}
              >
                <Download size={12} /> Export .md
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  const target = agent as Agent;
                  if (!window.confirm(target.builtin ? `Reset ${target.name} to the built-in prompt?` : `Delete ${target.name}?`)) return;
                  await api.deleteAgent(target.id);
                  removeAgentLocal(target.id);
                  toast('info', target.builtin ? 'Reset to default' : 'Agent deleted');
                  onClose();
                }}
              >
                <Trash2 size={12} /> {agent?.builtin ? 'Reset' : 'Delete'}
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save persona'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
            <Field label="Name">
              <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Flint" />
            </Field>
            <Field label="Role" hint="shown in the UI">
              <input className={inputClass} value={draft.role} onChange={(e) => update({ role: e.target.value })} placeholder="Engineer" />
            </Field>
            <Field label="Glyph">
              <input
                className={cn(inputClass, 'w-[64px] text-center font-mono uppercase')}
                maxLength={2}
                value={draft.glyph}
                onChange={(e) => update({ glyph: e.target.value.toUpperCase() })}
              />
            </Field>
          </div>

          <Field label="Description" hint="one line, used for routing">
            <input
              className={inputClass}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Blunt senior engineer. Small diffs, real error handling."
            />
          </Field>

          <Field label="Accent">
            <div className="flex flex-wrap gap-1.5">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  onClick={() => update({ accent: color })}
                  className={cn(
                    'h-6 w-6 rounded-md border transition-transform',
                    draft.accent === color ? 'scale-110 border-white/70' : 'border-transparent hover:scale-105',
                  )}
                  style={{ background: color, opacity: draft.accent === color ? 1 : 0.7 }}
                  aria-label={color}
                />
              ))}
            </div>
          </Field>

          <Field label="System prompt" hint={`${draft.system.length} chars`}>
            <textarea
              className={cn(inputClass, 'mono min-h-[190px] resize-y text-[11.5px] leading-relaxed')}
              value={draft.system}
              onChange={(e) => update({ system: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <select
                className={inputClass}
                value={draft.model?.provider ?? ''}
                onChange={(e) => {
                  const id = e.target.value as ProviderId;
                  if (!id) return update({ model: null });
                  const info = providers.find((p) => p.id === id);
                  update({ model: { provider: id, id: info?.models[0] ?? '' } });
                }}
              >
                <option value="">Thread default</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.hasKey ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model id">
              <input
                className={cn(inputClass, 'mono text-[12px]')}
                list="model-options"
                disabled={!draft.model}
                value={draft.model?.id ?? ''}
                onChange={(e) => draft.model && update({ model: { ...draft.model, id: e.target.value } })}
                placeholder="claude-sonnet-4-5"
              />
              <datalist id="model-options">
                {(provider?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperature" hint={draft.temperature.toFixed(2)}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={draft.temperature}
                onChange={(e) => update({ temperature: Number(e.target.value) })}
                className="mt-2 w-full accent-[oklch(0.805_0.148_78)]"
              />
            </Field>
            <Field label="Max tool steps" hint="hard ceiling per turn">
              <input
                type="number"
                min={1}
                max={24}
                className={inputClass}
                value={draft.maxSteps}
                onChange={(e) => update({ maxSteps: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-fg-2">Tools</span>
              <button
                onClick={() => update({ tools: allTools ? [] : ['*'] })}
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-[10px] transition-colors',
                  allTools ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg',
                )}
              >
                {allTools ? 'all core tools' : 'custom selection'}
              </button>
            </div>
            {!allTools && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tools.map((tool) => {
                  const on = draft.tools.includes(tool.name);
                  return (
                    <Tooltip key={tool.name} text={tool.description}>
                      <button
                        onClick={() =>
                          update({
                            tools: on ? draft.tools.filter((t) => t !== tool.name) : [...draft.tools, tool.name],
                          })
                        }
                        className={cn(
                          'rounded-md border px-1.5 py-1 font-mono text-[10px] transition-colors',
                          on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-faint hover:text-fg-2',
                        )}
                      >
                        {tool.name}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <span className="text-[12px] font-medium text-fg-2">Pinned skills</span>
            <p className="mt-0.5 text-[10.5px] text-faint">Pinned skills are injected in full. Unpinned ones stay as summaries until the agent loads them.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((skill) => {
                const on = draft.skills.includes(skill.id);
                return (
                  <Tooltip key={skill.id} text={skill.description}>
                    <button
                      onClick={() =>
                        update({ skills: on ? draft.skills.filter((s) => s !== skill.id) : [...draft.skills, skill.id] })
                      }
                      className={cn(
                        'rounded-md border px-1.5 py-1 font-mono text-[10px] transition-colors',
                        on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-faint hover:text-fg-2',
                      )}
                    >
                      {skill.id}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [markdown, setMarkdown] = useState('');
  const updateAgentLocal = useStore((s) => s.updateAgentLocal);
  const toast = useStore((s) => s.toast);

  const run = async () => {
    try {
      const agent = await api.createAgent({ markdown });
      updateAgentLocal(agent);
      toast('success', `${agent.name} imported`);
      setMarkdown('');
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import a persona"
      subtitle="Paste a markdown file with YAML frontmatter — the same shape Claude Code uses for subagents."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={run} disabled={!markdown.trim()}>
            Import
          </Button>
        </>
      }
    >
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder={`---\nname: reviewer\ndescription: Reviews diffs for correctness\ntools: [read_file, git_diff]\nmodel: claude-sonnet-4-5\n---\nYou are a reviewer...`}
        className={cn(inputClass, 'mono min-h-[240px] resize-y text-[11.5px] leading-relaxed')}
      />
    </Modal>
  );
}
