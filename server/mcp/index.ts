import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import type { McpServerInfo } from '../../shared/types.ts';

/**
 * Model Context Protocol support: any MCP server (stdio or HTTP) becomes a set
 * of tools the agents can call.
 *
 * Design notes:
 * - Every MCP tool is approval-gated. Unlike the built-in allow-list, an MCP
 *   server is arbitrary code the user installed; nothing about it is known to
 *   this runtime, so it never runs silently.
 * - Servers are started lazily on the first tool call and reused; a crashed
 *   server is restarted on the next call rather than crashing the agent run.
 * - The tool name exposed to the model is `<server>__<tool>` so two servers can
 *   both offer `search` without a collision.
 */

export interface McpConfig {
  name: string;
  /** stdio transport: a command to spawn */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** streamable-HTTP transport: a POST endpoint speaking JSON-RPC */
  url?: string;
  /** optional allow-list of tool names */
  tools?: string[];
  enabled?: boolean;
  timeoutMs?: number;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

export const MCP_TOOL_SEPARATOR = '__';

export function mcpToolName(server: string, tool: string): string {
  return `${server.replace(/[^a-z0-9_-]/gi, '_')}${MCP_TOOL_SEPARATOR}${tool}`;
}

// --- config ------------------------------------------------------------------

let configs: McpConfig[] | null = null;

export function readMcpConfigs(force = false): McpConfig[] {
  if (configs && !force) return configs;
  const file = PATHS.mcp;
  if (!existsSync(file)) {
    configs = [];
    return configs;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { servers?: McpConfig[] } | McpConfig[];
    const list = Array.isArray(parsed) ? parsed : (parsed.servers ?? []);
    configs = list
      .filter((entry) => !!entry?.name)
      .map((entry) => ({
        ...entry,
        enabled: entry.enabled !== false,
        timeoutMs: entry.timeoutMs ?? 30_000,
      }));
  } catch (err) {
    console.error('[mcp] mcp.json is not valid JSON — MCP tools are disabled:', err instanceof Error ? err.message : err);
    configs = [];
  }
  return configs;
}

export function mcpConfigs(): McpConfig[] {
  return readMcpConfigs().filter((entry) => entry.enabled !== false && (!!(entry.command || '').trim() || !!entry.url?.trim()));
}

// --- connections -------------------------------------------------------------

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  config: McpConfig;
  proc?: ChildProcessWithoutNullStreams;
  buffer: string;
  nextId: number;
  pending: Map<number, Pending>;
  tools: McpToolDef[];
  ready: boolean;
  error?: string;
  lastUsed: number;
}

const connections = new Map<string, Connection>();

function connectionFor(config: McpConfig): Connection {
  const existing = connections.get(config.name);
  if (existing && (existing.proc?.stdin.writable || config.url) && !existing.error) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const connection: Connection = {
    config,
    buffer: '',
    nextId: 1,
    pending: new Map(),
    tools: [],
    ready: false,
    lastUsed: Date.now(),
  };
  connections.set(config.name, connection);
  return connection;
}

function send(connection: Connection, payload: Record<string, unknown>): void {
  const text = `${JSON.stringify(payload)}\n`;
  if (connection.config.url) throw new Error('use postMessage for HTTP');
  if (!connection.proc?.stdin.writable) throw new Error(`${connection.config.name} is not running`);
  connection.proc.stdin.write(text);
}

function postMessage(connection: Connection, message: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const id = typeof message.id === 'number' ? message.id : undefined;
  const work = async () => {
    if (connection.config.url) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(connection.config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify(message),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${connection.config.name}: HTTP ${response.status}`);
        const type = response.headers.get('content-type') ?? '';
        const text = await response.text();
        if (type.includes('text/event-stream')) {
          const line = text.split('\n').find((entry) => entry.startsWith('data:'));
          if (!line) throw new Error(`${connection.config.name}: empty SSE response`);
          return JSON.parse(line.slice(5).trim());
        }
        return JSON.parse(text || '{}');
      } finally {
        clearTimeout(timer);
      }
    }
    if (id === undefined) return undefined;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        rejectPromise(new Error(`${connection.config.name} did not answer in ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      connection.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        send(connection, message);
      } catch (err) {
        connection.pending.delete(id);
        clearTimeout(timer);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };
  return work();
}

function startStdio(connection: Connection): void {
  const { config } = connection;
  if (!config.command) throw new Error(`${config.name} has no command`);
  const proc = spawn(config.command, config.args ?? [], {
    cwd: config.cwd || process.cwd(),
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  connection.proc = proc;

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    connection.buffer += chunk;
    let index = connection.buffer.indexOf('\n');
    while (index >= 0) {
      const line = connection.buffer.slice(0, index).trim();
      connection.buffer = connection.buffer.slice(index + 1);
      index = connection.buffer.indexOf('\n');
      if (!line) continue;
      try {
        handleMessage(connection, JSON.parse(line));
      } catch {
        /* a server that prints non-JSON is ignored, not fatal */
      }
    }
  });

  proc.stderr.setEncoding('utf8');
  let stderrTail = '';
  proc.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  const fail = (reason: string) => {
    connection.error = reason;
    for (const [, entry] of connection.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`${config.name} ${reason}`));
    }
    connection.pending.clear();
    if (connection.proc === proc) connection.proc = undefined;
  };
  proc.on('error', (err) => fail(err.message));
  proc.on('exit', (code) => fail(`exited with code ${code}${stderrTail ? `: ${stderrTail.split('\n').slice(-3).join(' ')}` : ''}`));
}

