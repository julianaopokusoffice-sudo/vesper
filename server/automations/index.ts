import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { store } from '../kernel/store.ts';
import { PATHS } from '../kernel/paths.ts';
import { BUILTIN_AGENTS } from '../agents/builtin.ts';
import { runHeadless } from '../agent/orchestrator.ts';
import type { Agent, Automation } from '../../shared/types.ts';

/**
 * Scheduled runs — the part of “autonomous research” that is actually useful:
 * a task you write once, a read-only researcher that executes it on a cadence,
 * and a markdown briefing that lands in your deliverables.
 *
 * Scheduled runs never get mutating tools. A cron job that can rewrite files or
 * run shell commands while you are asleep is not an assistant, it is a risk. The
 * tool allow-list below is the grant, and it is deliberately read-only plus the
 * library (which is undoable and local).
 */

const READ_ONLY_TOOLS = [
  'clock',
  'calculator',
  'web_search',
  'fetch_url',
  'search_papers',
  'read_paper',
  'library_search',
  'library_cite',
  'library_save',
  'list_files',
  'read_file',
  'load_skill',
  'harnesses',
  'studio_state',
  'git_status',
  'git_diff',
  'git_log',
];

const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;

export function startAutomations(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 30_000);
  timer.unref?.();
  setTimeout(() => void tick(), 4_000).unref?.();
}

export function stopAutomations(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const due = store()
    .listAutomations()
    .filter((job) => job.enabled && job.nextRunAt <= Date.now() && !running.has(job.id));
  for (const job of due) {
    await runAutomation(job.id, { manual: false }).catch((err) => {
      console.error(`[automation] ${job.name} failed:`, err instanceof Error ? err.message : err);
    });
  }
}

export interface AutomationRunResult {
  ok: boolean;
  output: string;
  ms: number;
  file?: string;
}

export async function runAutomation(id: string, options: { manual: boolean }): Promise<AutomationRunResult> {
  const db = store();
  const job = db.getAutomation(id);
  if (!job) throw new Error('No such automation');
  if (running.has(id)) throw new Error('That automation is already running');
  running.add(id);

  const started = Date.now();
  db.saveAutomation({ ...job, lastStatus: 'running', updatedAt: started });

  try {
    const persona = BUILTIN_AGENTS.find((entry) => entry.id === job.agentId) ?? BUILTIN_AGENTS.find((entry) => entry.id === 'atlas')!;
    const agent: Agent = {
      ...persona,
      id: `automation-${job.id}`,
      name: `${persona.name} (scheduled)`,
      tools: READ_ONLY_TOOLS,
      skills: ['deep-research'],
      maxSteps: 8,
      temperature: Math.min(persona.temperature, 0.4),
    };

    const prompt = [
      `# Scheduled task: ${job.name}`,
      job.prompt,
      '',
      `This is an unattended run at ${new Date().toISOString()}.`,
      'Use the research tools, read primary sources, and never invent a citation or number.',
      'Write the result as a self-contained markdown briefing: a five-line executive summary first, then the evidence with inline links, then what changed since a reader would last look, then open questions.',
      'Save the two or three most important papers to the library with a one-line note each.',
      'You cannot edit files or run shell commands in this run — produce the briefing as your answer.',
    ].join('\n');

    const result = await runHeadless({
      prompt,
      agent,
      workspace: PATHS.workspace,
      timeoutMs: 10 * 60_000,
    });

    const output = (result.content || result.error || '(no output)').trim();
    const ok = !result.error;
    const stamp = new Date(started).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync(PATHS.artifacts, { recursive: true, mode: 0o700 });
    const file = join(PATHS.artifacts, `automation-${slug(job.name)}-${stamp}.md`);
    writeFileSync(
      file,
      [
        `# ${job.name}`,
        `_Scheduled ${new Date(started).toLocaleString()} · every ${describeEvery(job.everyMinutes)} · ${agent.name}_`,
        '',
        output,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );

    const nextRunAt = options.manual
      ? job.nextRunAt || Date.now() + job.everyMinutes * 60_000
      : started + Math.max(job.everyMinutes, 1) * 60_000;

    db.saveAutomation({
      ...job,
      lastRunAt: started,
      lastStatus: ok ? 'ok' : 'error',
      lastOutput: output.slice(0, 20_000),
      nextRunAt,
      updatedAt: Date.now(),
    });

    return { ok, output, ms: Date.now() - started, file };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.saveAutomation({
      ...job,
      lastRunAt: started,
      lastStatus: 'error',
      lastOutput: message,
      nextRunAt: options.manual ? job.nextRunAt : Date.now() + Math.max(job.everyMinutes, 1) * 60_000,
      updatedAt: Date.now(),
    });
    return { ok: false, output: message, ms: Date.now() - started };
  } finally {
    running.delete(id);
  }
}

export function createAutomation(input: {
  name?: string;
  prompt?: string;
  agentId?: string;
  everyMinutes?: number;
  enabled?: boolean;
}): Automation {
  const now = Date.now();
  const prompt = String(input.prompt ?? '').trim();
  if (prompt.length < 12) throw new Error('Describe the task in at least a sentence.');
  const everyMinutes = clampMinutes(input.everyMinutes);
  const job: Automation = {
    id: randomUUID(),
    name: String(input.name ?? '').trim() || prompt.slice(0, 48),
    prompt,
    agentId: String(input.agentId ?? 'atlas'),
    everyMinutes,
    enabled: input.enabled !== false,
    nextRunAt: now + everyMinutes * 60_000,
    createdAt: now,
    updatedAt: now,
  };
  return store().saveAutomation(job);
}

export function updateAutomation(
  id: string,
  patch: { name?: string; prompt?: string; agentId?: string; everyMinutes?: number; enabled?: boolean; nextRunAt?: number },
): Automation {
  const current = store().getAutomation(id);
  if (!current) throw new Error('No such automation');
  const everyMinutes = patch.everyMinutes !== undefined ? clampMinutes(patch.everyMinutes) : current.everyMinutes;
  const next: Automation = {
    ...current,
    name: patch.name?.trim() || current.name,
    prompt: patch.prompt !== undefined ? String(patch.prompt) : current.prompt,
    agentId: patch.agentId ?? current.agentId,
    everyMinutes,
    enabled: patch.enabled ?? current.enabled,
    nextRunAt:
      patch.nextRunAt ??
      (everyMinutes !== current.everyMinutes ? Date.now() + everyMinutes * 60_000 : current.nextRunAt),
    updatedAt: Date.now(),
  };
  return store().saveAutomation(next);
}

export function isAutomationRunning(id: string): boolean {
  return running.has(id);
}

function clampMinutes(value: unknown): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 1) return 24 * 60;
  return Math.min(Math.round(minutes), 60 * 24 * 30);
}

function describeEvery(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (24 * 60))} d`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'briefing';
}
