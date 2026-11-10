import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';

/**
 * Vesper does not have to be the only harness on the machine. Claude Code,
 * aider, opencode, Codex, Gemini and friends already have their own loops,
 * their own tooling and their own taste. This module finds them and runs them
 * headlessly in the workspace, so the console can delegate to the strongest
 * agent the user has installed instead of pretending to be all of them.
 *
 * Everything is approval-gated at the tool layer: an external agent edits real
 * files, so the user sees the exact command before it runs.
 */
export interface HarnessPreset {
  id: string;
  name: string;
  vendor: string;
  bin: string;
  homepage?: string;
  note: string;
  /** Non-interactive invocation: print the answer and exit. */
  args: string[];
  /** Flags that let it edit files without prompting. Only used when asked. */
  autonomousArgs?: string[];
  /** Whether {prompt} is a separate argument (false = append at the end). */
  promptPosition?: 'end' | 'replace';
}

export interface HarnessStatus {
  id: string;
  name: string;
  vendor: string;
  bin: string;
  available: boolean;
  path?: string;
  homepage?: string;
  note: string;
  autonomous: boolean;
  custom: boolean;
}

/** Well-known CLIs, in rough order of how often people ask for them. */
export const PRESETS: HarnessPreset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    homepage: 'https://claude.com/claude-code',
    note: 'Deep repo work, longest context, own subagents and hooks.',
    args: ['-p', '{prompt}'],
    autonomousArgs: ['--dangerously-skip-permissions'],
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'Aider',
    bin: 'aider',
    homepage: 'https://aider.chat',
    note: 'Git-native pair programming; every edit becomes a commit.',
    args: ['--yes', '--no-check-update', '--no-pretty', '--message', '{prompt}'],
  },
  {
    id: 'opencode',
    name: 'opencode',
    vendor: 'SST',
    bin: 'opencode',
    homepage: 'https://opencode.ai',
    note: 'Open-source terminal agent with providers of its own.',
    args: ['run', '{prompt}'],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    bin: 'codex',
    homepage: 'https://github.com/openai/codex',
    note: 'Sandboxed exec mode; strong on refactors and tests.',
    args: ['exec', '--skip-git-repo-check', '{prompt}'],
    autonomousArgs: ['--full-auto'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    bin: 'gemini',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    note: 'Generous free tier; good for large-context reading.',
    args: ['-p', '{prompt}'],
    autonomousArgs: ['--yolo'],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    bin: 'qwen',
    homepage: 'https://github.com/QwenLM/qwen-code',
    note: 'Gemini-CLI fork tuned for Qwen coder models.',
    args: ['-p', '{prompt}'],
    autonomousArgs: ['--yolo'],
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    vendor: 'Cursor',
    bin: 'cursor-agent',
    note: 'The Cursor agent, headless.',
    args: ['-p', '{prompt}', '--output-format', 'text'],
    autonomousArgs: ['--force'],
  },
  {
    id: 'crush',
    name: 'Crush',
    vendor: 'Charm',
    bin: 'crush',
    homepage: 'https://github.com/charmbracelet/crush',
    note: 'Fast terminal agent with session management.',
    args: ['run', '{prompt}'],
  },
  {
    id: 'goose',
    name: 'Goose',
    vendor: 'Block',
    bin: 'goose',
    homepage: 'https://block.github.io/goose/',
    note: 'Extensible agent; drive it with its own extensions.',
    args: ['run', '-t', '{prompt}'],
  },
  {
    id: 'amp',
    name: 'Amp',
    vendor: 'Sourcegraph',
    bin: 'amp',
    note: 'Sourcegraph’s CLI agent.',
    args: ['-x', '{prompt}'],
  },
  {
    id: 'pi',
    name: 'Pi',
    vendor: 'Pi',
    bin: 'pi',
    note: 'Minimal coding agent; useful on small models.',
    args: ['-p', '{prompt}'],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    vendor: 'OpenClaw',
    bin: 'openclaw',
    note: 'Autonomous computer-use agent CLI.',
    args: ['run', '{prompt}'],
  },
];

interface CustomHarness {
  id?: string;
  name?: string;
  bin: string;
  args?: string[];
  autonomousArgs?: string[];
  note?: string;
}

const EXTRA_BIN_DIRS = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.cargo', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.volta', 'bin'),
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.deno', 'bin'),
  join(homedir(), 'go', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  ...(process.platform === 'win32'
    ? [
        join(process.env.APPDATA ?? '', 'npm'),
        join(process.env.LOCALAPPDATA ?? '', 'Programs'),
        join(homedir(), 'AppData', 'Roaming', 'npm'),
        join(homedir(), 'AppData', 'Local', 'Programs'),
      ]
    : []),
];

const WIN_EXTS = ['', '.cmd', '.exe', '.bat', '.ps1'];

