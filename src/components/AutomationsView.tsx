import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Loader2, Play, Plus, Timer, Trash2, X } from 'lucide-react';
import type { Automation } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { relativeTime } from '@/lib/format';
import { Button, Chip, Field, PageHeader, Toggle, cn, inputClass } from './ui';

const INTERVALS = [
  { label: '15 minutes', minutes: 15 },
  { label: 'hourly', minutes: 60 },
  { label: 'every 6 hours', minutes: 360 },
  { label: 'daily', minutes: 1440 },
  { label: 'weekly', minutes: 10080 },
];

/**
 * Scheduled research. Each job is a standing brief: a read-only researcher runs
 * it on a cadence, saves papers it read to the library, and leaves a markdown
 * briefing in Deliverables. Nothing here can edit files or run shell commands.
 */
export function AutomationsView() {
  const toast = useStore((state) => state.toast);
  const agents = useStore((state) => state.agents);
  const [jobs, setJobs] = useState<(Automation & { running?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('atlas');
  const [everyMinutes, setEveryMinutes] = useState(1440);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await api.automations();
      setJobs(result.automations);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not load automations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const builtinAgents = useMemo(() => agents.filter((agent) => agent.builtin), [agents]);

  const create = async () => {
    if (prompt.trim().length < 12) {
      toast('info', 'Describe the standing task in at least a sentence.');
      return;
    }
    setSaving(true);
    try {
      await api.createAutomation({ name: name.trim() || undefined, prompt: prompt.trim(), agentId, everyMinutes });
      setCreating(false);
      setName('');
      setPrompt('');
      setEveryMinutes(1440);
      await load();
      toast('success', 'Automation scheduled');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not schedule it');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Partial<Automation>) => {
    try {
      const result = await api.patchAutomation(id, body);
      setJobs((list) => list.map((job) => (job.id === id ? { ...result.automation, running: job.running } : job)));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not update it');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this automation? Its saved briefings stay in Deliverables.')) return;
    try {
      await api.deleteAutomation(id);
      setJobs((list) => list.filter((job) => job.id !== id));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not delete it');
    }
  };

  const runNow = async (job: Automation) => {
    try {
      await api.runAutomation(job.id);
      setJobs((list) => list.map((entry) => (entry.id === job.id ? { ...entry, running: true, lastStatus: 'running' } : entry)));
      toast('info', `“${job.name}” is running in the background`);
      window.setTimeout(() => void load(), 2500);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not start it');
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-[980px]">
        <PageHeader
          title="Automations"
          meta={<Chip tone={jobs.length ? 'accent' : 'neutral'}>{jobs.length}</Chip>}
          subtitle="Standing research tasks. A read-only researcher runs them on a schedule, saves what it read, and leaves a briefing in Deliverables — no file edits, no shell, no approvals to babysit."
          actions={
            <Button variant="primary" size="sm" onClick={() => setCreating((value) => !value)}>
              {creating ? <X size={12} /> : <Plus size={12} />} {creating ? 'Close' : 'New automation'}
            </Button>
          }
        />

        {creating && (
          <div className="mt-4 rounded-xl border border-line bg-ink-950/40 p-3.5">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
              <Field label="Name" hint="optional">
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="RAG evaluation watch" className={cn(inputClass, 'text-[12.5px]')} />
              </Field>
              <Field label="Persona">
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)} className={cn(inputClass, 'text-[12px]')}>
                  {builtinAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} · {agent.role}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cadence">
                <select value={everyMinutes} onChange={(event) => setEveryMinutes(Number(event.target.value))} className={cn(inputClass, 'text-[12px]')}>
                  {INTERVALS.map((interval) => (
                    <option key={interval.minutes} value={interval.minutes}>
                      {interval.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Standing brief" hint="what to research, and what the briefing should contain" className="mt-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder="Track new work on retrieval-augmented generation evaluation. Each run: find papers from the last two weeks, compare the benchmarks they use, and say which results are actually comparable."
                className={cn(inputClass, 'resize-y text-[12.5px] leading-relaxed')}
              />
            </Field>
            <div className="mt-2.5 flex items-center gap-2">
              <Button variant="primary" size="sm" onClick={create} disabled={saving}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : <CalendarClock size={11} />} Schedule it
              </Button>
              <span className="font-mono text-[9.5px] leading-relaxed text-faint">
                first run in {label(everyMinutes)} · briefings land in Deliverables · read-only tools
              </span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <Loader2 size={12} className="animate-spin" /> loading schedules
          </div>
        ) : jobs.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line bg-ink-950/20 px-6 py-12 text-center">
            <Timer size={22} className="mx-auto text-faint" />
            <p className="mt-3 font-serif text-[20px] text-fg">Nothing scheduled</p>
            <p className="mx-auto mt-1 max-w-[48ch] text-[12px] leading-relaxed text-muted">
              A standing brief is how you stop re-asking the same question. Ask for a weekly literature scan, a daily
              dependency check, or a Monday competitor digest — the researcher does the reading and leaves the file.
            </p>
            <Button variant="subtle" size="sm" className="mt-4" onClick={() => setCreating(true)}>
              <Plus size={12} /> Write the first brief
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {jobs.map((job) => {
              const agent = agents.find((entry) => entry.id === job.agentId);
              const running = job.running || job.lastStatus === 'running';
              return (
                <article
                  key={job.id}
                  className={cn(
                    'rounded-xl border bg-ink-950/40 p-3.5 transition-colors',
                    job.enabled ? 'border-line-soft' : 'border-line-soft opacity-60',
                  )}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-[13px] font-medium text-fg">{job.name}</h3>
                        {job.lastStatus === 'ok' && <Chip tone="ok"><Check size={8} /> last ok</Chip>}
                        {job.lastStatus === 'error' && <Chip tone="danger"><X size={8} /> failed</Chip>}
                        {running && <Chip tone="accent"><Loader2 size={8} className="animate-spin" /> running</Chip>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{job.prompt}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-wider text-faint">
                        <span>{agent?.name ?? job.agentId}</span>
                        <span>·</span>
                        <span>{label(job.everyMinutes)}</span>
                        <span>·</span>
                        <span title={new Date(job.nextRunAt).toLocaleString()}>{job.enabled ? `next ${until(job.nextRunAt)}` : 'paused'}</span>
                        {job.lastRunAt && (
                          <>
                            <span>·</span>
                            <span>last {relativeTime(job.lastRunAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Toggle checked={job.enabled} onChange={(next) => void patch(job.id, { enabled: next })} label="Enabled" />
                      <Button size="xs" variant="outline" onClick={() => void runNow(job)} disabled={running}>
                        {running ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />} run
                      </Button>
                      <Button size="xs" variant="danger" onClick={() => void remove(job.id)}>
                        <Trash2 size={10} />
                      </Button>
                    </div>
                  </div>

                  {job.lastOutput && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpanded((current) => (current === job.id ? null : job.id))}
                        className="font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-fg-2"
                      >
                        {expanded === job.id ? 'hide briefing' : 'last briefing'}
                      </button>
                      {expanded === job.id && (
                        <pre className="mt-1.5 max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line-soft bg-ink-1000/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-fg-2">
                          {job.lastOutput}
                        </pre>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function label(minutes: number): string {
  if (minutes < 60) return `every ${minutes} min`;
  if (minutes < 1440) return `every ${Math.round(minutes / 60)} h`;
  if (minutes < 10080) return `every ${Math.round(minutes / 1440)} d`;
  return 'weekly';
}

function until(timestamp: number): string {
  const delta = Math.max(0, timestamp - Date.now());
  if (delta < 60_000) return 'in under a minute';
  if (delta < 3_600_000) return `in ${Math.round(delta / 60_000)} min`;
  if (delta < 86_400_000) return `in ${Math.round(delta / 3_600_000)} h`;
  return `in ${Math.round(delta / 86_400_000)} d`;
}
