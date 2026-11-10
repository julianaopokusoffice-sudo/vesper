import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, FileText, Lock, Plus, Search, Sparkles } from 'lucide-react';
import type { Skill } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Markdown } from './Markdown';
import { Button, Chip, Field, Modal, PageHeader, SectionLabel, Toggle, cn, inputClass } from './ui';

export function SkillsView() {
  const skills = useStore((s) => s.skills);
  const replaceSkills = useStore((s) => s.replaceSkills);
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => `${s.id} ${s.description}`.toLowerCase().includes(q));
  }, [skills, query]);

  const toggle = async (skill: Skill, enabled: boolean) => {
    replaceSkills(await api.toggleSkill(skill.id, enabled));
  };

  const open = async (skill: Skill) => {
    if (expanded === skill.id) return setExpanded(null);
    setExpanded(skill.id);
    if (!bodies[skill.id]) {
      const raw = await api.rawSkill(skill.id);
      const body = raw.replace(/^---[\s\S]*?\n---\n?/, '');
      setBodies((current) => ({ ...current, [skill.id]: body }));
    }
  };

  const activeCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-[900px]">
        <PageHeader
          title="Skills"
          meta={
            <Chip tone="accent">
              {activeCount}/{skills.length} active
            </Chip>
          }
          subtitle="SKILL.md procedures in the open Agent Skills format. Only the one-line description enters the prompt — the body is loaded by the model through a tool call, which keeps context lean."
          actions={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} /> New skill
            </Button>
          }
        />

        <div className="mt-4 flex items-center gap-2">
          <div className="focus-ring flex flex-1 items-center gap-2 rounded-lg border border-line bg-ink-1000/40 px-2.5 py-1.5">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter skills"
              className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint/80"
            />
          </div>
          <span className="font-mono text-[10px] text-faint">{filtered.length} shown</span>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {filtered.map((skill) => {
            const isOpen = expanded === skill.id;
            return (
              <div
                key={skill.id}
                className={cn(
                  'overflow-hidden rounded-xl border bg-ink-950/40 transition-colors',
                  skill.enabled ? 'border-line-soft' : 'border-line-soft/50 opacity-60',
                )}
              >
                <div className="flex items-start gap-2.5 px-3 py-2.5">
                  <button onClick={() => void open(skill)} className="mt-[3px] text-faint hover:text-fg">
                    <ChevronRight size={13} className={cn('transition-transform', isOpen && 'rotate-90')} />
                  </button>
                  <Spike accent={skill.enabled} />
                  <button onClick={() => void open(skill)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mono text-[12px] text-fg">{skill.id}</span>
                      {skill.builtin ? <Chip>bundled</Chip> : <Chip tone="cool">local</Chip>}
                      <span className="font-mono text-[9.5px] text-faint">~{skill.tokens} tok</span>
                      {skill.allowedTools?.length ? (
                        <Chip tone="neutral">
                          <Lock size={7} /> {skill.allowedTools.length} tools
                        </Chip>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">{skill.description}</p>
                  </button>
                  <Toggle checked={skill.enabled} onChange={(next) => void toggle(skill, next)} label={`Enable ${skill.id}`} />
                </div>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-line-soft"
                    >
                      <div className="max-h-[380px] overflow-y-auto bg-ink-1000/40 px-4 py-3">
                        {bodies[skill.id] ? (
                          <Markdown className="text-[12px]">{bodies[skill.id]!}</Markdown>
                        ) : (
                          <div className="flex items-center gap-2 py-2 text-faint">
                            <FileText size={12} /> <span className="font-mono text-[10px]">loading…</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 border-t border-line-soft px-4 py-1.5">
                        <span className="mono truncate text-[9.5px] text-faint/70">{skill.path}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-xl border border-line-soft bg-ink-950/30 p-4">
          <SectionLabel>progressive disclosure</SectionLabel>
          <div className="mt-2 grid gap-3 text-[11.5px] leading-relaxed text-muted sm:grid-cols-3">
            <p>
              <span className="text-fg-2">1 · index.</span> Every enabled skill contributes one line to the system prompt: its id and
              description. Nothing else.
            </p>
            <p>
              <span className="text-fg-2">2 · load.</span> When the model needs the procedure it calls{' '}
              <span className="mono text-accent">load_skill</span>, and the full body enters the conversation for that turn.
            </p>
            <p>
              <span className="text-fg-2">3 · pin.</span> Skills pinned to an agent are injected in full every turn — use that
              sparingly, for house rules that must never be skipped.
            </p>
          </div>
        </div>
      </div>

      <NewSkillModal open={creating} onClose={() => setCreating(false)} onCreated={(next) => replaceSkills(next)} toast={toast} />
    </div>
  );
}

function Spike({ accent }: { accent: boolean }) {
  return (
    <span
      className={cn('mt-[2px] grid h-5 w-5 shrink-0 place-items-center rounded-md border', accent ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line text-faint')}
    >
      <Sparkles size={10} />
    </span>
  );
}

function NewSkillModal({
  open,
  onClose,
  onCreated,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (skills: Skill[]) => void;
  toast: (kind: 'info' | 'error' | 'success', text: string) => void;
}) {
  const [name, setName] = useState('');
  const [markdown, setMarkdown] = useState('');

  const create = async () => {
    try {
      const next = await api.createSkill({
        name,
        markdown: markdown.trim() || undefined,
      });
      onCreated(next);
      toast('success', `Skill created at ~/.vesper/skills/${name}`);
      setName('');
      setMarkdown('');
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not create skill');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New skill"
      subtitle="A folder with a SKILL.md. Name must be lowercase-hyphenated and match the folder."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={create} disabled={!name.trim()}>
            Create skill
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint="lowercase-with-hyphens">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="incident-review" />
        </Field>
        <Field label="SKILL.md" hint="leave empty for a scaffold">
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={`---\nname: ${name || 'incident-review'}\ndescription: Run a blameless incident review. Use after an outage or a near miss.\nlicense: MIT\n---\n\n# Incident review\n\n## Method\n1. Timeline in UTC...`}
            className={cn(inputClass, 'mono min-h-[260px] resize-y text-[11.5px] leading-relaxed')}
          />
        </Field>
      </div>
    </Modal>
  );
}
