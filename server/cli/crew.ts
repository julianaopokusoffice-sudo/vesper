import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PATHS } from '../kernel/paths.ts';
import { readKV, writeKV } from '../kernel/kv.ts';
import { adapterById, adapterInfos, adapters, buildArgs, defaultRoles } from './adapters.ts';
import type { CliAdapter } from './adapters.ts';
import { runStage, stripAnsi } from './runner.ts';
import type { CliCrewEvent, CliCrewRequest, CliCrewRun, CliRole, CliStage } from '../../shared/types.ts';

/**
 * The coordinator. It does not try to make CLIs talk to each other: it hires
 * each one for a stage, hands it a brief built from the previous stages, and
 * keeps a single writer in the workspace at a time. Cooperation is through
 * artifacts, not context windows.
 *
 * See docs/CLI-CREW.md for the reasoning.
 */

const MAX_RUNS = 20;
const DEFAULT_BUDGET = 20 * 60 * 1000;
const STAGE_TIMEOUT = 10 * 60 * 1000;
const HANDOFF_CHARS = 4_000;
const RECORD_OUTPUT = 12_000;

const ROLE_LABEL: Record<CliRole, string> = {
  scout: 'Scout',
  build: 'Build',
  verify: 'Verify',
  review: 'Review',
  fix: 'Fix',
};

const ROLE_CONTRACT: Record<CliRole, string> = {
  scout:
    'Do not modify files. Map the workspace, name the real constraints, list the files that matter, and propose a short plan with a verification step. Be concrete: file paths, commands, risks.',
  build:
    'Implement the task with the smallest correct change. You may edit files in the workspace. Do not commit, push, or install system packages. Finish with what you changed and how to verify it.',
  verify:
    'Do not modify files. Run the relevant tests or checks if you can, then report exact commands, exit codes, and failures with file:line. If a test cannot run, say why.',
  review:
    'Do not modify files. Review the diff adversarially: correctness, security, data loss, missing tests, and scope creep. Order findings by severity and cite file:line. Say plainly if the change is sound.',
  fix:
    'Address only the findings in the handoffs. Keep the diff small, do not refactor unrelated code, and do not commit. End with what you fixed and what remains.',
};

interface ActiveRun {
  controller: AbortController;
  cancelled: boolean;
}

const active = new Map<string, ActiveRun>();
const listeners = new Set<(event: CliCrewEvent) => void>();

export function subscribeCrew(listener: (event: CliCrewEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: CliCrewEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* one broken SSE client must not stop a run */
    }
  }
}

interface RunFile {
  runs: CliCrewRun[];
}

export function listRuns(): CliCrewRun[] {
  return readKV<RunFile>('cli-runs', { runs: [] }).runs ?? [];
}

export function getRun(id: string): CliCrewRun | undefined {
  return listRuns().find((run) => run.id === id);
}

function serialise(run: CliCrewRun): CliCrewRun {
  return {
    ...run,
    diff: run.diff?.slice(0, 40_000),
    summary: run.summary?.slice(0, 20_000),
    stages: run.stages.map((stage) => ({
      ...stage,
      output: stage.output.slice(-RECORD_OUTPUT),
    })),
  };
}

function persist(run: CliCrewRun): void {
  const runs = listRuns().filter((entry) => entry.id !== run.id);
  runs.unshift(serialise(run));
  writeKV('cli-runs', { runs: runs.slice(0, MAX_RUNS) });
}

export function cancelCrew(id: string): CliCrewRun {
  const state = active.get(id);
  const run = getRun(id);
  if (!run) throw new Error(`No crew run with id ${id}.`);
  if (!state) return run;
  state.cancelled = true;
  state.controller.abort();
  for (const stage of run.stages) {
    if (stage.status === 'queued') stage.status = 'cancelled';
  }
  run.stages = [...run.stages];
  persist(run);
  return run;
}

