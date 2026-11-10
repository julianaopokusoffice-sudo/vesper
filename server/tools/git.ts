import { spawn } from 'node:child_process';

/**
 * Git, for the developer surface and the agent.
 *
 * Read operations are unrestricted: status, diff and log are how an agent
 * understands a change before touching it. Committing is approval-gated at the
 * tool layer — it is the one command here that rewrites history the user cares
 * about. Everything runs with no shell, so a filename with `;` is a filename.
 */

export interface GitResult {
  ok: boolean;
  repo: boolean;
  output: string;
  code: number | null;
}

const CAP = 60_000;

export function runGit(args: string[], cwd: string, timeoutMs = 25_000): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' },
    });
    let output = '';
    let settled = false;

    const append = (chunk: Buffer) => {
      if (output.length < CAP * 2) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const finish = (code: number | null, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let text = output.trim();
      if (text.length > CAP) text = `${text.slice(0, CAP / 2)}\n…\n${text.slice(-CAP / 2)}`;
      resolve({
        ok: code === 0 && !timedOut,
        repo: !/not a git repository/i.test(text),
        output: timedOut ? `${text}\n[git timed out after ${Math.round(timeoutMs / 1000)}s]` : text || '(no output)',
        code,
      });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null, true);
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ ok: false, repo: false, output: `Could not run git: ${error.message}`, code: null });
    });
    child.on('close', (code) => finish(code));
  });
}

export async function gitStatus(cwd: string): Promise<GitResult> {
  const result = await runGit(['status', '--short', '--branch'], cwd);
  if (!result.repo) {
    return {
      ...result,
      repo: false,
      output: `Not a git repository: ${cwd}\nInitialise one with “git init”, or move this thread into a project folder.`,
    };
  }
  return result;
}

export async function gitDiff(cwd: string, options: { path?: string; staged?: boolean } = {}): Promise<GitResult> {
  const args = ['diff', '--no-color'];
  if (options.staged) args.push('--staged');
  if (options.path) args.push('--', options.path);
  const result = await runGit(args, cwd);
  if (result.ok && result.output === '(no output)') {
    const untracked = await runGit(['ls-files', '--others', '--exclude-standard'], cwd);
    if (untracked.output !== '(no output)') {
      return {
        ...result,
        output: `No tracked changes. Untracked files (use git add, or read them directly):\n${untracked.output}`,
      };
    }
  }
  return result;
}

export async function gitLog(cwd: string, limit = 12): Promise<GitResult> {
  return runGit(['log', `-n${Math.min(Math.max(limit, 1), 50)}`, '--oneline', '--decorate'], cwd);
}

export async function gitCommit(cwd: string, message: string): Promise<GitResult> {
  const clean = message.trim();
  if (!clean) return { ok: false, repo: true, output: 'A commit needs a message.', code: null };
  const add = await runGit(['add', '-A'], cwd);
  if (!add.ok) return add;
  const commit = await runGit(['commit', '-m', clean], cwd, 60_000);
  if (!commit.ok && /nothing to commit|no changes added/i.test(commit.output)) {
    return { ...commit, output: 'Nothing to commit — the working tree already matches HEAD.' };
  }
  return commit;
}
