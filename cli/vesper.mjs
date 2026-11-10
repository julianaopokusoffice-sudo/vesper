#!/usr/bin/env node
/**
 * vesper — the agentic coding CLI.
 *
 * A thin client over the local Vesper runtime, so the terminal uses exactly the
 * same agents, provider keys, skills, plugins and memory as the desktop app.
 * Zero dependencies: Node 20+, built-in fetch, no build step.
 */
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const VERSION = '1.0.0';
const here = dirname(fileURLToPath(import.meta.url));
const runtimeFile = join(homedir(), '.vesper', 'runtime.json');

// ---------------------------------------------------------------------------
// terminal helpers
// ---------------------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (value) => (useColor ? `\x1b[${code}m${value}\x1b[0m` : String(value));
const c = {
  dim: paint('2'),
  bold: paint('1'),
  amber: paint('38;5;214'),
  cyan: paint('38;5;80'),
  green: paint('38;5;114'),
  red: paint('38;5;203'),
  violet: paint('38;5;183'),
  grey: paint('38;5;245'),
  italic: paint('3'),
};
const sym = { star: '◆', arrow: '›', check: '✓', cross: '✗', dot: '·', tool: '⟡', branch: '↳' };

const configFile = join(homedir(), '.vesper', 'cli.json');
let config = {};
try {
  if (existsSync(configFile)) config = JSON.parse(readFileSync(configFile, 'utf8'));
} catch {
  config = {};
}

const baseUrl = (process.env.VESPER_URL ?? config.url ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const argv = process.argv.slice(2);
const command = argv[0];
let rl = null;

function saveConfig() {
  try {
    mkdirSync(join(homedir(), '.vesper'), { recursive: true, mode: 0o700 });
    writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch {
    /* read-only home */
  }
}

function line(text = '') {
  process.stdout.write(`${text}\n`);
}

function banner() {
  line();
  line(`  ${c.amber(sym.star)} ${c.bold('vesper')} ${c.dim('· agentic coding CLI')}`);
  line(c.grey(`  ${sym.dot} ${baseUrl}`));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function request(path, init = {}, timeout = 25_000) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`The runtime did not answer within ${Math.round(timeout / 1000)}s (${baseUrl}).`);
    }
    throw new Error(`Cannot reach the Vesper runtime at ${baseUrl}. Start it with \`npm run dev:server\` or \`npm run dev\`.`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error ?? body?.message ?? (typeof body === 'string' ? body : `HTTP ${res.status}`));
  }
  return body;
}

function runtimeEntry() {
  const candidates = [
    process.env.VESPER_SERVER,
    resolve(here, '..', 'server', 'server.mjs'),
    resolve(here, '..', 'dist', 'server.mjs'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { entry: candidate, mode: 'node' };
  }
  const devEntry = resolve(here, '..', 'server', 'index.ts');
  const tsx = resolve(here, '..', 'node_modules', 'tsx', 'dist', 'loader.mjs');
  if (existsSync(devEntry) && existsSync(tsx)) return { entry: devEntry, mode: 'tsx' };
  return null;
}

function runtimePort() {
  try {
    const url = new URL(baseUrl);
    return url.port || (url.protocol === 'https:' ? '443' : '80');
  } catch {
    return '8787';
  }
}

function isLocalRuntime() {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await request('/api/health', {}, 1500);
      return true;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
    }
  }
  return false;
}

/**
 * The desktop installer ships the runtime next to the CLI. Starting it here is
 * what makes `vesper` a complete command on a fresh machine: no `npm run dev`,
 * no second terminal, and the same data as the app.
 */