/**
 * Resolve roles, build the stage plan, and start executing in the background.
 * Callers get the run immediately; progress arrives as events.
 */
export async function startCrew(request: CliCrewRequest): Promise<CliCrewRun> {
  const task = request.task?.trim();
  if (!task) throw new Error('The crew needs a task.');
  const workspace = request.workspace?.trim() || PATHS.workspace;
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`Workspace not found: ${workspace}`);
  }

  const infos = await adapterInfos();
  const usable = infos.filter((info) => info.available);
  if (!usable.length) {
    throw new Error(
      'No agentic CLI was found on PATH. Install one (claude, codex, gemini, aider, opencode) or configure a custom adapter.',
    );
  }

  const shape = request.shape ?? 'crew';
  const fallback = defaultRoles(infos);
  const roleAdapter = (role: CliRole): string => {
    const wanted = request.roles?.[role] ?? fallback[role];
    const chosen = wanted ? infos.find((info) => info.id === wanted && info.available) : undefined;
    if (chosen) return chosen.id;
    const candidate = usable.find((info) => info.capabilities.includes(role)) ?? usable[0];
    return candidate.id;
  };

  const stages: CliStage[] = [];
  const add = (role: CliRole, writes: boolean, dependsOn: string[]) => {
    const adapterId = roleAdapter(role);
    const adapter = adapterById(adapterId);
    const stage: CliStage = {
      id: `s${stages.length + 1}`,
      role,
      adapterId,
      label: `${ROLE_LABEL[role]} · ${adapter?.label ?? adapterId}`,
      status: 'queued',
      writes,
      dependsOn,
      output: '',
    };
    stages.push(stage);
    return stage.id;
  };

  if (shape === 'solo') {
    add('build', true, []);
  } else {
    const scout = add('scout', false, []);
    const build = add('build', true, [scout]);
    if (shape === 'crew') {
      add('verify', false, [build]);
      add('review', false, [build]);
      if (request.fix) {
        const verify = stages[2].id;
        const review = stages[3].id;
        add('fix', true, [verify, review]);
      }
    }
  }

  const run: CliCrewRun = {
    id: randomUUID(),
    task,
    workspace,
    shape,
    status: 'running',
    createdAt: Date.now(),
    stages,
    adapterIds: [...new Set(stages.map((stage) => stage.adapterId))],
  };

  const state: ActiveRun = { controller: new AbortController(), cancelled: false };
  active.set(run.id, state);
  persist(run);
  emit({ type: 'run_start', run });

  void execute(run, state, request.budgetMs ?? DEFAULT_BUDGET)
    .catch((err) => {
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      run.endedAt = Date.now();
      active.delete(run.id);
      persist(run);
      emit({ type: 'run_end', run });
    });

  return run;
}

