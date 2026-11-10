import { randomUUID } from 'node:crypto';
import { store } from '../kernel/store.ts';
import { getAgent } from '../agents/registry.ts';
import { enabledSkills, getSkill } from '../skills/loader.ts';
import { pluginBindings, type PluginBinding } from '../plugins/loader.ts';
import { buildSystemPrompt } from './prompt.ts';
import { CHAIR_PROMPT } from '../agents/builtin.ts';
import { connectorToolDefs, findNativeTool, toolDefsFor } from '../tools/native.ts';
import { awaitApproval } from './approvals.ts';
import { callMcpTool, mcpToolDefsCached } from '../mcp/index.ts';
import { RESEARCH_TOOLS } from '../research/tools.ts';
import { STUDIO_TOOLS } from '../studio/tools.ts';
import { resolve, streamProvider } from '../providers/registry.ts';
import { PATHS } from '../kernel/paths.ts';
import { workspaceForThread } from '../kernel/projects.ts';
import { memoryContext } from '../memory/index.ts';
import type {
  Agent,
  MessageSource,
  ProviderId,
  RunEvent,
  RunMode,
  ToolTrace,
  Usage,
} from '../../shared/types.ts';
import type { InvokeMessage, ProviderResponse, ToolCall, ToolDef } from '../providers/types.ts';

interface RunOptions {
  threadId: string;
  input: string;
  agentIds: string[];
  mode: RunMode;
  regenerate?: boolean;
  /** Vision input for the user's turn, as data URIs. */
  images?: string[];
  /** Root for filesystem/shell tools. Defaults to the Vesper workspace. */
  workspace?: string;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
}

interface LaneResult {
  agent: Agent;
  content: string;
  reasoning?: string;
  usage: Usage;
  traces: ToolTrace[];
  error?: string;
}

const HISTORY_LIMIT = 24;
const TOOL_OUTPUT_CAP = 20_000;

