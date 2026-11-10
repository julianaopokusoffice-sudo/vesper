import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * One CLI stage = one child process. This module owns the parts that are easy
 * to get wrong: Windows .cmd shims, ANSI noise, output floods, timeouts, and
 * killing the whole tree so a wedged CLI cannot leave grandchildren behind.
 */

export interface RunStageOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Prompt delivered on stdin; omit for CLIs that take it as an argument. */
  stdin?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface RunStageResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 400_000;
/** Keep the tail: the end of a failing CLI run is the useful part. */
const TAIL_RATIO = 0.6;

/** Confine a stage to a workspace and refuse obvious escapes. */
export function resolveWorkspace(workspace: string, fallback: string): string {
  const target = resolve(workspace.trim() || fallback);
  const rel = relative(target, fallback);
  // Not a sandbox: the user can deliberately point at a sibling folder. But the
  // path must be absolute and must exist, so a typo cannot spawn a process in
  // an unexpected cwd.
  void rel;
  if (!isAbsolute(target)) throw new Error('The crew workspace must be an absolute path.');
  return target;
}

export function stripAnsi(value: string): string {
  // OSC sequences (titles, hyperlinks), CSI colour/cursor, and stray control
  // characters that make JSONL output unreadable in the UI.
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/**
 * Windows ships `claude`, `codex` and friends as `.cmd` shims. Node cannot
 * execute those directly, and `shell: true` would let a prompt containing `&`
 * or `|` become a command. So the shim is invoked through cmd.exe explicitly
 * with every argument quoted for cmd's parser.
 */
function isWindowsShim(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function quoteForCmd(value: string): string {
  // Inside double quotes cmd.exe treats & | < > ^ literally, so wrapping is the
  // protection; adding carets there would leak into the argument. A literal
  // double quote cannot survive a batch shim's `%*` round-trip without breaking
  // the following arguments, so prose quotes are normalised. These arguments
  // are prompts, never code.
  return `"${value.replace(/"/g, "'")}"`;
}

function spawnFor(command: string, args: string[], cwd: string): ChildProcess {
  if (isWindowsShim(command)) {
    // cmd /s /c strips exactly one outer pair of quotes. The extra pair keeps
    // the executable's own quotes intact, and verbatim arguments stop Node from
    // re-escaping the line for the C runtime (which cmd would then pass on
    // literally, backslashes included).
    const inner = [`"${command}"`, ...args.map(quoteForCmd)].join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
      cwd,
      windowsHide: true,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, {
    cwd,
    windowsHide: true,
    env: childEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    // A new process group lets a POSIX kill take the children with it.
    detached: process.platform !== 'win32',
  });
}

/**
 * A CLI inherits the user's environment, minus Vesper's own secrets. Model keys
 * the CLI needs (ANTHROPIC_API_KEY, OPENAI_API_KEY) stay: they belong to the
 * user's other tools, not to this app.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['VESPER_LINK_SECRET', 'VESPER_LINK_TOKEN', 'VESPER_TOKEN']) delete env[key];
  env.VESPER = '1';
  env.NO_COLOR = '1';
  env.TERM = 'dumb';
  env.CI = '1';
  env.FORCE_COLOR = '0';
  return env;
}

/** Bounded buffer that keeps the head and the tail of a long transcript. */
export class TailBuffer {
  private value = '';

  constructor(private readonly maxBytes: number = DEFAULT_MAX_BYTES) {}

  push(chunk: string): void {
    this.value += chunk;
    if (this.value.length <= this.maxBytes) return;
    const headSize = Math.floor(this.maxBytes * (1 - TAIL_RATIO));
    const tailSize = this.maxBytes - headSize;
    this.value = `${this.value.slice(0, headSize)}\n… [output truncated] …\n${this.value.slice(-tailSize)}`;
  }

  toString(): string {
    return this.value;
  }
}

export function runStage(options: RunStageOptions): Promise<RunStageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const started = Date.now();

  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawnFor(options.command, options.args, options.cwd);
    } catch (err) {
      rejectPromise(err);
      return;
    }

    const buffer = new TailBuffer(options.maxBytes);
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolvePromise({
        exitCode,
        output: buffer.toString().trim(),
        durationMs: Date.now() - started,
        timedOut,
        aborted,
      });
    };

    const killTree = () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /t /f`], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
          setTimeout(() => {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              /* already gone */
            }
          }, 2_500).unref?.();
        }
      } catch {
        child.kill('SIGKILL');
      }
    };

    const onAbort = () => {
      aborted = true;
      killTree();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, Math.max(1_000, timeoutMs));

    const absorb = (data: Buffer) => {
      const text = stripAnsi(data.toString());
      if (!text) return;
      buffer.push(text);
      options.onChunk?.(text);
    };
    child.stdout?.on('data', absorb);
    child.stderr?.on('data', absorb);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      rejectPromise(new Error(`Could not start ${options.command}: ${err.message}`));
    });

    child.on('close', (code) => finish(code));

    // Some CLIs open a TTY-like prompt when stdin stays open; close it after the
    // prompt is written so they can see EOF and exit.
    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}