async function execute(run: CliCrewRun, state: ActiveRun, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const byRole = new Map<CliRole, CliStage>();
  for (const stage of run.stages) if (!byRole.has(stage.role)) byRole.set(stage.role, stage);

  const handoffs: { role: CliRole; stage: CliStage }[] = [];
  const markCancelled = () => {
    if (!state.cancelled) return;
    for (const stage of run.stages) {
      if (stage.status === 'queued') stage.status = 'cancelled';
    }
  };

  const runOne = async (stage: CliStage, write: boolean): Promise<boolean> => {
    if (state.cancelled) {
      stage.status = 'cancelled';
      return false;
    }
    if (Date.now() > deadline) {
      stage.status = 'skipped';
      stage.error = 'The crew budget ran out before this stage.';
      return false;
    }
    const adapter = adapterById(stage.adapterId);
    if (!adapter?.command) {
      stage.status = 'skipped';
      stage.error = `Adapter ${stage.adapterId} is not configured.`;
      return false;
    }

    const brief = buildBrief(run, stage, handoffs, write);
    stage.status = 'running';
    stage.startedAt = Date.now();
    persist(run);
    emit({ type: 'stage_start', runId: run.id, stage });

    let pending = '';
    let lastFlush = 0;
    const flush = () => {
      if (!pending) return;
      emit({ type: 'chunk', runId: run.id, stageId: stage.id, text: pending });
      pending = '';
    };

    try {
      const { args, stdin } = buildArgs(adapter, write, brief);
      const result = await runStage({
        command: adapter.command,
        args,
        cwd: run.workspace,
        stdin,
        timeoutMs: Math.min(STAGE_TIMEOUT, Math.max(5_000, deadline - Date.now())),
        signal: state.controller.signal,
        onChunk: (text) => {
          pending += text;
          if (pending.length > 4_000 || Date.now() - lastFlush > 300) {
            lastFlush = Date.now();
            flush();
          }
        },
      });
      flush();
      stage.endedAt = Date.now();
      stage.exitCode = result.exitCode;
      stage.timedOut = result.timedOut;
      stage.output = result.output;
      if (result.aborted || state.cancelled) {
        stage.status = 'cancelled';
      } else if (result.timedOut) {
        stage.status = 'failed';
        stage.error = `Timed out after ${Math.round(result.durationMs / 1000)}s.`;
      } else if (result.exitCode === 0) {
        stage.status = 'done';
      } else {
        stage.status = 'failed';
        stage.error = `${adapter.label} exited with code ${result.exitCode}.`;
      }
    } catch (err) {
      stage.endedAt = Date.now();
      stage.status = state.cancelled ? 'cancelled' : 'failed';
      stage.error = err instanceof Error ? err.message : String(err);
    }

    if (stage.status === 'done' || stage.status === 'failed') {
      handoffs.push({ role: stage.role, stage });
      writeHandoff(run, stage);
    }
    persist(run);
    emit({ type: 'stage_end', runId: run.id, stage });
    return stage.status === 'done';
  };

  const scout = byRole.get('scout');
  const build = byRole.get('build');
  const verify = byRole.get('verify');
  const review = byRole.get('review');
  const fix = byRole.get('fix');

  // A failed scout is not fatal: build still gets the task and can look around.
  if (scout) await runOne(scout, false);
  markCancelled();

  const built = build ? await runOne(build, true) : true;
  markCancelled();

  if (!built) {
    for (const stage of [verify, review, fix]) {
      if (stage && stage.status === 'queued') {
        stage.status = 'skipped';
        stage.error = 'The build stage failed, so there is nothing to verify.';
      }
    }
  } else {
    // Read-only stages are independent and safely parallel: no writes.
    const parallel: Promise<boolean>[] = [];
    if (verify) parallel.push(runOne(verify, false));
    if (review) parallel.push(runOne(review, false));
    if (parallel.length) await Promise.all(parallel);
    markCancelled();

    if (fix) {
      const verifyOk = verify ? verify.status === 'done' : true;
      const reviewOk = review ? review.status === 'done' : true;
      if (!verifyOk || !reviewOk) await runOne(fix, true);
      else {
        fix.status = 'skipped';
        fix.error = 'Verify and review both passed; no fix stage needed.';
      }
    }
  }

  for (const stage of run.stages) {
    if (stage.status === 'queued') stage.status = 'skipped';
  }

  run.diff = await captureDiff(run.workspace);
  run.summary = buildSummary(run);

  const failed = run.stages.some((stage) => stage.status === 'failed' && stage.role !== 'scout' && stage.role !== 'review');
  if (state.cancelled) run.status = 'cancelled';
  else if (failed) run.status = 'failed';
  else run.status = 'done';
  persist(run);
}

// --- briefs and handoffs -----------------------------------------------------