/** Finds a CLI even when the app was launched from a GUI with a thin PATH. */
export function findBinary(bin: string): string | undefined {
  if (!bin.trim()) return undefined;
  if (bin.includes('/') || bin.includes('\\')) return existsSync(bin) ? bin : undefined;
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...EXTRA_BIN_DIRS].filter(Boolean);
  const exts = process.platform === 'win32' ? WIN_EXTS : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${bin}${ext}`);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* unreadable directory, keep looking */
      }
    }
  }
  return undefined;
}

function customHarnesses(): HarnessPreset[] {
  const file = join(PATHS.home, 'harnesses.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as CustomHarness[] | { harnesses?: CustomHarness[] };
    const list = Array.isArray(parsed) ? parsed : parsed.harnesses ?? [];
    return list
      .filter((entry) => entry && typeof entry.bin === 'string')
      .map((entry, index) => ({
        id: (entry.id ?? entry.bin).toLowerCase().replace(/[^a-z0-9-]/g, '-') || `custom-${index}`,
        name: entry.name ?? entry.bin,
        vendor: 'Custom',
        bin: entry.bin,
        note: entry.note ?? 'Registered in harnesses.json.',
        args: Array.isArray(entry.args) && entry.args.length ? entry.args : ['{prompt}'],
        autonomousArgs: entry.autonomousArgs,
      }));
  } catch {
    return [];
  }
}

export function allHarnesses(): HarnessPreset[] {
  const custom = customHarnesses();
  const seen = new Set(custom.map((entry) => entry.bin));
  return [...custom, ...PRESETS.filter((preset) => !seen.has(preset.bin))];
}

let statusCache: { at: number; value: HarnessStatus[] } | null = null;

/** PATH scanning is cheap but not free; a short TTL keeps prompt building fast. */
export function harnessStatuses(force = false): HarnessStatus[] {
  if (!force && statusCache && Date.now() - statusCache.at < 20_000) return statusCache.value;
  const custom = new Set(customHarnesses().map((entry) => entry.id));
  const value = allHarnesses().map((preset) => {
    const path = findBinary(preset.bin);
    return {
      id: preset.id,
      name: preset.name,
      vendor: preset.vendor,
      bin: preset.bin,
      available: Boolean(path),
      path,
      homepage: preset.homepage,
      note: preset.note,
      autonomous: Boolean(preset.autonomousArgs?.length),
      custom: custom.has(preset.id),
    };
  });
  statusCache = { at: Date.now(), value };
  return value;
}

/** One line for the system prompt: what this machine can already drive. */
export function harnessSummary(): string | null {
  const ready = harnessStatuses().filter((status) => status.available);
  if (!ready.length) return null;
  return ready.map((status) => `${status.id} (${status.name})`).join(', ');
}

/** cmd.exe quoting for a shim: wrap every argument, double internal quotes. */
function quoteForCmd(bin: string, args: string[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [quote(bin), ...args.map(quote)].join(' ');
}

export interface HarnessRun {
  id: string;
  name: string;
  output: string;
  code: number | null;
  ms: number;
  timedOut: boolean;
  command: string;
}

const OUTPUT_CAP = 24_000;

export async function runHarness(input: {
  id: string;
  prompt: string;
  autonomous?: boolean;
  timeoutMs?: number;
  cwd?: string;
  signal?: AbortSignal;
}): Promise<HarnessRun> {
  const preset = allHarnesses().find((entry) => entry.id === input.id) ?? allHarnesses().find((entry) => entry.bin === input.id);
  if (!preset) {
    throw new Error(`Unknown harness "${input.id}". Available: ${allHarnesses().map((entry) => entry.id).join(', ')}`);
  }
  const binPath = findBinary(preset.bin);
  if (!binPath) {
    throw new Error(
      `${preset.name} is not installed (no \`${preset.bin}\` on PATH). Install it first${preset.homepage ? `: ${preset.homepage}` : '.'}`,
    );
  }

  // Windows caps a command line at ~8191 characters. Long briefs go through a
  // file the harness can read, which every one of these CLIs can do.
  let prompt = input.prompt;
  if (process.platform === 'win32' && prompt.length > 6000) {
    const dir = join(PATHS.home, 'harness-briefs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const brief = join(dir, `brief-${Date.now()}.md`);
    writeFileSync(brief, prompt, 'utf8');
    prompt = `Read the brief in ${brief} and carry it out completely.`;
  }

  const args = [...(input.autonomous && preset.autonomousArgs ? preset.autonomousArgs : []), ...preset.args].map((arg) =>
    arg.replace('{prompt}', prompt),
  );
  const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : PATHS.workspace;
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const timeoutMs = Math.min(900_000, Math.max(15_000, input.timeoutMs ?? 300_000));
  const started = Date.now();

  // .cmd/.bat shims need a shell; real executables are spawned directly so a
  // prompt containing & or | is never reinterpreted by cmd.exe.
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath);
  const command = [preset.bin, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');

  return await new Promise<HarnessRun>((resolve, reject) => {
    const child = needsShell
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', quoteForCmd(binPath, args)], {
          cwd,
          env: { ...process.env, CI: '1', TERM: 'dumb', NO_COLOR: '1' },
          windowsHide: true,
        })
      : spawn(binPath, args, {
          cwd,
          env: { ...process.env, CI: '1', TERM: 'dumb', NO_COLOR: '1' },
          windowsHide: true,
        });

    let output = '';
    let timedOut = false;
    let settled = false;

    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > OUTPUT_CAP * 2) output = output.slice(-OUTPUT_CAP * 2);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const abort = () => child.kill('SIGKILL');
    input.signal?.addEventListener('abort', abort, { once: true });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      const trimmed = output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP / 2)}\n…\n${output.slice(-OUTPUT_CAP / 2)}` : output;
      resolve({
        id: preset.id,
        name: preset.name,
        output: trimmed.trim() || '(no output)',
        code,
        ms: Date.now() - started,
        timedOut,
        command,
      });
    };

    child.on('error', (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      if (!settled) {
        settled = true;
        reject(new Error(`Could not start ${preset.name}: ${error.message}`));
      }
    });
    child.on('close', (code) => finish(code));
  });
}
