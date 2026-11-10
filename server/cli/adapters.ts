import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readKV } from '../kernel/kv.ts';
import { runStage, stripAnsi } from './runner.ts';
import type { CliAdapterInfo, CliRole } from '../../shared/types.ts';

/**
 * Adapters are data. Each one answers a single question: "how do I start this
 * tool for one non-interactive job, read-only or with edits?" Everything else
 * — scheduling, handoffs, approvals — is Vesper's job.
 *
 * Presets reflect the documented headless flags as of late 2026. Tools change
 * their flags; users can override any field in ~/.vesper/cli.json, and a failed
 * detection reports the version error instead of pretending the CLI is ready.
 */

export interface CliAdapter {
  id: string;
  label: string;
  command: string;
  /** `arg` puts the brief into {prompt}; `stdin` pipes it. */
  promptVia: 'stdin' | 'arg';
  readArgs: string[];
  writeArgs: string[];
  capabilities: CliRole[];
  install?: string;
  notes?: string;
  builtin: boolean;
}

const ALL_ROLES: CliRole[] = ['scout', 'build', 'verify', 'review', 'fix'];

export const BUILTIN_ADAPTERS: CliAdapter[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    promptVia: 'arg',
    readArgs: ['-p', '{prompt}', '--permission-mode', 'plan', '--output-format', 'text'],
    writeArgs: ['-p', '{prompt}', '--permission-mode', 'acceptEdits', '--output-format', 'text'],
    capabilities: ALL_ROLES,
    install: 'npm install -g @anthropic-ai/claude-code',
    notes: 'Plan mode is read-only; acceptEdits allows file edits without prompting.',
    builtin: true,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    promptVia: 'stdin',
    readArgs: ['exec', '-', '--sandbox', 'read-only', '--ask-for-approval', 'never'],
    writeArgs: ['exec', '-', '--sandbox', 'workspace-write', '--ask-for-approval', 'never'],
    capabilities: ALL_ROLES,
    install: 'npm install -g @openai/codex',
    notes: 'Reads the brief from stdin (`codex exec -`); the sandbox stays inside the workspace.',
    builtin: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    promptVia: 'arg',
    readArgs: ['-p', '{prompt}', '--approval-mode=plan', '--output-format', 'text'],
    writeArgs: ['-p', '{prompt}', '--approval-mode=auto_edit', '--output-format', 'text'],
    capabilities: ALL_ROLES,
    install: 'npm install -g @google/gemini-cli',
    notes: 'Plan mode cannot edit; auto_edit approves edit tools only.',
    builtin: true,
  },
  {
    id: 'aider',
    label: 'Aider',
    command: 'aider',
    promptVia: 'arg',
    readArgs: ['--message', '{prompt}', '--chat-mode', 'ask', '--no-pretty'],
    writeArgs: ['--message', '{prompt}', '--yes-always', '--no-pretty', '--no-auto-commits'],
    capabilities: ALL_ROLES,
    install: 'python -m pip install aider-install && aider-install',
    notes: 'Ask mode never edits. The crew disables Aider auto-commits so the diff stays reviewable.',
    builtin: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    promptVia: 'arg',
    readArgs: ['run', '{prompt}', '--agent', 'plan'],
    writeArgs: ['run', '{prompt}', '--auto'],
    capabilities: ALL_ROLES,
    install: 'npm install -g opencode-ai',
    notes: 'The Plan agent refuses edits; --auto approves anything not explicitly denied.',
    builtin: true,
  },
  {
    id: 'generic',
    label: 'Custom command',
    command: '',
    promptVia: 'stdin',
    readArgs: [],
    writeArgs: [],
    capabilities: ['scout', 'review', 'verify'],
    install: 'Set "command" and "args" under overrides.generic in ~/.vesper/cli.json',
    notes: 'Runs any command that reads a prompt on stdin and prints text on stdout.',
    builtin: true,
  },
];

interface AdapterFile {
  overrides?: Record<string, Partial<Pick<CliAdapter, 'command' | 'readArgs' | 'writeArgs' | 'promptVia' | 'capabilities' | 'install'>>>;
  custom?: CliAdapter[];
}

function loadFile(): AdapterFile {
  return readKV<AdapterFile>('cli', {});
}