function buildBrief(
  run: CliCrewRun,
  stage: CliStage,
  handoffs: { role: CliRole; stage: CliStage }[],
  write: boolean,
): string {
  // build gets the scout brief; verify/review get scout + build; fix gets the
  // findings it is supposed to address.
  const deps =
    stage.role === 'scout'
      ? []
      : stage.role === 'build'
        ? handoffs.filter((entry) => entry.role === 'scout')
        : handoffs.filter((entry) => entry.stage.id !== stage.id);
  const handoffText = deps.length
    ? deps
        .map(({ role, stage: done }) => {
          const label = `${ROLE_LABEL[role]} (${adapterById(done.adapterId)?.label ?? done.adapterId})`;
          const body = clip(done.output || done.error || '(no output)', HANDOFF_CHARS);
          return `### ${label} — ${done.status}, exit ${done.exitCode ?? 'n/a'}\n${body}`;
        })
        .join('\n\n')
    : '(none yet — you are the first stage)';

  return [
    `# Vesper crew · ${ROLE_LABEL[stage.role]} stage`,
    '',
    '## Task',
    run.task,
    '',
    '## Your contract',
    ROLE_CONTRACT[stage.role],
    write
      ? 'You may edit files in the workspace. Stay inside it.'
      : 'This stage is read-only. Do not edit, create, or delete files.',
    '',
    '## Workspace',
    run.workspace,
    '',
    '## Handoffs from earlier stages',
    handoffText,
    '',
    '## Rules',
    '- Work only inside the workspace above.',
    '- Do not commit, push, change branches, or install system packages.',
    '- If you are blocked, say what is missing instead of guessing.',
    '- End with a short report: what you did, what you found, and how to verify it.',
    '',
    `_Crew ${run.id} · shape ${run.shape} · stage ${stage.id}_`,
  ].join('\n');
}

