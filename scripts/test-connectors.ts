import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

/**
 * Connector regression test. Runs against a throwaway VESPER_HOME and a local
 * mock API, so it never touches the real key store and never calls a provider.
 */

const home = mkdtempSync(join(tmpdir(), 'vesper-connectors-'));
process.env.VESPER_HOME = home;

const { CONNECTORS, connectorInfos, connectorRequest, probeConnector, saveConnector, disconnectConnector } =
  await import('../server/connectors/index.ts');
const { PATHS } = await import('../server/kernel/paths.ts');

const seen: { path: string; method: string; headers: Record<string, unknown>; body: string }[] = [];

const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    seen.push({ path: req.url ?? '', method: req.method ?? '', headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, login: 'tester' }));
  });
});
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const port = (mock.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

const definition = {
  blurb: 'test',
  category: 'data' as const,
  auth: 'token' as const,
  accent: '#fff',
  docsUrl: base,
  baseUrl: base,
  fields: [{ key: 'token', label: 'Token', secret: true, required: true }],
  style: 'bearer' as const,
  probe: { path: '/me' },
  accountPath: 'login',
};
CONNECTORS.push({ ...definition, id: 'mock', name: 'Mock' });
CONNECTORS.push({ ...definition, id: 'mock-form', name: 'Mock Form', encoding: 'form' as const, probe: { path: '/form' } });

try {
  const info = saveConnector('mock', { token: 'super-secret-token' });
  assert.equal(info.connected, true);
  assert.deepEqual(info.set, ['token']);

  const raw = readFileSync(join(PATHS.home, 'connectors.json'), 'utf8');
  assert.ok(!raw.includes('super-secret-token'), 'credential must not be stored in plaintext');

  const probed = await probeConnector('mock');
  assert.equal(probed.account, 'tester');
  assert.equal(probed.error, undefined);
  assert.equal(seen.at(-1)?.headers.authorization, 'Bearer super-secret-token');

  const read = await connectorRequest('mock', { path: '/items', query: { limit: 3 } });
  assert.equal(read.status, 200);
  assert.equal(seen.at(-1)?.path, '/items?limit=3');

  await connectorRequest('mock', { method: 'POST', path: '/items', body: { name: 'thing' } });
  assert.equal(seen.at(-1)?.headers['content-type'], 'application/json');
  assert.equal(seen.at(-1)?.body, '{"name":"thing"}');

  saveConnector('mock-form', { token: 'form-token' });
  await connectorRequest('mock-form', {
    method: 'POST',
    path: '/form',
    body: { customer: 'cus_1', metadata: { plan: 'pro' } },
  });
  assert.equal(seen.at(-1)?.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(seen.at(-1)?.body, 'customer=cus_1&metadata%5Bplan%5D=pro');

  await assert.rejects(() => connectorRequest('mock', { path: 'https://evil.example/x' }), /Path must start/);

  disconnectConnector('mock');
  disconnectConnector('mock-form');
  assert.equal(connectorInfos().find((entry) => entry.definition.id === 'mock')?.connected, false);

  console.log('connectors: all checks passed');
} finally {
  mock.close();
  rmSync(home, { recursive: true, force: true });
}