function handleMessage(connection: Connection, message: any): void {
  if (typeof message.id === 'number' && connection.pending.has(message.id)) {
    const entry = connection.pending.get(message.id)!;
    connection.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${connection.config.name}: ${message.error.message ?? 'tool call failed'}`));
    else entry.resolve(message.result);
  }
}

async function ensureReady(connection: Connection): Promise<void> {
  if (connection.ready) return;
  const { config } = connection;
  if (config.url) {
    connection.ready = true;
    return;
  }
  startStdio(connection);
  const result = await postMessage(
    connection,
    {
      jsonrpc: '2.0',
      id: connection.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'vesper', version: '1.0.0' },
      },
    },
    config.timeoutMs ?? 20_000,
  );
  // The notification tells the server we accepted its capabilities.
  postMessage(connection, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, 5_000).catch(() => {});
  connection.ready = !!result || true;
}

async function loadTools(connection: Connection): Promise<McpToolDef[]> {
  if (connection.tools.length) return connection.tools;
  await ensureReady(connection);
  const result = await postMessage(
    connection,
    { jsonrpc: '2.0', id: connection.nextId++, method: 'tools/list', params: {} },
    connection.config.timeoutMs ?? 20_000,
  );
  const raw = Array.isArray(result?.tools) ? result.tools : [];
  const allowed = connection.config.tools?.length ? new Set(connection.config.tools) : null;
  connection.tools = raw
    .filter((tool: any) => typeof tool?.name === 'string' && (!allowed || allowed.has(tool.name)))
    .map((tool: any) => ({
      name: mcpToolName(connection.config.name, tool.name),
      description: String(tool.description ?? `Tool from ${connection.config.name}`),
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      server: connection.config.name,
    }));
  connection.error = undefined;
  return connection.tools;
}

// --- public API --------------------------------------------------------------

/**
 * Snapshot used by the orchestrator, which is synchronous by design. Refreshed
 * at startup and whenever MCP is reloaded, so a broken server cannot stall a run.
 */
let snapshot: McpToolDef[] = [];

export function mcpToolDefsCached(): McpToolDef[] {
  return snapshot;
}

export async function refreshMcpTools(): Promise<McpToolDef[]> {
  try {
    snapshot = await mcpToolDefs();
  } catch {
    snapshot = [];
  }
  return snapshot;
}

/** Every configured MCP tool, flattened. Never throws: a broken server is skipped. */
export async function mcpToolDefs(): Promise<McpToolDef[]> {
  const out: McpToolDef[] = [];
  for (const config of mcpConfigs()) {
    const connection = connectionFor(config);
    try {
      out.push(...(await loadTools(connection)));
    } catch (err) {
      connection.error = err instanceof Error ? err.message : String(err);
    }
  }
  return out;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const configs = mcpConfigs();
  const connection = configs
    .map((config) => connectionFor(config))
    .find((entry) => entry.tools.some((tool) => tool.name === name));
  if (!connection) throw new Error(`No MCP tool named "${name}"`);
  const tool = connection.tools.find((entry) => entry.name === name)!;
  const short = name.slice(connection.config.name.length + MCP_TOOL_SEPARATOR.length);
  const result = await postMessage(
    connection,
    {
      jsonrpc: '2.0',
      id: connection.nextId++,
      method: 'tools/call',
      params: { name: short, arguments: args ?? {} },
    },
    Math.max(connection.config.timeoutMs ?? 60_000, 10_000),
  );
  if (result?.isError) {
    const text = flatten(result.content);
    throw new Error(`${tool.server} → ${text || 'tool call failed'}`);
  }
  return flatten(result?.content);
}

function flatten(content: any): string {
  if (Array.isArray(content)) return content.map(flatten).filter(Boolean).join('\n');
  if (content?.type === 'text') return String(content.text ?? '');
  if (typeof content === 'string') return content;
  return content ? JSON.stringify(content) : '';
}

export async function mcpServerInfos(): Promise<McpServerInfo[]> {
  const out: McpServerInfo[] = [];
  for (const config of readMcpConfigs(true)) {
    const connection = connections.get(config.name);
    const info: McpServerInfo = {
      name: config.name,
      transport: config.url ? 'http' : 'stdio',
      command: config.command ? [config.command, ...(config.args ?? [])].join(' ') : undefined,
      url: config.url,
      enabled: config.enabled !== false,
      tools: connection?.tools.map((tool) => tool.name) ?? [],
      status: connection?.error ? 'error' : connection?.ready ? 'ready' : 'idle',
      error: connection?.error,
    };
    out.push(info);
  }
  return out;
}

export function reloadMcp(): void {
  snapshot = [];
  for (const connection of connections.values()) {
    connection.proc?.kill();
    for (const [, entry] of connection.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('MCP configuration reloaded'));
    }
  }
  connections.clear();
  readMcpConfigs(true);
}

export function shutdownMcp(): void {
  for (const connection of connections.values()) connection.proc?.kill();
  connections.clear();
  snapshot = [];
}

/** Sample file written next to the state directory on first run. */
export function mcpExampleConfig(): string {
  return [
    '{',
    '  "servers": [',
    '    {',
    '      "name": "filesystem",',
    '      "command": "npx",',
    '      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]',
    '    },',
    '    {',
    '      "name": "notes",',
    '      "url": "http://127.0.0.1:8931/mcp"',
    '    }',
    '  ]',
    '}',
    '',
  ].join('\n');
}

export function ensureMcpExample(): void {
  const file = PATHS.mcp;
  if (existsSync(file)) return;
  try {
    writeFileSync(file, mcpExampleConfig(), { mode: 0o600 });
  } catch {
    /* optional */
  }
}
