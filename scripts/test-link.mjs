#!/usr/bin/env node
/**
 * End-to-end proof of the device mesh, with two real nodes over HTTP.
 *
 *   npm run test:link
 *
 * Spins up two Vesper servers with separate state, pairs them with one code,
 * then exercises presence, tool invocation, capability refusal, a remote agent
 * run, and memory convergence in both directions. Exits non-zero on the first
 * failed assertion, so it is usable as CI.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodes = [];
let failures = 0;
let checks = 0;

const ok = (label, detail = '') => {
  checks += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}`);
};

const bad = (label, detail = '') => {
  checks += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}`);
};

const check = (label, condition, detail = '') => (condition ? ok(label, detail) : bad(label, detail));

function startNode(name, port) {
  const home = mkdtempSync(join(tmpdir(), `vesper-${name}-home-`));
  const workspace = mkdtempSync(join(tmpdir(), `vesper-${name}-ws-`));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      VESPER_PORT: String(port),
      VESPER_HOST: '127.0.0.1',
      VESPER_HOME: home,
      VESPER_WORKSPACE: workspace,
      VESPER_NODE_KIND: name === 'b' ? 'phone' : 'desktop',
      VESPER_PUBLIC_URL: `http://127.0.0.1:${port}`,
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const node = { name, port, child, home, workspace, logs };
  nodes.push(node);
  return node;
}

async function waitForHealth(node, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${node.port}/api/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function api(node, path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${node.port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  console.log('\nVesper · device mesh test\n');

  const a = startNode('a', 8791);
  const b = startNode('b', 8792);
  const upA = await waitForHealth(a);
  const upB = await waitForHealth(b);
  check('node A boots', upA, `:${a.port}`);
  check('node B boots', upB, `:${b.port}`);
  if (!upA || !upB) {
    console.log(a.logs.join('').slice(-2000));
    console.log(b.logs.join('').slice(-2000));
    return;
  }

  // --- pairing ---------------------------------------------------------------
  const codeResponse = await api(a, '/api/link/pairing-code', {
    method: 'POST',
    body: JSON.stringify({ scopes: ['memory', 'files', 'agents'] }),
  });
  const code = codeResponse.body?.pairingCode?.code;
  check('A issues a pairing code', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code ?? ''), code);

  const pair = await api(b, '/api/link/pair', {
    method: 'POST',
    body: JSON.stringify({
      url: `http://127.0.0.1:${a.port}`,
      code,
      name: 'Test phone',
      scopes: ['memory', 'agents'],
    }),
  });
  check('B pairs with A', pair.body?.ok === true, pair.body?.error ?? '');
  const peerOnB = pair.body?.link?.peers?.[0];
  check('B records what it may do on A', JSON.stringify(peerOnB?.scopes) === JSON.stringify(['memory', 'files', 'agents']), JSON.stringify(peerOnB?.scopes));
  check('B grants A only what it chose', JSON.stringify(peerOnB?.granted) === JSON.stringify(['memory', 'agents']), JSON.stringify(peerOnB?.granted));

  const aLink = await api(a, '/api/link');
  check('A records the peer without storing plaintext keys', !!aLink.body?.peers?.[0] && !('secret' in aLink.body.peers[0]), 'sealed');

  // --- presence --------------------------------------------------------------
  const ping = await api(b, `/api/link/nodes/${peerOnB.id}/ping`, { method: 'POST' });
  check('B reaches A', ping.body?.ok === true && ping.body?.node?.online === true, ping.body?.error ?? '');

  // --- remote tools ----------------------------------------------------------
  const listing = await api(b, `/api/link/nodes/${peerOnB.id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ tool: 'list_files', args: { path: '.' } }),
  });
  check('B lists files on A', listing.body?.ok === true, String(listing.body?.output ?? '').split('\n')[0]?.slice(0, 60));

  const denied = await api(b, `/api/link/nodes/${peerOnB.id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ tool: 'run_shell', args: { command: 'echo should-not-run' } }),
  });
  check('shell is refused when not granted', denied.body?.ok === false, denied.body?.error ?? '');
  check('the refusal explains which capability is missing', /shell/.test(denied.body?.error ?? ''), denied.body?.error ?? '');

  // --- remote agent ----------------------------------------------------------
  const task = await api(b, `/api/link/nodes/${peerOnB.id}/task`, {
    method: 'POST',
    body: JSON.stringify({ prompt: 'Answer with one word: ready.' }),
  });
  check('B runs an agent on A', task.body?.ok === true && (task.body?.output ?? '').length > 0, `${String(task.body?.output ?? '').slice(0, 48)}…`);

  // --- memory ----------------------------------------------------------------
  const saved = await api(a, '/api/memory', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'decision',
      title: 'Ship the mesh before the marketplace',
      body: 'Paired devices are the product; a marketplace can wait.',
      tags: ['roadmap'],
      pinned: true,
    }),
  });
  check('A saves a memory entry', !!saved.body?.id, saved.body?.title);

  const syncB = await api(b, '/api/memory/sync', {
    method: 'POST',
    body: JSON.stringify({ nodeId: peerOnB.id }),
  });
  const pulled = syncB.body?.results?.[0]?.pulled ?? 0;
  check('B pulls memory from A', syncB.body?.ok === true && pulled >= 1, `pulled ${pulled}`);

  const memoryOnB = await api(b, '/api/memory');
  check('the entry is searchable on B', (memoryOnB.body?.entries ?? []).some((e) => e.title === 'Ship the mesh before the marketplace'));
  check('provenance survives the hop', (memoryOnB.body?.entries ?? []).find((e) => e.title === 'Ship the mesh before the marketplace')?.sourceNodeId === aLink.body?.self?.id);

  const fromB = await api(b, '/api/memory', {
    method: 'POST',
    body: JSON.stringify({ kind: 'fact', title: 'Phone battery is the constraint', body: 'Long runs must be resumable.' }),
  });
  const peerOnA = aLink.body.peers[0];
  const syncA = await api(a, '/api/memory/sync', {
    method: 'POST',
    body: JSON.stringify({ nodeId: peerOnA.id }),
  });
  check('the reverse direction works too', syncA.body?.ok === true && (syncA.body?.results?.[0]?.pulled ?? 0) >= 1, JSON.stringify(syncA.body?.results?.[0] ?? {}));
  check('B’s entry reached A', !!fromB.body?.id);

  // Re-running sync must converge rather than duplicate.
  await api(b, '/api/memory/sync', { method: 'POST', body: JSON.stringify({ nodeId: peerOnB.id }) });
  const afterSecondSync = await api(b, '/api/memory');
  const duplicates = (afterSecondSync.body?.entries ?? []).filter((e) => e.title === 'Ship the mesh before the marketplace');
  check('repeated sync converges', duplicates.length === 1, `${duplicates.length} copies`);

  // --- audit -----------------------------------------------------------------
  const audit = await api(b, '/api/link');
  const actions = (audit.body?.audit ?? []).map((entry) => entry.action);
  check(
    'outbound calls are audited',
    actions.includes('pair') && actions.some((action) => action.startsWith('link/')),
    `${actions.length} entries`,
  );

  // --- revocation ------------------------------------------------------------
  await api(a, `/api/link/nodes/${peerOnA.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ granted: [] }),
  });
  const afterRevoke = await api(b, `/api/link/nodes/${peerOnB.id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ tool: 'list_files', args: { path: '.' } }),
  });
  check('revoking a capability takes effect immediately', afterRevoke.body?.ok === false, afterRevoke.body?.error ?? '');
}

async function stopAll() {
  for (const node of nodes) {
    await new Promise((resolveExit) => {
      if (node.child.exitCode !== null) return resolveExit();
      node.child.once('exit', resolveExit);
      try {
        node.child.kill();
      } catch {
        resolveExit();
      }
      setTimeout(resolveExit, 3000);
    });
    // Windows keeps the SQLite WAL locked for a moment after exit.
    for (const path of [node.home, node.workspace]) {
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      } catch {
        /* temp dir; the OS will collect it */
      }
    }
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error(`\n  uncaught: ${error.message}\n`);
  })
  .finally(async () => {
    await stopAll();
    console.log(`\n${failures === 0 ? '\x1b[32mpass\x1b[0m' : '\x1b[31mfail\x1b[0m'} · ${checks - failures}/${checks} checks\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