function clip(text: string, limit: number): string {
  const clean = stripAnsi(text).trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}\n… [handoff truncated]`;
}

function writeHandoff(run: CliCrewRun, stage: CliStage): void {
  try {
    const dir = join(PATHS.home, 'crew', run.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const index = String(run.stages.indexOf(stage) + 1).padStart(2, '0');
    writeFileSync(
      join(dir, `${index}-${stage.role}.md`),
      `# ${ROLE_LABEL[stage.role]} · ${adapterById(stage.adapterId)?.label ?? stage.adapterId}\n\n` +
        `Status: ${stage.status} · exit ${stage.exitCode ?? 'n/a'}${stage.timedOut ? ' · timed out' : ''}\n\n` +
        `${stage.error ? `Error: ${stage.error}\n\n` : ''}${stage.output || '(no output)'}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* the transcript is already in the run record */
  }
}

// --- results -----------------------------------------------------------------

async function captureDiff(workspace: string): Promise<string | undefined> {
  try {
    const [stat, diff, status] = await Promise.all([
      runStage({ command: 'git', args: ['diff', '--stat', '--no-color'], cwd: workspace, timeoutMs: 15_000 }),
      runStage({ command: 'git', args: ['diff', '--no-color', '--no-ext-diff'], cwd: workspace, timeoutMs: 20_000 }),
      runStage({ command: 'git', args: ['status', '--porcelain'], cwd: workspace, timeoutMs: 15_000 }),
    ]);
    if (stat.exitCode !== 0 || diff.exitCode !== 0) return undefined;
    const statText = stat.output.trim();
    const statusText = status.output.trim();
    const diffText = diff.output.trim();
    if (!statText && !statusText && !diffText) return undefined;
    return [
      statText ? `## Diffstat\n${statText}` : '',
      statusText ? `## Working tree\n${statusText}` : '',
      diffText ? `## Diff\n${diffText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 40_000);
  } catch {
    return undefined;
  }
}

function buildSummary(run: CliCrewRun): string {
  const rows = run.stages
    .map((stage) => {
      const ms = stage.startedAt && stage.endedAt ? `${Math.round((stage.endedAt - stage.startedAt) / 1000)}s` : '—';
      const adapter = adapterById(stage.adapterId)?.label ?? stage.adapterId;
      return `| ${ROLE_LABEL[stage.role]} | ${adapter} | ${stage.status} | ${stage.exitCode ?? '—'} | ${ms} |`;
    })
    .join('\n');

  const findings = run.stages
    .filter((stage) => stage.role === 'review' || stage.role === 'verify')
    .map((stage) => {
      const tail = clip(stage.output, 2_500);
      return tail ? `### ${ROLE_LABEL[stage.role]}\n${tail}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const changed = run.diff
    ? `\n## Changes\n\`\`\`\n${clip(run.diff.split('## Diff')[0]?.trim() ?? '', 2_000)}\n\`\`\``
    : '\n## Changes\nNo tracked diff was produced.';

  return [
    `# Crew report`,
    '',
    `**Task** ${run.task}`,
    `**Workspace** ${run.workspace}`,
    `**Shape** ${run.shape}`,
    '',
    '| Stage | CLI | Status | Exit | Time |',
    '| --- | --- | --- | --- | --- |',
    rows,
    changed,
    findings ? `\n## Findings\n${findings}` : '',
    run.status === 'failed' ? '\n**The crew did not finish cleanly. Read the failed stage before trusting the diff.**' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Formats a run for an agent tool result. */
export function formatRun(run: CliCrewRun): string {
  const stages = run.stages
    .map((stage) => {
      const head = `## ${ROLE_LABEL[stage.role]} — ${stage.status} (exit ${stage.exitCode ?? 'n/a'})`;
      const body = clip(stage.output || stage.error || '(no output)', 3_000);
      return `${head}\n${body}`;
    })
    .join('\n\n');
  return [
    `# Crew ${run.id}`,
    `status: ${run.status} · shape: ${run.shape} · workspace: ${run.workspace}`,
    run.error ? `error: ${run.error}` : '',
    stages,
    run.diff ? `\n## Diff\n${clip(run.diff, 4_000)}` : '',
    run.summary ? `\n## Report\n${clip(run.summary, 6_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Wait for a run to leave the running state, with a ceiling. */
export async function awaitRun(id: string, timeoutMs = 25 * 60 * 1000): Promise<CliCrewRun> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = getRun(id);
    if (!run) throw new Error(`No crew run with id ${id}.`);
    if (run.status !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return getRun(id)!;
}

/** Run one adapter as a single stage, for `cli_run`. */
export async function runSingle(options: {
  adapterId: string;
  task: string;
  workspace: string;
  write: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}): Promise<{ adapter: CliAdapter; output: string; exitCode: number | null; durationMs: number }> {
  const adapter = adapterById(options.adapterId);
  if (!adapter) throw new Error(`Unknown adapter: ${options.adapterId}`);
  if (!adapter.command) throw new Error(`${adapter.label} is not configured.`);
  if (!existsSync(options.workspace)) throw new Error(`Workspace not found: ${options.workspace}`);

  const role: CliRole = options.write ? 'build' : 'scout';
  const brief = [
    `# Vesper · ${ROLE_LABEL[role]} stage`,
    '',
    '## Task',
    options.task,
    '',
    '## Your contract',
    ROLE_CONTRACT[role],
    options.write ? 'You may edit files in the workspace.' : 'This stage is read-only. Do not edit files.',
    '',
    '## Workspace',
    options.workspace,
    '',
    '## Rules',
    '- Work only inside the workspace.',
    '- Do not commit, push, or install system packages.',
    '- End with a short report.',
  ].join('\n');
  const { args, stdin } = buildArgs(adapter, options.write, brief);
  const result = await runStage({
    command: adapter.command,
    args,
    cwd: options.workspace,
    stdin,
    timeoutMs: STAGE_TIMEOUT,
    signal: options.signal,
    onChunk: options.onChunk,
  });
  return { adapter, output: result.output, exitCode: result.exitCode, durationMs: result.durationMs };
}

/** Adapter ids that are currently on PATH, for quick checks. */
export function availableAdapterIds(): string[] {
  return adapters()
    .filter((adapter) => adapter.command)
    .map((adapter) => adapter.id);
}
