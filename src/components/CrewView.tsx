import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock3,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  Square,
  TerminalSquare,
  Users2,
  X,
} from 'lucide-react';
import type {
  CliAdapterInfo,
  CliCrewEvent,
  CliCrewRun,
  CliCrewShape,
  CliRole,
  CliStage,
} from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { relativeTime } from '@/lib/format';
import { Button, Chip, Field, PageHeader, SectionLabel, cn, inputClass } from './ui';
import { Markdown } from './Markdown';

const SHAPES: { id: CliCrewShape; label: string; hint: string }[] = [
  { id: 'solo', label: 'Solo', hint: 'one builder' },
  { id: 'pair', label: 'Pair', hint: 'scout + builder' },
  { id: 'crew', label: 'Crew', hint: 'scout · build · verify · review' },
];

const ROLE_ORDER: CliRole[] = ['scout', 'build', 'verify', 'review'];
const ROLE_LABEL: Record<CliRole, string> = {
  scout: 'Scout',
  build: 'Builder',
  verify: 'Verifier',
  review: 'Reviewer',
  fix: 'Fixer',
};
const ROLE_HINT: Record<CliRole, string> = {
  scout: 'read-only',
  build: 'edits',
  verify: 'read-only',
  review: 'read-only',
  fix: 'edits',
};

/**
 * The crew is not a chat: it is a staged process run. This view shows the
 * roster, lets the user assign a CLI to each role, and then follows the stages
 * live — including which one is editing the workspace right now.
 */
