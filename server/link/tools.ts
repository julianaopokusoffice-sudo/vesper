import { randomUUID } from 'node:crypto';
import { PATHS } from '../kernel/paths.ts';
import { findNativeTool } from '../tools/native.ts';
import { store } from '../kernel/store.ts';
import type { Agent, NodeScope, ToolTrace } from '../../shared/types.ts';

/** Capability required to run each remote tool. `null` means harmless. */
const REQUIRED_SCOPE: Record<string, NodeScope | null> = {
  clock: null,
  calculator: null,
  list_files: 'files',
  read_file: 'files',
  write_file: 'files',
  run_shell: 'shell',
  web_search: null,
  fetch_url: null,
  load_skill: null,
};

export const REMOTE_TOOLS = Object.keys(REQUIRED_SCOPE);

export function requiredScope(tool: string): NodeScope | null | undefined {
  return REQUIRED_SCOPE[tool];
}

export interface RemoteToolResult {
  ok: boolean;
  output: string;
  ms: number;
}

/**
 * Runs a tool on behalf of a paired peer. There is no interactive approval here
 * by design: the *pairing* is the grant. A peer can only reach a tool whose
 * scope was handed over with the pairing code, and every call is audited.
 */
export async function runLinkTool(input: {
  tool: string;
  args: Record<string, unknown>;
  scopes: NodeScope[];
  peer: { id: string; name: string; kind: string };
}): Promise<RemoteToolResult> {
  const started = Date.now();
  const native = findNativeTool(input.tool);
  const scope = requiredScope(input.tool);

  if (!native || scope === undefined) {
    return audit(input, started, false, `Unknown or non-remote tool: ${input.tool}`, 'invoke');
  }
  if (scope && !input.scopes.includes(scope)) {
    return audit(input, started, false, `Peer lacks the "${scope}" capability`, 'invoke');
  }

  const agent: Agent = {
    id: 'remote-peer',
    name: input.peer.name,
    handle: 'remote',
    role: `Remote · ${input.peer.kind}`,
    description: 'A paired device driving tools on this machine.',
    system: '',
    accent: '#22d3ee',
    glyph: '↔',
    model: null,
    temperature: 0,
    maxSteps: 1,
    tools: ['*'],
    skills: [],
    builtin: false,
    createdAt: 0,
  };

  try {
    const output = await native.run(input.args ?? {}, {
      workspace: PATHS.workspace,
      agent,
      signal: AbortSignal.timeout(60_000),
      requestApproval: async () => true,
      delegate: async () => {
        throw new Error('Remote delegation is not available on this device.');
      },
    });
    return audit(input, started, true, String(output ?? ''), 'invoke');
  } catch (err) {
    return audit(input, started, false, err instanceof Error ? err.message : String(err), 'invoke');
  }
}

function audit(
  input: { tool: string; args: Record<string, unknown>; peer: { id: string; name: string } },
  started: number,
  ok: boolean,
  detail: string,
  action: string,
): RemoteToolResult {
  const output = detail.slice(0, 40_000);
  store().logLink({
    id: randomUUID(),
    at: Date.now(),
    direction: 'in',
    nodeId: input.peer.id,
    nodeName: input.peer.name,
    action: `${action}:${input.tool}`,
    ok,
    detail: ok ? output.slice(0, 400) : output.slice(0, 400),
    ms: Date.now() - started,
  });
  return { ok, output, ms: Date.now() - started };
}

export function tracesFromRemote(output: string, tool: string, ms: number): ToolTrace[] {
  return [
    {
      id: randomUUID(),
      name: tool,
      source: 'remote',
      ok: true,
      output: output.slice(0, 8000),
      ms,
    },
  ];
}