export function adapters(): CliAdapter[] {
  const file = loadFile();
  const merged = BUILTIN_ADAPTERS.map((adapter) => ({
    ...adapter,
    ...(file.overrides?.[adapter.id] ?? {}),
    id: adapter.id,
    builtin: true,
  }));
  const custom = (file.custom ?? []).map((adapter) => ({
    ...adapter,
    id: String(adapter.id),
    builtin: false,
  }));
  return [...merged, ...custom].filter((adapter) => adapter.id !== 'generic' || adapter.command);
}

export function adapterById(id: string): CliAdapter | undefined {
  return adapters().find((adapter) => adapter.id === id);
}

/** Build the argv for one stage, or report that the adapter needs config. */
export function buildArgs(
  adapter: CliAdapter,
  write: boolean,
  prompt: string,
): { args: string[]; stdin?: string } {
  if (!adapter.command) {
    throw new Error(`${adapter.label} has no command configured. Add it in ~/.vesper/cli.json.`);
  }
  const template = write ? adapter.writeArgs : adapter.readArgs;
  if (adapter.promptVia === 'stdin') {
    return { args: template.filter((arg) => arg !== '{prompt}'), stdin: prompt };
  }
  // cmd.exe cannot carry newlines or very long arguments. Collapse and bound.
  const flat = prompt.replace(/\s+/g, ' ').trim().slice(0, 6_000);
  return { args: template.map((arg) => (arg === '{prompt}' ? flat : arg)) };
}

// --- detection ---------------------------------------------------------------

let cache: { at: number; value: CliAdapterInfo[] } | null = null;
const CACHE_MS = 30_000;

export async function adapterInfos(force = false): Promise<CliAdapterInfo[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const list = await Promise.all(adapters().map(describe));
  cache = { at: Date.now(), value: list };
  return list;
}

async function describe(adapter: CliAdapter): Promise<CliAdapterInfo> {
  const base: CliAdapterInfo = {
    id: adapter.id,
    label: adapter.label,
    command: adapter.command,
    available: false,
    capabilities: adapter.capabilities,
    promptVia: adapter.promptVia,
    install: adapter.install,
    notes: adapter.notes,
    builtin: adapter.builtin,
  };
  if (!adapter.command) return { ...base, error: 'No command configured.' };

  const resolved = await resolveCommand(adapter.command);
  if (!resolved) {
    return { ...base, error: `“${adapter.command}” is not on PATH. ${adapter.install ?? ''}`.trim() };
  }
  const version = await versionOf(resolved);
  return {
    ...base,
    command: resolved,
    available: true,
    version,
    error: version ? undefined : 'Found on PATH, but --version did not answer.',
  };
}

function resolveCommand(command: string): Promise<string | null> {
  if (command.includes('/') || command.includes('\\')) {
    return Promise.resolve(existsSync(command) ? command : null);
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(finder, [command], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 4_000);
    child.stdout?.on('data', (data: Buffer) => {
      if (out.length < 4_000) out += data.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const first = stripAnsi(out)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(code === 0 && first ? first : null);
    });
  });
}

function versionOf(command: string): Promise<string | undefined> {
  return runStage({ command, args: ['--version'], cwd: process.cwd(), timeoutMs: 6_000 })
    .then((result) => {
      const line = stripAnsi(result.output)
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.length > 0);
      return line && result.exitCode === 0 ? line.slice(0, 120) : undefined;
    })
    .catch(() => undefined);
}

/** Default role assignment: prefer a different CLI for each role. */
export function defaultRoles(available: CliAdapterInfo[]): Partial<Record<CliRole, string>> {
  const usable = available.filter((adapter) => adapter.available);
  if (!usable.length) return {};
  const pick = (role: CliRole, offset = 0) => {
    const candidates = usable.filter((adapter) => adapter.capabilities.includes(role));
    if (!candidates.length) return usable[0]?.id;
    return candidates[offset % candidates.length]?.id;
  };
  return {
    scout: pick('scout', 0),
    build: pick('build', 1),
    verify: pick('verify', 2),
    review: pick('review', 3),
  };
}

export function resetAdapterCache(): void {
  cache = null;
}

/** Where a missing adapter should be installed, for the UI. */
export function adapterInstallHint(id: string): string | undefined {
  return BUILTIN_ADAPTERS.find((adapter) => adapter.id === id)?.install;
}

/** Data directory for crew handoffs and transcripts. */
export function crewRoot(home: string): string {
  return join(home, 'crew');
}