export async function runConversation(opts: RunOptions): Promise<void> {
  const db = store();
  const thread = db.getThread(opts.threadId);
  if (!thread) throw new Error('Thread not found');

  const settings = db.settings();
  const agents = (opts.agentIds.length ? opts.agentIds : [thread.agentId])
    .map((id) => {
      try {
        return getAgent(id);
      } catch {
        return null;
      }
    })
    .filter((a): a is Agent => !!a);

  if (!agents.length) throw new Error('No valid agents selected');
  const mode: RunMode =
    opts.mode === 'research' ? 'research' : opts.mode === 'council' && agents.length > 1 ? 'council' : 'single';
  const research = mode === 'research';
  const runId = randomUUID();

  // --- history + user turn --------------------------------------------------
  let input = opts.input.trim();
  if (opts.regenerate) {
    db.truncateAfterLastUser(opts.threadId);
    const lastUser = [...db.listMessages(opts.threadId)].reverse().find((m) => m.role === 'user');
    input = lastUser?.content ?? input;
  }

  const history = buildHistory(opts.threadId);
  if (input) {
    db.addMessage({
      id: randomUUID(),
      threadId: opts.threadId,
      role: 'user',
      content: input,
      images: opts.images?.length ? opts.images.slice(0, 4) : undefined,
      traces: [],
    });
  }
  if (!input) throw new Error('Nothing to send');

  if (thread.title === 'Untitled thread' || thread.title === 'New thread' || !thread.title) {
    db.updateThread(opts.threadId, { title: titleFrom(input) });
  }
  db.updateThread(opts.threadId, { mode });

  const userTurn: InvokeMessage = {
    role: 'user',
    content: input,
    images: opts.images?.length ? opts.images.slice(0, 4) : undefined,
  };
  const chair = agents[0]!;

  opts.emit({
    type: 'run_start',
    runId,
    mode,
    lanes: agents.map((a) => ({ agentId: a.id, name: a.name, accent: a.accent })),
    synthesisAgentId: mode === 'council' ? chair.id : undefined,
  });

  // --- lanes ---------------------------------------------------------------
  const runLane = (agent: Agent, extra?: { label?: string; lane?: 'agent' | 'synthesis'; systemSuffix?: string; messages?: InvokeMessage[]; tools?: ToolDef[]; silent?: boolean }) =>
    executeLane({
      agent,
      threadId: opts.threadId,
      system: buildLanePrompt(
        agent,
        agents,
        mode === 'council' ? 'council' : 'single',
        extra?.systemSuffix,
        opts.workspace ?? workspaceForThread(opts.threadId),
        research,
      ),
      messages: extra?.messages ?? [...history, userTurn],
      tools: extra?.tools ?? toolsFor(agent, research),
      label: extra?.label,
      lane: extra?.lane ?? 'agent',
      silent: extra?.silent ?? false,
      settingsMaxSteps: settings.maxSteps,
      // A thread can live in its own project folder; tools stay inside it.
      workspace: opts.workspace ?? workspaceForThread(opts.threadId),
      emit: opts.emit,
      signal: opts.signal,
      depth: 0,
    });

  const results: LaneResult[] = [];
  if (mode === 'single') {
    results.push(await runLane(agents[0]!));
  } else {
    results.push(...(await Promise.all(agents.map((agent) => runLane(agent)))));
    const usable = results.filter((r) => r.content.trim() && !r.error);
    if (usable.length > 1 && !opts.signal.aborted) {
      const transcript = usable
        .map((r) => `### ${r.agent.name} (${r.agent.role})\n${r.content.trim()}`)
        .join('\n\n---\n\n');
      const synthesis = await runLane(chair, {
        label: 'Chair synthesis',
        lane: 'synthesis',
        systemSuffix: CHAIR_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Question from the user:\n\n${input}\n\nPanel answers:\n\n${transcript}`,
          },
        ],
        tools: [],
        silent: false,
      });
      results.push(synthesis);
    }
  }

  const failed = results.every((r) => r.error);
  opts.emit({
    type: 'run_end',
    runId,
    status: opts.signal.aborted ? 'aborted' : failed ? 'error' : 'ok',
    threadId: opts.threadId,
  });
}

// --- lane execution ----------------------------------------------------------

async function executeLane(params: {
  agent: Agent;
  threadId: string;
  system: string;
  messages: InvokeMessage[];
  tools: ToolDef[];
  label?: string;
  lane: 'agent' | 'synthesis';
  silent: boolean;
  settingsMaxSteps: number;
  workspace: string;
  emit: (event: RunEvent) => void;
  /** Called for every token even when the lane is silent (used by the CLI). */
  onDelta?: (text: string) => void;
  signal: AbortSignal;
  depth: number;
}): Promise<LaneResult> {
  const { agent, signal } = params;
  const sources: MessageSource[] = [];
  const emit = (event: RunEvent) => {
    if (event.type === 'source' && !sources.some((entry) => entry.url === event.source.url)) {
      sources.push({ n: sources.length + 1, ...event.source });
    }
    params.emit(event);
  };
  const db = store();
  const settings = db.settings();
  const messageId = randomUUID();
  const model = agent.model ?? settings.defaultModel;

  if (!params.silent) {
    emit({ type: 'lane_start', agentId: agent.id, messageId, label: params.label, lane: params.lane });
  }

  let content = '';
  let reasoning = '';
  const traces: ToolTrace[] = [];
  const usage: Usage = { promptTokens: 0, completionTokens: 0, costUSD: 0, ms: 0 };

  try {
    const cred = resolve(model.provider as ProviderId);
    const convo: InvokeMessage[] = [{ role: 'system', content: params.system }, ...params.messages];
    const maxSteps = Math.min(agent.maxSteps || params.settingsMaxSteps, 12);

    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const result: ProviderResponse = await streamProvider(cred, {
        model: model.id,
        messages: convo,
        tools: params.tools,
        temperature: agent.temperature,
        signal,
        agentName: agent.name,
        onText: (delta) => {
          content += delta;
          params.onDelta?.(delta);
          if (!params.silent) emit({ type: 'delta', agentId: agent.id, text: delta });
        },
        onReasoning: (delta) => {
          reasoning += delta;
          if (!params.silent) emit({ type: 'reasoning', agentId: agent.id, text: delta });
        },
      });

      usage.promptTokens += result.usage.promptTokens;
      usage.completionTokens += result.usage.completionTokens;
      usage.costUSD = (usage.costUSD ?? 0) + (result.usage.costUSD ?? 0);
      usage.ms = (usage.ms ?? 0) + (result.usage.ms ?? 0);

      if (!result.toolCalls.length) break;
      convo.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const trace = await executeTool({
          call,
          agent,
          workspace: params.workspace,
          emit: params.silent ? () => {} : emit,
          signal,
          depth: params.depth,
        });
        traces.push(trace);
        convo.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: (trace.output?.length ? trace.output : trace.ok === false ? 'Tool failed.' : '(no output)').slice(0, TOOL_OUTPUT_CAP),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted = signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
    if (!params.silent) {
      emit({ type: 'lane_end', agentId: agent.id, messageId, usage, model: `${model.provider}:${model.id}`, error: aborted ? 'Stopped' : message });
    }
    if (content.trim() && db.getThread(params.threadId)) {
      db.addMessage({
        id: messageId,
        threadId: params.threadId,
        role: 'assistant',
        agentId: agent.id,
        lane: params.lane,
        content,
        reasoning: reasoning || undefined,
        traces,
        usage,
        model: `${model.provider}:${model.id}`,
        sources: sources.length ? sources : undefined,
      });
    }
    return { agent, content, reasoning, usage, traces, error: aborted ? 'Stopped' : message };
  }

  // Headless and delegated runs have no thread to attach to.
  if (db.getThread(params.threadId)) {
    db.addMessage({
      id: messageId,
      threadId: params.threadId,
      role: 'assistant',
      agentId: agent.id,
      lane: params.lane,
      content,
      reasoning: reasoning || undefined,
      traces,
      usage,
      model: `${model.provider}:${model.id}`,
      sources: sources.length ? sources : undefined,
    });
  }

  if (!params.silent) {
    emit({ type: 'lane_end', agentId: agent.id, messageId, usage, model: `${model.provider}:${model.id}` });
  }
  return { agent, content, reasoning, usage, traces };
}

// --- headless runs (CLI + remote peers) ---------------------------------------

/**
 * Runs one agent to completion without touching a thread. Used by the coding CLI
 * and by paired devices that send a task to this machine.
 */
export async function runHeadless(input: {
  prompt: string;
  agentId?: string;
  /** A synthetic persona (used by scheduled runs with a restricted tool set). */
  agent?: Agent;
  workspace?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onTrace?: (trace: ToolTrace) => void;
  onEvent?: (event: RunEvent) => void;
}): Promise<{ content: string; traces: ToolTrace[]; usage: Usage; agent: Agent; error?: string }> {
  const settings = store().settings();
  let agent: Agent;
  if (input.agent) {
    agent = input.agent;
  } else {
    try {
      agent = getAgent(input.agentId ?? 'vesper');
    } catch {
      agent = getAgent('vesper');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(input.timeoutMs ?? 120_000, 5_000));
  const collected: ToolTrace[] = [];
  const abortOuter = () => controller.abort();
  input.signal?.addEventListener('abort', abortOuter, { once: true });

  try {
    const result = await executeLane({
      agent,
      threadId: 'headless',
      system: buildLanePrompt(agent, [agent], 'single'),
      messages: [{ role: 'user', content: input.prompt }],
      tools: toolsFor(agent),
      lane: 'agent',
      silent: true,
      settingsMaxSteps: settings.maxSteps,
      workspace: input.workspace ?? PATHS.workspace,
      emit: (event) => {
        input.onEvent?.(event);
        if (event.type === 'trace') {
          collected.push(event.trace);
          input.onTrace?.(event.trace);
        }
      },
      onDelta: input.onDelta,
      signal: controller.signal,
      depth: 0,
    });
    return { content: result.content, traces: result.traces, usage: result.usage, agent, error: result.error };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortOuter);
  }
}

// --- tools -------------------------------------------------------------------

async function executeTool(params: {
  call: ToolCall;
  agent: Agent;
  workspace: string;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  depth: number;
}): Promise<ToolTrace> {
  const { call, agent, emit, signal, workspace } = params;
  const started = Date.now();
  const base: ToolTrace = {
    id: call.id,
    name: call.name,
    source: 'core',
    input: safeJson(call.arguments),
  };

  const native = findNativeTool(call.name);
  const binding: PluginBinding | undefined = native ? undefined : pluginBindings().find((b) => b.tool.name === call.name);
  const mcp = native || binding ? undefined : mcpToolDefsCached().find((tool) => tool.name === call.name);

  if (!native && !binding && !mcp) {
    const trace: ToolTrace = { ...base, ok: false, output: `No tool named "${call.name}" is available to this agent.`, ms: 0 };
    emit({ type: 'trace', agentId: agent.id, trace });
    return trace;
  }

  const source = native ? 'core' : binding ? binding.plugin.name : `mcp:${mcp!.server}`;
  const label = native?.name ?? binding?.tool.name ?? mcp!.name;
  emit({ type: 'trace', agentId: agent.id, trace: { ...base, source } });

  // MCP servers are arbitrary processes the user installed: always ask.
  const needsApproval = !!native?.requiresApproval || !!binding?.tool.requiresApproval || !!mcp;
  let approval: ToolTrace['approval'] = 'auto';

  if (needsApproval && params.depth === 0) {
    const reason =
      native?.approvalReason?.(base.input, {
        workspace,
        agent,
        signal,
        requestApproval: async () => true,
        delegate: async () => '',
      }) ?? `${source} wants to run ${label}`;
    const approved = await awaitApproval(
      { name: label, reason, detail: JSON.stringify(base.input, null, 2).slice(0, 1200) },
      signal,
      (approvalId) => {
        emit({
          type: 'approval',
          agentId: agent.id,
          approvalId,
          name: label,
          input: base.input,
          reason,
        });
      },
    );
    approval = approved ? 'granted' : 'denied';
    if (!approved) {
      const trace: ToolTrace = { ...base, ok: false, source, approval, output: 'Denied by the user. Do not retry.', ms: Date.now() - started };
      emit({ type: 'trace', agentId: agent.id, trace });
      return trace;
    }
  }

  try {
    const output = native
      ? await native.run(base.input, {
          workspace,
          agent,
          signal,
          requestApproval: async () => true,
          delegate: async (agentId, task) => delegateTo(agentId, task, agent, signal, params.depth, workspace),
          emitEvent: (event) => emit(event),
        })
      : binding
        ? await binding!.run(base.input as Record<string, unknown>)
        : await callMcpTool(mcp!.name, base.input as Record<string, unknown>);

    const trace: ToolTrace = {
      ...base,
      source,
      ok: true,
      approval,
      output: String(output ?? '').slice(0, TOOL_OUTPUT_CAP),
      ms: Date.now() - started,
    };
    emit({ type: 'trace', agentId: agent.id, trace });
    return trace;
  } catch (err) {
    const trace: ToolTrace = {
      ...base,
      source,
      ok: false,
      approval,
      output: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
    emit({ type: 'trace', agentId: agent.id, trace });
    return trace;
  }
}

async function delegateTo(targetId: string, task: string, from: Agent, signal: AbortSignal, depth: number, workspace: string): Promise<string> {
  if (depth >= 2) throw new Error('Delegation depth limit reached (2). Answer directly.');
  let target: Agent;
  try {
    target = getAgent(targetId);
  } catch {
    throw new Error(`No agent "${targetId}" in the roster.`);
  }
  if (target.id === from.id) throw new Error('An agent cannot delegate to itself.');
  const db = store();
  const settings = db.settings();
  const mode = 'single' as RunMode;
  const result = await executeLane({
    agent: target,
    threadId: 'delegation',
    system: buildLanePrompt(target, [target], mode),
    messages: [{ role: 'user', content: `Delegated task from ${from.name}:\n\n${task}` }],
    tools: toolsFor(target),
    lane: 'agent',
    silent: true,
    settingsMaxSteps: settings.maxSteps,
    workspace,
    emit: () => {},
    signal,
    depth: depth + 1,
  });
  return `Answer from ${target.name}:\n\n${result.content || result.error || '(empty)'}`;
}

// --- helpers -----------------------------------------------------------------

function toolsFor(agent: Agent, research = false): ToolDef[] {
  // `*` is the whole cabinet; an explicit list is a grant, and nothing outside
  // it is added behind the caller's back. That rule is what keeps scheduled
  // runs read-only even after connectors exist.
  const allowAll = agent.tools.includes('*');
  const granted = (name: string) => allowAll || agent.tools.includes(name);

  const extra = pluginBindings().map((b) => ({
    name: b.tool.name,
    description: b.tool.description,
    parameters: b.tool.parameters,
  }));
  const mcpTools = mcpToolDefsCached().map((tool) => ({
    name: tool.name,
    description: `${tool.description} [MCP server: ${tool.server}]`,
    parameters: tool.inputSchema,
  }));
  // Connector tools are supplied below with the live roster, so drop the bare
  // native copies; duplicate names in one tool array upset providers.
  const base = toolDefsFor(agent, [...extra, ...mcpTools]).filter(
    (tool) => tool.name !== 'connector_read' && tool.name !== 'connector_write',
  );
  const present = new Set(base.map((tool) => tool.name));
  const extras: { name: string; description: string; parameters: Record<string, unknown> }[] = [];
  const push = (tool: { name: string; description: string; parameters: Record<string, unknown> }) => {
    if (present.has(tool.name)) return;
    present.add(tool.name);
    extras.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
  };

  for (const tool of STUDIO_TOOLS) if (granted(tool.name)) push(tool);

  for (const tool of connectorToolDefs()) {
    // Reading is part of connecting: the user made that grant in the panel.
    // Writing is a separate grant, and it still stops at an approval.
    if (tool.name === 'connector_write' && !granted('connector_write')) continue;
    push(tool);
  }

  // Research mode needs the literature tools even for a persona that normally
  // does not carry them — the mode is the grant, exactly like the mesh.
  if (research) for (const tool of RESEARCH_TOOLS) push(tool);

  return [...base, ...extras];
}

function buildLanePrompt(
  agent: Agent,
  peers: Agent[],
  mode: RunMode,
  suffix?: string,
  workspace?: string,
  research = false,
): string {
  const settings = store().settings();
  const skills = enabledSkills();
  const pinned = agent.skills.map((id) => getSkill(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const plugins = [...new Map(pluginBindings().map((b) => [b.plugin.id, b.plugin])).values()].map((p) => ({
    name: p.name,
    tools: p.tools.map((t) => t.name),
  }));
  const base = buildSystemPrompt({
    agent,
    settings,
    skills,
    pinned,
    plugins,
    memory: memoryContext(),
    mode: mode === 'council' ? 'council' : 'single',
    peers: peers.filter((p) => p.id !== agent.id).map((p) => p.name),
    workspace,
    research,
  });
  return suffix ? `${base}\n\n${suffix}` : base;
}

function buildHistory(threadId: string): InvokeMessage[] {
  const messages = store().listMessages(threadId).slice(-HISTORY_LIMIT);
  const out: InvokeMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content.slice(0, 12_000) });
    } else if (message.lane !== 'agent') {
      out.push({ role: 'assistant', content: message.content.slice(0, 12_000) });
    }
  }
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}

function titleFrom(input: string): string {
  const clean = input.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
  return clean.length > 58 ? `${clean.slice(0, 58).trimEnd()}…` : clean || 'Untitled thread';
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return value;
  }
}