export function CrewView() {
  const app = useStore((state) => state.app);
  const toast = useStore((state) => state.toast);
  const [adapters, setAdapters] = useState<CliAdapterInfo[]>([]);
  const [roles, setRoles] = useState<Partial<Record<CliRole, string>>>({});
  const [runs, setRuns] = useState<CliCrewRun[]>([]);
  const [run, setRun] = useState<CliCrewRun | null>(null);
  const [task, setTask] = useState('');
  const [shape, setShape] = useState<CliCrewShape>('crew');
  const [workspace, setWorkspace] = useState('');
  const [fix, setFix] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);

  const load = async (refresh = false) => {
    try {
      const [roster, history] = await Promise.all([api.cliAdapters(refresh), api.cliRuns()]);
      setAdapters(roster.adapters);
      setRoles((current) => (Object.keys(current).length ? current : roster.roles));
      setRuns(history.runs);
      setRun((current) => {
        if (current) {
          const fresh = history.runs.find((entry) => entry.id === current.id);
          return fresh ?? current;
        }
        return history.runs.find((entry) => entry.status === 'running') ?? history.runs[0] ?? null;
      });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not load the crew');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/cli/events');
    const onEvent = (message: MessageEvent) => {
      if (!message.data || message.data === '{}') return;
      let event: CliCrewEvent;
      try {
        event = JSON.parse(message.data) as CliCrewEvent;
      } catch {
        return;
      }
      if (event.type === 'chunk') {
        setRun((current) =>
          current && current.id === event.runId
            ? {
                ...current,
                stages: current.stages.map((stage) =>
                  stage.id === event.stageId
                    ? { ...stage, output: `${stage.output}${event.text}`.slice(-40_000) }
                    : stage,
                ),
              }
            : current,
        );
        return;
      }
      if (event.type === 'stage_start' || event.type === 'stage_end') {
        setRun((current) =>
          current && current.id === event.runId
            ? {
                ...current,
                stages: current.stages.map((stage) => (stage.id === event.stage.id ? event.stage : stage)),
              }
            : current,
        );
        return;
      }
      const next = event.type === 'run_start' ? event.run : event.run;
      setRuns((list) => {
        const others = list.filter((entry) => entry.id !== next.id);
        return [next, ...others].slice(0, 20);
      });
      setRun((current) => {
        if (current?.id === next.id) return next;
        if (!current || current.status !== 'running') return next;
        return current;
      });
    };

    const types: CliCrewEvent['type'][] = ['run_start', 'stage_start', 'chunk', 'stage_end', 'run_end'];
    for (const type of types) source.addEventListener(type, onEvent as EventListener);
    return () => {
      for (const type of types) source.removeEventListener(type, onEvent as EventListener);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [run?.stages.map((stage) => stage.output.length).join(','), run?.status]);

  const available = useMemo(() => adapters.filter((adapter) => adapter.available), [adapters]);
  const canRun = Boolean(task.trim().length >= 8 && available.length);
  const running = run?.status === 'running';

  const start = async () => {
    if (!canRun) return;
    setStarting(true);
    try {
      const created = await api.startCrew({
        task: task.trim(),
        shape,
        workspace: workspace.trim() || undefined,
        roles,
        fix: shape === 'crew' ? fix : false,
      });
      setRun(created);
      setRuns((list) => [created, ...list.filter((entry) => entry.id !== created.id)]);
      setTask('');
      setExpanded(created.stages.find((stage) => stage.writes)?.id ?? null);
      toast('info', `${created.stages.length} stage${created.stages.length === 1 ? '' : 's'} started`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not start the crew');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run || run.status !== 'running') return;
    try {
      const cancelled = await api.cancelCrew(run.id);
      setRun(cancelled);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not cancel the run');
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-[1040px]">
        <PageHeader
          title="Crew"
          meta={<Chip tone={available.length ? 'accent' : 'danger'}>{available.length} ready</Chip>}
          subtitle="Hire the agentic CLIs you already have: a scout plans, one builder edits, read-only stages verify and review in parallel. Vesper passes handoffs between them, keeps a single writer, and stops at a diff — never a commit."
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void load(true);
              }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} /> Re-scan
            </Button>
          }
        />

        {/* roster */}
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {adapters.map((adapter) => (
            <div
              key={adapter.id}
              className={cn(
                'rounded-xl border p-3 transition-colors',
                adapter.available ? 'border-line bg-ink-950/40' : 'border-line/60 bg-ink-950/20',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        adapter.available ? 'bg-ok' : 'bg-faint/50',
                      )}
                    />
                    <span className="truncate text-[13px] font-medium text-fg">{adapter.label}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-faint">{adapter.command || 'no command'}</p>
                </div>
                <Chip tone={adapter.available ? 'ok' : 'neutral'}>{adapter.available ? 'on path' : 'missing'}</Chip>
              </div>
              {adapter.version && (
                <p className="mt-2 truncate font-mono text-[10px] text-muted" title={adapter.version}>
                  {adapter.version}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {adapter.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-muted"
                  >
                    {capability}
                  </span>
                ))}
              </div>
              {!adapter.available && adapter.install && (
                <p className="mt-2 rounded-md bg-ink-900/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-faint">
                  {adapter.install}
                </p>
              )}
            </div>
          ))}
        </div>

        {loading && (
          <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            <Loader2 size={11} className="animate-spin" /> probing PATH
          </p>
        )}

        {/* composer */}
        <div className="mt-6 rounded-xl border border-line bg-ink-950/40 p-4">
          <SectionLabel right={<span className="font-mono text-[10px] text-faint">hands off between stages · one writer</span>}>
            New run
          </SectionLabel>
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={4}
            placeholder="e.g. Add rate limiting to the public API, with tests. Keep the diff small and leave a note on the trade-offs."
            className={cn(inputClass, 'mt-2 resize-y text-[13px] leading-relaxed')}
          />

          <div className="mt-3 grid gap-3 lg:grid-cols-[auto_1fr_auto]">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-fg-2">Shape</span>
              <div className="flex rounded-lg border border-line bg-ink-1000/60 p-0.5">
                {SHAPES.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setShape(entry.id)}
                    title={entry.hint}
                    className={cn(
                      'rounded-[6px] px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                      shape === entry.id ? 'bg-ink-800 text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Workspace" hint={app?.workspace ? 'blank uses the default' : undefined}>
              <input
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder={app?.workspace ?? 'Default Vesper workspace'}
                className={cn(inputClass, 'font-mono text-[11.5px]')}
              />
            </Field>
            <div className="flex items-end gap-2">
              {shape === 'crew' && (
                <button
                  onClick={() => setFix((value) => !value)}
                  className={cn(
                    'h-9 rounded-lg border px-3 text-[11.5px] transition-colors',
                    fix ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg',
                  )}
                  title="Add a second writing pass after verify + review"
                >
                  Fix pass
                </button>
              )}
              <Button variant="primary" onClick={() => void start()} disabled={!canRun || starting || Boolean(running)}>
                {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
                Run crew
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(shape === 'solo' ? (['build'] as CliRole[]) : shape === 'pair' ? (['scout', 'build'] as CliRole[]) : ROLE_ORDER).map(
              (role) => (
                <Field key={role} label={ROLE_LABEL[role]} hint={ROLE_HINT[role]}>
                  <select
                    value={roles[role] ?? ''}
                    onChange={(event) => setRoles((current) => ({ ...current, [role]: event.target.value }))}
                    className={cn(inputClass, 'text-[12px]')}
                  >
                    <option value="">auto</option>
                    {adapters
                      .filter((adapter) => adapter.available && adapter.capabilities.includes(role))
                      .map((adapter) => (
                        <option key={adapter.id} value={adapter.id}>
                          {adapter.label}
                        </option>
                      ))}
                  </select>
                </Field>
              ),
            )}
          </div>

          {!available.length && !loading && (
            <p className="mt-3 rounded-lg border border-danger/25 bg-danger/[0.05] px-3 py-2 text-[11.5px] text-danger/90">
              None of the known CLIs are on PATH. Install one from the cards above, or point an adapter at a command in{' '}
              <code className="font-mono">~/.vesper/cli.json</code>.
            </p>
          )}
        </div>

        {/* active run */}
        {run && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel
                right={
                  <div className="flex items-center gap-1.5">
                    <Chip
                      tone={run.status === 'done' ? 'ok' : run.status === 'failed' ? 'danger' : run.status === 'running' ? 'accent' : 'neutral'}
                    >
                      {run.status}
                    </Chip>
                    {running && (
                      <Button size="xs" variant="outline" onClick={() => void cancel()}>
                        <Square size={10} /> Stop
                      </Button>
                    )}
                  </div>
                }
              >
                {run.status === 'running' ? 'Running' : 'Latest run'}
              </SectionLabel>
            </div>

            <div className="mt-2 rounded-xl border border-line bg-ink-950/40 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                <span className="flex items-center gap-1">
                  <Users2 size={12} /> {run.shape}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-[10px] text-faint">
                  <GitBranch size={11} /> {run.workspace}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] text-faint">
                  <Clock3 size={11} /> {formatElapsed(run, now)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{run.task}</p>

              <div ref={scroller} className="mt-3 space-y-1.5">
                {run.stages.map((stage) => (
                  <StageRow
                    key={stage.id}
                    stage={stage}
                    open={expanded === stage.id}
                    onToggle={() => setExpanded((current) => (current === stage.id ? null : stage.id))}
                  />
                ))}
              </div>

              {run.summary && (
                <details className="mt-3 rounded-lg border border-line bg-ink-1000/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11.5px] font-medium text-fg-2">Report</summary>
                  <div className="mt-2 text-[12px]">
                    <Markdown>{run.summary}</Markdown>
                  </div>
                </details>
              )}

              {run.diff && (
                <details className="mt-2 rounded-lg border border-line bg-ink-1000/40 px-3 py-2">
                  <summary className="cursor-pointer text-[11.5px] font-medium text-fg-2">Diff</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted">
                    {run.diff}
                  </pre>
                </details>
              )}

              {run.error && (
                <p className="mt-2 rounded-md border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-[11.5px] text-danger/90">
                  {run.error}
                </p>
              )}
            </div>
          </div>
        )}

        {/* history */}
        <div className="mt-6">
          <SectionLabel right={<span className="font-mono text-[10px] text-faint">last {runs.length}</span>}>History</SectionLabel>
          {runs.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-faint">
              No runs yet. Assign the roles and give the crew a task.
            </p>
          ) : (
            <div className="mt-2 overflow-hidden rounded-xl border border-line">
              {runs.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => setRun(entry)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-line-soft px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.03]',
                    run?.id === entry.id && 'bg-white/[0.03]',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      entry.status === 'done' && 'bg-ok',
                      entry.status === 'failed' && 'bg-danger',
                      entry.status === 'running' && 'bg-accent pulse-dot',
                      entry.status === 'cancelled' && 'bg-faint',
                      entry.status === 'queued' && 'bg-faint',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{entry.task}</span>
                  <span className="hidden font-mono text-[9.5px] uppercase tracking-wider text-faint sm:inline">{entry.shape}</span>
                  <span className="font-mono text-[10px] text-faint">{relativeTime(entry.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          <TerminalSquare size={11} /> stages run as processes · output capped · timeouts kill the tree
        </p>
      </div>
    </div>
  );
}

function StageRow({ stage, open, onToggle }: { stage: CliStage; open: boolean; onToggle: () => void }) {
  const Icon =
    stage.status === 'running'
      ? Loader2
      : stage.status === 'done'
        ? Check
        : stage.status === 'failed'
          ? X
          : stage.status === 'cancelled' || stage.status === 'skipped'
            ? Square
            : Clock3;
  const duration = stage.startedAt
    ? Math.max(0, ((stage.endedAt ?? Date.now()) - stage.startedAt) / 1000)
    : undefined;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border transition-colors',
        stage.status === 'running'
          ? 'border-accent/30 bg-accent/[0.04]'
          : stage.status === 'failed'
            ? 'border-danger/25 bg-danger/[0.03]'
            : 'border-line-soft bg-ink-1000/30',
      )}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <Icon
          size={12}
          className={cn(
            stage.status === 'running' && 'animate-spin text-accent',
            stage.status === 'done' && 'text-ok',
            stage.status === 'failed' && 'text-danger',
            (stage.status === 'queued' || stage.status === 'skipped' || stage.status === 'cancelled') && 'text-faint',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-2">
          {stage.label}
          {stage.writes && (
            <span className="ml-1.5 rounded border border-accent/30 bg-accent/10 px-1 py-px font-mono text-[8.5px] uppercase tracking-wider text-accent">
              writes
            </span>
          )}
        </span>
        {stage.exitCode !== undefined && stage.exitCode !== null && (
          <span className="font-mono text-[9.5px] text-faint">exit {stage.exitCode}</span>
        )}
        {duration !== undefined && stage.status !== 'queued' && (
          <span className="font-mono text-[9.5px] text-faint">{duration.toFixed(1)}s</span>
        )}
        <ChevronDown size={11} className={cn('text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line-soft px-2.5 py-2">
          {stage.error && <p className="mb-1.5 text-[11px] text-danger/90">{stage.error}</p>}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted">
            {stage.output ? stage.output.slice(-12_000) : stage.status === 'queued' ? 'waiting…' : '(no output yet)'}
          </pre>
        </div>
      )}
    </div>
  );
}

function formatElapsed(run: CliCrewRun, now: number): string {
  const end = run.endedAt ?? (run.status === 'running' ? now : run.createdAt);
  const seconds = Math.max(0, Math.round((end - run.createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