async function startRuntime(options = {}) {
  if (!isLocalRuntime()) {
    throw new Error(`The runtime at ${baseUrl} is not answering. Start it there, or point VESPER_URL at a reachable machine.`);
  }
  const found = runtimeEntry();
  if (!found) {
    throw new Error(
      `No Vesper runtime at ${baseUrl}, and no bundled runtime was found next to the CLI.\n  Start one:  npm run dev:server\n  Or point the CLI at another machine:  VESPER_URL=http://192.168.1.20:8787 vesper ...`,
    );
  }

  const port = runtimePort();
  const logFile = join(homedir(), '.vesper', 'logs', 'runtime.log');
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  const fd = openSync(logFile, 'a');
  const env = {
    ...process.env,
    VESPER_PORT: port,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
  const args = found.mode === 'tsx' ? ['--import', 'tsx', found.entry] : [found.entry];
  const child = spawn(process.execPath, args, {
    cwd: resolve(here, '..'),
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env,
  });
  child.unref();
  closeSync(fd);
  try {
    mkdirSync(dirname(runtimeFile), { recursive: true, mode: 0o700 });
    writeFileSync(
      runtimeFile,
      JSON.stringify({ pid: child.pid, url: baseUrl, startedAt: Date.now(), entry: found.entry }, null, 2),
      { mode: 0o600 },
    );
  } catch {
    /* read-only home */
  }
  if (!options.quiet) line(`  ${c.grey(`starting the local runtime on ${baseUrl}…`)}`);
  if (!(await waitForHealth(25_000))) {
    throw new Error(`The runtime did not start. See ${logFile}.`);
  }
  if (!options.quiet) line(`  ${c.green(sym.check)} runtime ready ${c.grey(`· ${logFile}`)}`);
}

async function ensureRuntime() {
  try {
    await request('/api/health', {}, 1800);
    return;
  } catch {
    if (!isLocalRuntime()) {
      throw new Error(`No Vesper runtime at ${baseUrl}. Point VESPER_URL at a reachable machine, or start it there.`);
    }
  }
  await startRuntime();
}

async function runtimeStatus() {
  let health = null;
  try {
    health = await request('/api/health', {}, 2500);
  } catch {
    /* offline */
  }
  let saved = null;
  try {
    if (existsSync(runtimeFile)) saved = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  } catch {
    saved = null;
  }
  banner();
  line();
  if (health) {
    line(`  ${c.green(sym.check)} runtime online ${c.grey(`· ${baseUrl} · v${health.version} · up ${Math.round(health.uptime)}s`)}`);
  } else {
    line(`  ${c.red(sym.cross)} runtime offline ${c.grey(`· ${baseUrl}`)}`);
  }
  if (saved?.pid) {
    let alive = true;
    try {
      process.kill(saved.pid, 0);
    } catch {
      alive = false;
    }
    line(`  ${c.grey(`pid ${saved.pid} ${alive ? 'alive' : 'gone'} · ${saved.entry ?? 'runtime'}`)}`);
  }
  line();
}

async function stopRuntime() {
  let saved = null;
  try {
    if (existsSync(runtimeFile)) saved = JSON.parse(readFileSync(runtimeFile, 'utf8'));
  } catch {
    saved = null;
  }
  if (!saved?.pid) throw new Error('No CLI-started runtime is recorded. Stop the desktop app or the terminal running it.');
  try {
    process.kill(saved.pid);
  } catch {
    /* already gone */
  }
  try {
    rmSync(runtimeFile, { force: true });
  } catch {
    /* ignore */
  }
  line(`  ${c.green(sym.check)} stopped runtime pid ${saved.pid}`);
}

async function serveRuntime() {
  const found = runtimeEntry();
  if (!found) throw new Error('No bundled runtime found next to this CLI. Build it with `npm run build:server`.');
  const env = { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
  const args = found.mode === 'tsx' ? ['--import', 'tsx', found.entry] : [found.entry];
  banner();
  line(`  ${c.grey(`serving ${found.entry}`)}`);
  line();
  const child = spawn(process.execPath, args, { cwd: resolve(here, '..'), stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function ask(question) {
  return new Promise((resolvePromise) => {
    if (rl) return rl.question(question, resolvePromise);
    const local = createInterface({ input: process.stdin, output: process.stdout });
    local.question(question, (answer) => {
      local.close();
      resolvePromise(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// streaming run
// ---------------------------------------------------------------------------
async function streamRun({ prompt, workspace, agentId, yes, json, quiet }) {
  const final = { content: '', usage: null, traces: [], agent: null };
  let started = Date.now();

  const res = await fetch(`${baseUrl}/api/cli/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, agentId, workspace, timeoutMs: 15 * 60_000 }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Run failed (${res.status})`);
  }

  if (!quiet && !json) {
    line();
    line(`  ${c.dim(`${sym.arrow} ${agentId ?? 'default agent'} ${sym.dot} ${workspace}`)}`);
    line();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wroteText = false;

  const handle = async (frame) => {
    const payload = frame.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }

    if (event.type === 'delta') {
      final.content += event.text;
      wroteText = true;
      if (!json) process.stdout.write(event.text);
      return;
    }

    if (event.type === 'trace') {
      const trace = event.trace;
      final.traces.push(trace);
      if (json) return;
      if (trace.ok === undefined) {
        if (wroteText) line();
        if (!quiet) line(`  ${c.violet(sym.tool)} ${c.dim(trace.name)} ${c.grey('running…')}`);
        wroteText = false;
      } else {
        const status = trace.ok ? c.green(sym.check) : c.red(sym.cross);
        if (wroteText) line();
        if (!quiet) line(`  ${c.violet(sym.tool)} ${trace.name} ${status} ${c.grey(`${trace.ms ?? 0}ms ${sym.dot} ${trace.source ?? 'core'}`)}`);
        if (trace.ok === false && trace.output) line(`    ${c.red(String(trace.output).slice(0, 300))}`);
        wroteText = false;
      }
      return;
    }

    if (event.type === 'approval') {
      if (yes) {
        await request(`/api/approvals/${event.approvalId}`, { method: 'POST', body: JSON.stringify({ approved: true }) });
        if (!quiet) line(`  ${c.amber(sym.check)} auto-approved ${event.name}`);
        return;
      }
      if (json || !process.stdin.isTTY) {
        await request(`/api/approvals/${event.approvalId}`, { method: 'POST', body: JSON.stringify({ approved: false }) });
        line(`  ${c.red(sym.cross)} ${event.name} denied (no interactive terminal; pass --yes to allow)`);
        return;
      }
      if (wroteText) line();
      line();
      line(`  ${c.amber('approval required')} ${c.dim(event.name)}`);
      line(`  ${event.reason}`);
      const detail = JSON.stringify(event.input ?? {}, null, 2)
        .split('\n')
        .slice(0, 14)
        .map((l) => `  ${c.grey(l)}`)
        .join('\n');
      line(detail);
      const answer = await ask(`  ${c.bold('allow once?')} ${c.dim('[y/N]')} `);
      const approved = /^y(es)?$/i.test(answer.trim());
      await request(`/api/approvals/${event.approvalId}`, { method: 'POST', body: JSON.stringify({ approved }) });
      line();
      wroteText = false;
      return;
    }

    if (event.type === 'done') {
      final.usage = event.usage;
      final.agent = event.agent;
      final.content = event.content ?? final.content;
      return;
    }

    if (event.type === 'error') throw new Error(event.message);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const raw of frame.split('\n')) {
        if (raw.startsWith('data:')) await handle(raw);
      }
    }
  }

  if (!json && wroteText) line();
  return final;
}

function printUsage(usage, started) {
  if (!usage) return;
  const parts = [
    `↑${usage.promptTokens ?? 0}`,
    `↓${usage.completionTokens ?? 0}`,
    usage.costUSD !== undefined ? `$${Number(usage.costUSD).toFixed(4)}` : null,
    `${((Date.now() - started) / 1000).toFixed(1)}s`,
  ].filter(Boolean);
  line(`  ${c.grey(parts.join(` ${sym.dot} `))}`);
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function runOnce(prompt, flags) {
  await ensureRuntime();
  const workspace = resolve(flags.workspace ?? process.cwd());
  if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);
  const started = Date.now();
  const result = await streamRun({
    prompt,
    workspace,
    agentId: flags.agent ?? config.agent,
    yes: flags.yes,
    json: flags.json,
    quiet: flags.quiet,
  });
  if (flags.json) {
    line(JSON.stringify({ ...result, workspace, ms: Date.now() - started }, null, 2));
  } else {
    printUsage(result.usage, started);
    if (flags.verbose && result.traces.length) {
      line();
      for (const trace of result.traces) {
        line(`  ${c.grey(`${sym.branch} ${trace.name} ${trace.ms}ms`)}`);
      }
    }
    line();
  }
  if (result.usage && result.usage.completionTokens === 0 && !result.content) {
    throw new Error('The run produced no output.');
  }
}

async function listAgents() {
  await ensureRuntime();
  const context = await request('/api/cli/context');
  line();
  for (const agent of context.agents) {
    line(`  ${c.amber(sym.star)} ${c.bold(agent.name.padEnd(9))} ${c.grey(agent.role.padEnd(12))} ${c.dim(agent.description)}`);
  }
  line();
  line(`  ${c.grey(`current: ${config.agent ?? context.defaultAgentId ?? 'vesper'}`)}`);
}

async function listDevices(flags) {
  await ensureRuntime();
  const state = await request('/api/link');
  line();
  line(`  ${c.amber(sym.star)} ${c.bold('this device')}  ${c.dim(state.self.name)}`);
  line(`    ${c.grey(`${state.self.kind} ${sym.dot} ${state.self.url}`)}`);
  line();
  if (!state.peers.length) {
    line(`  ${c.grey('No other devices yet. On the other machine run:')}`);
    line(`  ${c.dim('vesper code --scopes memory,files,agents')}  ${c.grey('then pair here:')}  ${c.dim('vesper pair <url> <code>')}`);
    line();
    return;
  }
  for (const peer of state.peers) {
    const status = peer.online ? c.green(`${sym.dot} online`) : c.grey(`${sym.dot} idle`);
    line(`  ${c.cyan(sym.star)} ${c.bold(peer.name)}  ${status}`);
    line(`    ${c.grey(`${peer.kind} ${sym.dot} ${peer.url} ${sym.dot} can: ${peer.scopes.join(',') || 'nothing'} ${sym.dot} grants: ${peer.granted.join(',') || 'nothing'}`)}`);
    if (flags.probe) {
      const result = await request(`/api/link/nodes/${peer.id}/ping`, { method: 'POST' });
      line(`    ${result.node.online ? c.green('reachable') : c.red('unreachable')}`);
    }
  }
  line();
  if (state.audit?.length) {
    line(`  ${c.grey('recent')}`);
    for (const entry of state.audit.slice(0, 6)) {
      const arrow = entry.direction === 'in' ? '←' : '→';
      line(`  ${c.grey(`${new Date(entry.at).toLocaleTimeString()} ${arrow} ${entry.nodeName} ${entry.action} ${entry.ok ? sym.check : sym.cross}`)}`);
    }
    line();
  }
}

async function pair(url, code, flags) {
  await ensureRuntime();
  if (!url || !code) throw new Error('Usage: vesper pair <http://other-device:8787> <CODE> [--scopes memory,files,agents]');
  const scopes = flags.scopes ? flags.scopes.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const result = await request('/api/link/pair', { method: 'POST', body: JSON.stringify({ url, code, scopes }) }, 30_000);
  line(`  ${c.green(sym.check)} paired with ${c.bold(result.node.name)}`);
  line(`  ${c.grey(`this device can use: ${result.node.scopes.join(', ') || 'nothing'}`)}`);
  line(`  ${c.grey(`${result.node.name} can use here: ${result.node.granted.join(', ') || 'nothing'}`)}`);
}

async function showCode(flags) {
  await ensureRuntime();
  const scopes = (flags.scopes ?? 'memory,files,agents').split(',').map((s) => s.trim()).filter(Boolean);
  const state = await request('/api/link/pairing-code', { method: 'POST', body: JSON.stringify({ scopes }) });
  const code = state.pairingCode;
  line();
  line(`  ${c.amber(sym.star)} pairing code  ${c.bold(code?.code ?? '—')}`);
  line(`  ${c.grey(`expires ${new Date(code?.expiresAt ?? Date.now()).toLocaleTimeString()} ${sym.dot} ${code?.code ? 'single use' : 'unavailable'}`)}`);
  line(`  ${c.grey(`grants: ${scopes.join(', ')}`)}`);
  line();
  line(`  ${c.dim(`on the other device: vesper pair ${state.self.url} ${code?.code ?? ''}`)}`);
  line();
}

async function remote(device, prompt, flags) {
  await ensureRuntime();
  if (!device) throw new Error('Usage: vesper remote <device> "<task>"');
  if (!prompt) throw new Error('Give the remote agent a task.');
  const state = await request('/api/link');
  const needle = device.toLowerCase();
  const peer =
    state.peers.find((p) => p.id === device) ??
    state.peers.find((p) => p.name.toLowerCase() === needle) ??
    state.peers.find((p) => p.name.toLowerCase().includes(needle));
  if (!peer) throw new Error(`No paired device matching "${device}". Run \`vesper devices\`.`);

  if (flags.shell) {
    line(`  ${c.violet(sym.tool)} ${peer.name} ${c.grey('shell')}`);
    const result = await request(
      `/api/link/nodes/${peer.id}/invoke`,
      { method: 'POST', body: JSON.stringify({ tool: 'run_shell', args: { command: prompt } }) },
      90_000,
    );
    line(result.output);
    return;
  }

  line(`  ${c.cyan(sym.branch)} sending to ${c.bold(peer.name)} ${c.grey(`${sym.dot} ${peer.scopes.includes('agents') ? 'agents granted' : 'agents NOT granted'}`)}`);
  const result = await request(
    `/api/link/nodes/${peer.id}/task`,
    { method: 'POST', body: JSON.stringify({ prompt, agentId: flags.agent }) },
    190_000,
  );
  line();
  line(result.output);
  if (result.traces?.length) {
    line();
    for (const trace of result.traces) line(`  ${c.grey(`${sym.branch} ${trace.name} ${trace.ms ?? 0}ms`)}`);
  }
  line(`  ${c.grey(`↩ ${peer.name} ${sym.dot} ${(result.ms / 1000).toFixed(1)}s`)}`);
}

async function memory(args, flags) {
  await ensureRuntime();
  const sub = args[0] ?? 'list';

  if (sub === 'add') {
    const [title, ...rest] = args.slice(1);
    if (!title) throw new Error('Usage: vesper memory add "Title" ["body"] [--tags a,b]');
    const saved = await request('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ kind: flags.kind ?? 'fact', title, body: rest.join(' ') || title, tags: flags.tags?.split(',') ?? [], pinned: flags.pin }),
    });
    line(`  ${c.green(sym.check)} saved ${c.bold(saved.title)} ${c.grey(saved.id.slice(0, 8))}`);
    return;
  }

  if (sub === 'search') {
    const query = args.slice(1).join(' ');
    const result = await request(`/api/memory?q=${encodeURIComponent(query)}`);
    printMemory(result.entries);
    return;
  }

  if (sub === 'sync') {
    const result = await request('/api/memory/sync', { method: 'POST', body: JSON.stringify({}) }, 60_000);
    for (const row of result.results) {
      line(
        row.error
          ? `  ${c.red(sym.cross)} ${row.node}: ${row.error}`
          : `  ${c.green(sym.check)} ${row.node}: pulled ${row.pulled}, pushed ${row.pushed}`,
      );
    }
    if (!result.results.length) line(`  ${c.grey('No paired devices. Nothing to sync.')}`);
    return;
  }

  const result = await request('/api/memory');
  printMemory(result.entries);
  line(`  ${c.grey(`${result.stats.count} entries ${sym.dot} ${result.stats.pinned} pinned ${sym.dot} ${result.stats.sources} source(s)`)}`);
}

function printMemory(entries) {
  if (!entries.length) {
    line(`  ${c.grey('Memory is empty. Add one: vesper memory add "Title" "Body"')}`);
    return;
  }
  line();
  for (const entry of entries) {
    line(`  ${entry.pinned ? c.amber('★') : c.grey('•')} ${c.bold(entry.title)} ${c.grey(`[${entry.kind}]`)}`);
    line(`    ${c.dim(entry.body.slice(0, 160))}`);
    line(`    ${c.grey(`${entry.tags.join(' ') || 'no tags'} ${sym.dot} ${entry.source}`)}`);
  }
  line();
}

async function repl(flags) {
  await ensureRuntime();
  const context = await request('/api/cli/context');
  let agent = flags.agent ?? config.agent ?? context.defaultAgentId ?? 'vesper';
  const workspace = resolve(flags.workspace ?? process.cwd());
  config.url = config.url ?? baseUrl;
  saveConfig();

  banner();
  line(`  ${c.grey(`${workspace}`)}`);
  line(`  ${c.grey(`agent ${c.cyan(agent)} ${sym.dot} /agent to switch ${sym.dot} /help ${sym.dot} ctrl+c twice to leave`)}`);
  line();

  rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  rl.on('SIGINT', () => {
    if (currentPromptOpen) {
      currentPromptOpen = false;
      line();
      replPrompt();
    } else {
      rl.close();
      process.exit(0);
    }
  });

  let currentPromptOpen = false;
  const replPrompt = () => {
    currentPromptOpen = true;
    rl.question(`  ${c.amber(sym.arrow)} `, async (answer) => {
      currentPromptOpen = false;
      const input = answer.trim();
      if (!input) return replPrompt();

      if (input === '/exit' || input === '/quit') {
        rl.close();
        return;
      }
      if (input === '/help') {
        line(`  ${c.grey('/agent <id>   switch agent        /agents       list agents')}`);
        line(`  ${c.grey('/memory       shared memory        /sync          sync memory with peers')}`);
        line(`  ${c.grey('/devices      paired devices       /cwd <path>    change workspace')}`);
        line(`  ${c.grey('/clear        clear screen         /exit          leave')}`);
        return replPrompt();
      }
      if (input === '/clear') {
        process.stdout.write('\x1b[2J\x1b[H');
        return replPrompt();
      }
      if (input.startsWith('/agent ')) {
        agent = input.slice(7).trim();
        line(`  ${c.grey(`agent ${c.cyan(agent)}`)}`);
        return replPrompt();
      }
      if (input === '/agents') {
        for (const a of context.agents) line(`  ${c.amber(sym.star)} ${a.id.padEnd(9)} ${c.grey(a.role)}`);
        return replPrompt();
      }
      if (input === '/devices') {
        await listDevices({}).catch((err) => line(`  ${c.red(err.message)}`));
        return replPrompt();
      }
      if (input === '/memory') {
        await memory(['list']).catch((err) => line(`  ${c.red(err.message)}`));
        return replPrompt();
      }
      if (input === '/sync') {
        await memory(['sync']).catch((err) => line(`  ${c.red(err.message)}`));
        return replPrompt();
      }
      if (input.startsWith('/cwd ')) {
        // Workspace is per-run; keep it in the prompt context only.
        line(`  ${c.grey('workspace is fixed for this session; restart with --workspace')}`);
        return replPrompt();
      }

      const started = Date.now();
      try {
        const result = await streamRun({ prompt: input, workspace: flags.workspace ? resolve(flags.workspace) : workspace, agentId: agent, yes: flags.yes });
        printUsage(result.usage, started);
      } catch (err) {
        line(`  ${c.red(sym.cross)} ${err.message}`);
      }
      line();
      replPrompt();
    });
  };

  replPrompt();
}

async function browserCommand(args, flags) {
  await ensureRuntime();
  const sub = args[0] ?? 'state';
  const limit = Math.max(500, Math.min(Number(flags.max) || 7000, 24_000));

  if (sub === 'open' || sub === 'go' || sub === 'navigate') {
    const url = args.slice(1).join(' ').trim();
    if (!url) throw new Error('Usage: vesper browser open <url> [--new-tab]');
    const result = await request('/api/browser/open', {
      method: 'POST',
      body: JSON.stringify({ url, newTab: Boolean(flags['new-tab']) }),
    }, 40_000);
    printBrowserPage(result.page, limit);
    return;
  }

  if (sub === 'read') {
    const state = await request('/api/browser');
    const tab = activeTab(state);
    if (!tab?.page) throw new Error('No page is open. Try: vesper browser open https://example.com');
    printBrowserPage(tab.page, limit);
    return;
  }

  if (sub === 'links') {
    const state = await request('/api/browser');
    const page = activeTab(state)?.page;
    if (!page) throw new Error('No page is open.');
    if (!page.links.length) return line(`  ${c.grey('No links on this page.')}`);
    line();
    for (const link of page.links) {
      line(`  ${c.amber(String(link.index).padStart(3))} ${link.text}`);
      line(`      ${c.grey(link.url)}`);
    }
    line();
    return;
  }

  if (sub === 'click') {
    const target = args.slice(1).join(' ').trim();
    if (!target) throw new Error('Usage: vesper browser click <index|link text>');
    const result = await request('/api/browser/click', {
      method: 'POST',
      body: JSON.stringify({ target: /^\d+$/.test(target) ? Number(target) : target }),
    }, 40_000);
    printBrowserPage(result.page, limit);
    return;
  }

  if (sub === 'find') {
    const query = args.slice(1).join(' ').trim();
    if (!query) throw new Error('Usage: vesper browser find <text>');
    const result = await request('/api/browser/find', { method: 'POST', body: JSON.stringify({ query }) });
    line(result.result);
    return;
  }

  if (sub === 'back' || sub === 'forward' || sub === 'reload') {
    const result = await request('/api/browser/act', { method: 'POST', body: JSON.stringify({ action: sub }) }, 40_000);
    printBrowserPage(result.page, limit);
    return;
  }

  if (sub === 'tabs') {
    const state = await request('/api/browser');
    line();
    for (const tab of state.tabs) {
      const marker = tab.id === state.activeTabId ? c.amber(sym.star) : c.grey('•');
      line(`  ${marker} ${tab.title || '(untitled)'} ${c.grey(`· ${tab.url || 'blank'} · ${tab.actor}`)}`);
    }
    line();
    return;
  }

  if (sub === 'state' || sub === 'status') {
    const state = await request('/api/browser');
    const tab = activeTab(state);
    line();
    line(`  ${c.amber(sym.star)} ${c.bold(tab?.title || 'Browser')}`);
    line(`    ${c.grey(tab?.url || 'blank tab')}`);
    line(`    ${c.grey(`${state.tabs.length} tab(s) · revision ${state.revision}`)}`);
    line();
    return;
  }

  throw new Error('Usage: vesper browser <open|read|links|click|find|back|forward|reload|tabs|state> [args]');
}

function activeTab(state) {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
}

function printBrowserPage(page, limit = 7000) {
  line();
  line(`  ${c.bold(page.title || page.url)}`);
  line(`  ${c.grey(page.url)}`);
  if (page.error) line(`  ${c.red(`${sym.cross} ${page.error}`)}`);
  line();
  const text = String(page.text ?? '').slice(0, limit);
  for (const raw of text.split('\n')) {
    line(`  ${raw ? c.dim(raw) : ''}`);
  }
  if (page.text.length > limit) line(`  ${c.grey(`… ${page.text.length - limit} more characters (use --max)`)}`);
  if (page.links?.length) {
    line();
    line(`  ${c.grey(`${page.links.length} link(s)`)}`);
    for (const link of page.links.slice(0, 12)) line(`  ${c.amber(String(link.index).padStart(3))} ${c.dim(link.text)}`);
    if (page.links.length > 12) line(`  ${c.grey('… vesper browser links for all')}`);
  }
  line();
}

function help() {
  banner();
  line();
  line(`  ${c.bold('Usage')}`);
  line(`    ${c.amber('vesper')}                          interactive session in this directory`);
  line(`    ${c.amber('vesper run')} "task" [flags]         one-shot agentic run, exits when done`);
  line(`    ${c.amber('vesper serve')}                     run the local runtime in the foreground`);
  line(`    ${c.amber('vesper status')}                    is the runtime up, and on which pid`);
  line(`    ${c.amber('vesper stop')}                      stop a runtime this CLI started`);
  line(`    ${c.amber('vesper browser')} <open|read|links|click|find|back|tabs>  drive the in-app browser`);
  line(`    ${c.amber('vesper agents')}                    list personas`);
  line(`    ${c.amber('vesper devices')} [--probe]          paired machines and their capabilities`);
  line(`    ${c.amber('vesper code')} [--scopes a,b]        mint a pairing code for another device`);
  line(`    ${c.amber('vesper pair')} <url> <code>          pair with a device running Vesper`);
  line(`    ${c.amber('vesper remote')} <device> "task"      run an agent on another paired machine`);
  line(`    ${c.amber('vesper remote')} <device> --shell "cmd"  run a shell command there`);
  line(`    ${c.amber('vesper memory')} [list|add|search|sync] shared cross-device memory`);
  line();
  line(`  ${c.bold('Flags')}`);
  line(`    --agent <id>        persona for this run            --workspace <path>  root for tools`);
  line(`    --yes               auto-approve tool calls         --json              machine-readable result`);
  line(`    --verbose           print every tool trace          --quiet             output only`);
  line();
  line(`  ${c.bold('Environment')}`);
  line(`    VESPER_URL          runtime address (default ${c.dim(baseUrl)})`);
  line(`    NO_COLOR            disable colour`);
  line();
  line(`  ${c.grey('Examples')}`);
  line(`    ${c.dim('vesper run "find the N+1 query in src/api and fix it" --yes')}`);
  line(`    ${c.dim('vesper remote pixel "run the test suite and summarise failures"')}`);
  line(`    ${c.dim('vesper code --scopes memory,files,agents')}`);
  line();
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item === '--yes' || item === '-y') flags.yes = true;
    else if (item === '--json') flags.json = true;
    else if (item === '--verbose' || item === '-v') flags.verbose = true;
    else if (item === '--quiet' || item === '-q') flags.quiet = true;
    else if (item === '--probe') flags.probe = true;
    else if (item === '--pin') flags.pin = true;
    else if (item === '--shell') flags.shell = true;
    else if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = value;
    } else rest.push(item);
  }
  return { flags, rest };
}

async function main() {
  const { flags, rest } = parseFlags(argv.slice(1));

  switch (command) {
    case undefined:
      return repl(flags);
    case 'help':
    case '--help':
    case '-h':
      return help();
    case 'run': {
      const prompt = rest.join(' ');
      if (!prompt) throw new Error('Usage: vesper run "what to do" [--agent flint] [--yes]');
      return runOnce(prompt, flags);
    }
    case 'serve':
      return serveRuntime();
    case 'status':
      return runtimeStatus();
    case 'stop':
      return stopRuntime();
    case 'browser':
      return browserCommand(rest, flags);
    case 'agents':
      return listAgents();
    case 'devices':
      return listDevices(flags);
    case 'pair':
      return pair(rest[0], rest[1], flags);
    case 'code':
      return showCode(flags);
    case 'remote':
      return remote(rest[0], rest.slice(1).join(' '), flags);
    case 'memory':
      return memory(rest, flags);
    case 'version':
    case '--version':
      return line(`vesper ${VERSION}`);
    default: {
      // `vesper "just do the thing"` treated as a one-shot run.
      const prompt = argv.join(' ').trim();
      if (!prompt) return help();
      return runOnce(prompt, flags);
    }
  }
}

main().catch((err) => {
  line(`  ${c.red(sym.cross)} ${err.message}`);
  process.exit(1);
});
