import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getConnInfo } from '@hono/node-server/conninfo';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { store } from './kernel/store.ts';
import { PATHS } from './kernel/paths.ts';
import { listAgents, getAgent, saveAgent, deleteAgent, exportPersona, importPersona } from './agents/registry.ts';
import { listSkills, toggleSkill, getSkill } from './skills/loader.ts';
import { listPlugins, reloadPlugins, togglePlugin } from './plugins/loader.ts';
import { providerInfos, updateProvider, resolve } from './providers/registry.ts';
import { listOpenAIModels } from './providers/openai.ts';
import { runConversation, runHeadless } from './agent/orchestrator.ts';
import { resolveApproval } from './agent/approvals.ts';
import { slugify } from './agents/registry.ts';
import { NATIVE_TOOLS, safePath } from './tools/native.ts';
import { searchConfig, saveSearchConfig } from './search/config.ts';
import { createAutomation, isAutomationRunning, runAutomation, updateAutomation } from './automations/index.ts';
import { gitDiff, gitLog, gitStatus } from './tools/git.ts';
import { saveMemory, memoryStats } from './memory/index.ts';
import { mcpServerInfos, refreshMcpTools } from './mcp/index.ts';
import { readImage } from './tools/image.ts';
import { listArtifacts, readArtifact } from './tools/docs.ts';
import {
  contentTypeFor,
  getProject,
  latestProject,
  listMedia,
  listProjects as listStudioProjects,
  mediaPath,
  projectSummary,
  saveMedia,
  saveProject,
} from './studio/index.ts';
import { harnessStatuses } from './harness/index.ts';
import { attachThread, createProject, listProjects, threadProjectMap } from './kernel/projects.ts';
import { pendingDeviceActions, resolveDeviceAction } from './agent/devices.ts';
import { searchPapers, paperByDoi, readPaper } from './research/papers.ts';
import { saveLibraryEntry, patchLibraryEntry } from './research/library.ts';
import { citationStyles, exportLibrary, formatCitations, isCitationStyle } from './research/citations.ts';
import { createLinkRouter } from './link/server.ts';
import { createBrowserApi } from './browser/api.ts';
import { createCliApi } from './cli/api.ts';
import { createUpdateApi } from './update/api.ts';
import { createVoiceApi } from './voice/api.ts';
import {
  CONNECTORS,
  connectorInfos,
  disconnectConnector,
  oauthFinish,
  oauthRedirectUri,
  oauthStart,
  probeConnector,
  saveConnector,
} from './connectors/index.ts';
import {
  issuePairingCode,
  linkState,
  pairWithPeer,
  parseScopes,
  peerById,
  probePeer,
  renameIdentity,
  runTaskOnPeer,
  invokePeer,
  setGranted,
  syncMemoryAll,
  syncMemoryWithPeer,
} from './link/index.ts';
import type { Agent, Bootstrap, ChatRequest, MemoryKind, NodeScope, ProviderId, RunEvent } from '../shared/types.ts';

export const VERSION = '1.0.0';

export function createApi() {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? origin : undefined),
      credentials: false,
    }),
  );

  /**
   * The mesh only needs /link on the LAN. The management API (threads, keys,
   * shell tools) stays loopback-only, so a shared Wi-Fi network cannot reach it
   * even though the process listens on all interfaces.
   */
  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/link' || path.startsWith('/link/')) return next();
    let address = '';
    try {
      address = getConnInfo(c).remote.address ?? '';
    } catch {
      address = '127.0.0.1';
    }
    const loopback = address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!loopback) {
      return c.text('Vesper: the management API is loopback-only. Paired devices use /link.', 403);
    }
    return next();
  });

  // The peer protocol lives at /link, not under /api: it is machine-to-machine.
  app.route('/link', createLinkRouter());

  // The in-app browser is shared by the panel, the CLI and the agent tools.
  app.route('/api/browser', createBrowserApi());
  app.route('/api/cli', createCliApi());
  app.route('/api/update', createUpdateApi(VERSION));
  app.route('/api/voice', createVoiceApi());

  // --- bootstrap ------------------------------------------------------------
  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION, uptime: process.uptime() }));

  app.get('/api/bootstrap', async (c) => {
    const settings = store().settings();
    const providers = providerInfos();
    const payload: Bootstrap = {
      app: {
        version: VERSION,
        home: PATHS.home,
        workspace: PATHS.workspace,
        platform: process.platform,
        hasKeys: providers.some((p) => p.hasKey),
        demoOnly: !providers.some((p) => p.hasKey),
      },
      agents: listAgents(),
      tools: NATIVE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        requiresApproval: !!tool.requiresApproval,
        source: 'core',
      })),
      skills: listSkills(),
      plugins: listPlugins(),
      memory: store().listMemory({ limit: 100 }),
      link: linkState(),
      mcp: await mcpServerInfos(),
      providers,
      threads: store().listThreads(),
      settings,
      projects: listProjects(),
      threadProjects: threadProjectMap(),
    };
    return c.json(payload);
  });

  // --- projects (isolated workspaces) ---------------------------------------
  app.get('/api/projects', (c) => c.json({ projects: listProjects(), threads: threadProjectMap() }));

  app.post('/api/projects', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; kind?: string };
    const name = String(body.name ?? '').trim();
    if (!name) return c.json({ error: 'Give the project a name' }, 400);
    const kind = ['code', 'research', 'writing', 'general'].includes(String(body.kind))
      ? (body.kind as 'code' | 'research' | 'writing' | 'general')
      : 'general';
    const project = createProject({ name, kind });
    return c.json({ project, projects: listProjects() });
  });

  /** Scope a thread to a project (or back to the default workspace). */
  app.put('/api/projects/thread/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string | null };
    try {
      attachThread(c.req.param('id'), body.projectId ?? null);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Could not attach project' }, 400);
    }
    return c.json({ ok: true, threads: threadProjectMap() });
  });

  // --- chat -----------------------------------------------------------------
  app.post('/api/chat', async (c) => {
    const body = (await c.req.json()) as ChatRequest;
    if (!body?.threadId || !Array.isArray(body.agentIds)) {
      return c.json({ error: 'threadId and agentIds are required' }, 400);
    }
    const controller = new AbortController();

    return streamSSE(c, async (stream) => {
      let chain: Promise<void> = Promise.resolve();
      let sawEnd = false;
      const emit = (event: RunEvent) => {
        if (event.type === 'run_end') sawEnd = true;
        chain = chain
          .then(() => stream.writeSSE({ data: JSON.stringify(event), event: event.type }))
          .catch(() => {});
      };

      stream.onAbort(() => controller.abort());

      try {
        await runConversation({
          threadId: body.threadId,
          input: body.input ?? '',
          agentIds: body.agentIds,
          mode: body.mode ?? 'single',
          regenerate: body.regenerate,
          images: body.images?.length ? body.images.slice(0, 4) : undefined,
          emit,
          signal: controller.signal,
        });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      if (!sawEnd) {
        emit({ type: 'run_end', runId: randomUUID(), status: controller.signal.aborted ? 'aborted' : 'ok', threadId: body.threadId });
      }
      await chain;
      await stream.writeSSE({ data: '[DONE]' }).catch(() => {});
    });
  });

  // --- threads --------------------------------------------------------------
  app.get('/api/threads', (c) => c.json(store().listThreads()));

  app.post('/api/threads', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agentId = (body.agentId as string) ?? store().settings().defaultModel.provider ?? 'vesper';
    return c.json(store().createThread({ agentId, title: body.title, mode: body.mode }));
  });

  app.patch('/api/threads/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const updated = store().updateThread(c.req.param('id'), body);
    if (!updated) return c.json({ error: 'Thread not found' }, 404);
    return c.json(updated);
  });

  app.delete('/api/threads/:id', (c) => {
    store().deleteThread(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/threads/:id/messages', (c) => c.json(store().listMessages(c.req.param('id'))));

  // --- agents ---------------------------------------------------------------
  app.get('/api/agents', (c) => c.json(listAgents()));

  app.post('/api/agents', async (c) => {
    const body = (await c.req.json()) as Partial<Agent> & { markdown?: string };
    if (body.markdown) return c.json(importPersona(body.markdown));
    return c.json(saveAgent(body));
  });

  app.patch('/api/agents/:id', async (c) => {
    const body = (await c.req.json()) as Partial<Agent>;
    return c.json(saveAgent({ ...body, id: c.req.param('id') }));
  });

  app.delete('/api/agents/:id', (c) => {
    deleteAgent(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/agents/:id/export', (c) => {
    try {
      const file = exportPersona(getAgent(c.req.param('id')));
      return c.json({ ok: true, file });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'export failed' }, 400);
    }
  });

  // --- skills ---------------------------------------------------------------
  app.get('/api/skills', (c) => c.json(listSkills()));

  app.patch('/api/skills/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    toggleSkill(c.req.param('id'), body.enabled ?? true);
    return c.json(listSkills());
  });

  app.post('/api/skills', async (c) => {
    const body = (await c.req.json()) as { name?: string; markdown?: string };
    const name = slugify(body.name ?? 'new-skill');
    const dir = join(PATHS.skills, name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'SKILL.md'), body.markdown ?? templateSkill(name), { mode: 0o600 });
    return c.json(listSkills());
  });

  app.get('/api/skills/:id/raw', (c) => {
    const skill = getSkill(c.req.param('id'));
    if (!skill) return c.json({ error: 'not found' }, 404);
    return c.text(readFileSync(skill.path, 'utf8'));
  });

  // --- plugins --------------------------------------------------------------
  app.get('/api/plugins', (c) => c.json(listPlugins()));

  app.patch('/api/plugins/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    togglePlugin(c.req.param('id'), body.enabled ?? true);
    return c.json(listPlugins());
  });

  app.post('/api/plugins/reload', (c) => c.json(reloadPlugins()));

  // --- providers ------------------------------------------------------------
  app.get('/api/providers', (c) => c.json(providerInfos()));

  app.put('/api/providers/:id', async (c) => {
    const body = (await c.req.json()) as { apiKey?: string; baseURL?: string; models?: string[] };
    const id = c.req.param('id') as ProviderId;
    if (!providerInfos().some((p) => p.id === id)) return c.json({ error: 'Unknown provider' }, 404);
    return c.json(updateProvider(id, body));
  });

  app.post('/api/providers/:id/test', async (c) => {
    const id = c.req.param('id') as ProviderId;
    try {
      const cred = resolve(id);
      if (cred.info.kind === 'demo') return c.json({ ok: true, message: 'Offline demo model is ready.' });
      if (cred.info.kind === 'anthropic') {
        const res = await fetch(`${cred.baseURL.replace(/\/+$/, '')}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: cred.info.models[0], max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return c.json({ ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }, 400);
        return c.json({ ok: true, message: `Connected to ${cred.info.label}.` });
      }
      const models = await listOpenAIModels(cred);
      return c.json({ ok: true, message: `Connected. ${models.length || 'Some'} models available.`, models: models.slice(0, 200) });
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' }, 400);
    }
  });

  app.get('/api/providers/:id/models', async (c) => {
    const id = c.req.param('id') as ProviderId;
    try {
      const cred = resolve(id);
      if (cred.info.kind === 'anthropic') return c.json({ models: cred.info.models });
      if (cred.info.kind === 'demo') return c.json({ models: cred.info.models });
      const models = await listOpenAIModels(cred);
      return c.json({ models });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'failed' }, 400);
    }
  });

  // --- settings / approvals / workspace ------------------------------------
  app.get('/api/settings', (c) => c.json(store().settings()));
  app.put('/api/settings', async (c) => c.json(store().saveSettings(await c.req.json())));

  app.post('/api/approvals/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { approved?: boolean };
    const ok = resolveApproval(c.req.param('id'), !!body.approved);
    return c.json({ ok, resolved: ok });
  });

  app.get('/api/workspace', (c) => {
    const entries = existsSync(PATHS.workspace)
      ? readdirSync(PATHS.workspace, { withFileTypes: true })
          .slice(0, 300)
          .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      : [];
    return c.json({ path: PATHS.workspace, entries });
  });

  app.get('/api/stats', (c) => c.json(store().stats()));

  // --- developer surface: file tree, file text, git ------------------------
  app.get('/api/tree', (c) => {
    const rel = c.req.query('path') || '.';
    try {
      const target = safePath(PATHS.workspace, rel);
      if (!existsSync(target) || !statSync(target).isDirectory()) return c.json({ error: 'No such directory' }, 404);
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist')
        .slice(0, 400)
        .map((entry) => {
          const full = join(target, entry.name);
          let size = 0;
          let modified = 0;
          try {
            const info = statSync(full);
            size = entry.isDirectory() ? 0 : info.size;
            modified = info.mtimeMs;
          } catch {
            /* skipped while scanning */
          }
          return { name: entry.name, dir: entry.isDirectory(), size, modified };
        })
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return c.json({ path: rel, root: PATHS.workspace, entries });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not list that directory' }, 400);
    }
  });

  app.get('/api/file', (c) => {
    const rel = c.req.query('path');
    if (!rel) return c.json({ error: 'Give a path' }, 400);
    try {
      const target = safePath(PATHS.workspace, rel);
      if (!existsSync(target) || !statSync(target).isFile()) return c.json({ error: 'No such file' }, 404);
      const bytes = statSync(target).size;
      if (bytes > 4_000_000) return c.json({ error: 'File is larger than 4 MB' }, 413);
      const buffer = readFileSync(target);
      const binary = buffer.includes(0);
      const text = binary ? '' : buffer.toString('utf8').slice(0, 200_000);
      return c.json({ path: rel, text, truncated: !binary && bytes > 200_000, binary, bytes });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not read that file' }, 400);
    }
  });

  app.post('/api/git/:action', async (c) => {
    const action = c.req.param('action');
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; staged?: boolean; limit?: number };
    const cwd = PATHS.workspace;
    if (action === 'status') {
      const result = await gitStatus(cwd);
      return c.json(result);
    }
    if (action === 'diff') {
      const result = await gitDiff(cwd, { path: body.path, staged: body.staged });
      return c.json(result);
    }
    if (action === 'log') {
      const result = await gitLog(cwd, body.limit ?? 12);
      return c.json(result);
    }
    return c.json({ error: `Unknown git action "${action}"` }, 404);
  });

  // --- web search backends -------------------------------------------------
  app.get('/api/search', (c) => c.json(searchConfig()));

  app.put('/api/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { provider?: string; key?: string; clear?: boolean };
    try {
      const saved = saveSearchConfig(body);
      return c.json({ ok: true, ...saved, ...searchConfig() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not save the search key' }, 400);
    }
  });

  // --- images, MCP, device bridge, local models -----------------------------
  /** Gallery for the studio: every image the agents have produced. */
  app.get('/api/images', (c) => {
    const files = existsSync(PATHS.images)
      ? readdirSync(PATHS.images)
          .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
          .map((name) => ({ name, bytes: statSync(join(PATHS.images, name)).size, modified: statSync(join(PATHS.images, name)).mtimeMs }))
          .sort((a, b) => b.modified - a.modified)
          .slice(0, 100)
      : [];
    return c.json({ files });
  });

  /** Generated images are served back to the console (and to peers) by name. */
  app.get('/api/images/:name', (c) => {
    const image = readImage(c.req.param('name'));
    if (!image) return c.json({ error: 'No such image' }, 404);
    return c.body(new Uint8Array(image.buffer), 200, { 'content-type': image.type, 'cache-control': 'private, max-age=86400' });
  });

  /** Documents the agent produced. Names are sanitised; reads are path-checked. */
  app.get('/api/artifacts', (c) => c.json({ path: PATHS.artifacts, files: listArtifacts() }));

  app.get('/api/artifacts/:name', (c) => {
    const name = c.req.param('name');
    const artifact = readArtifact(name);
    if (!artifact) return c.json({ error: 'No such artifact' }, 404);
    return c.body(new Uint8Array(artifact.buffer), 200, {
      'content-type': artifact.type,
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, max-age=0',
    });
  });

  // --- studio: media bin + timelines ---------------------------------------
  app.get('/api/media', (c) => c.json({ files: listMedia() }));

  /** Uploads are the user's own footage; they are stored locally and never leave. */
  app.post('/api/media', async (c) => {
    try {
      const form = await c.req.formData();
      const files = [...form.getAll('file'), ...form.getAll('files')].filter((entry): entry is File => entry instanceof File);
      if (!files.length) return c.json({ error: 'Attach at least one file' }, 400);
      const saved = [];
      for (const file of files) {
        saved.push(saveMedia(file.name, new Uint8Array(await file.arrayBuffer())));
      }
      return c.json({ files: saved, media: listMedia() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Upload failed' }, 400);
    }
  });

  /** Range requests make a long clip scrubbable without loading it whole. */
  app.get('/api/media/:name', (c) => {
    const found = mediaPath(c.req.param('name'));
    if (!found) return c.json({ error: 'No such media file' }, 404);
    const buffer = readFileSync(found.file);
    const type = contentTypeFor(found.file);
    const headers: Record<string, string> = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
    };
    const range = c.req.header('range');
    const match = range?.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const total = buffer.length;
      const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2] || 0));
      const end = match[2] && match[1] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (start > end || start >= total) return c.body(null, 416, { 'content-range': `bytes */${total}` });
      const slice = buffer.subarray(start, end + 1);
      return c.body(new Uint8Array(slice), 206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${total}`,
        'content-length': String(slice.length),
      });
    }
    return c.body(new Uint8Array(buffer), 200, { ...headers, 'content-length': String(buffer.length) });
  });

  app.get('/api/studio', (c) => c.json({ projects: listStudioProjects(), latest: latestProject() }));

  app.get('/api/studio/:id', (c) => {
    const project = getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'No such studio project' }, 404);
    return c.json({ project, summary: projectSummary(project) });
  });

  app.put('/api/studio/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const project = saveProject({ ...(body as any), id: c.req.param('id') });
      return c.json({ project, summary: projectSummary(project) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not save the timeline' }, 400);
    }
  });

  /** Which external coding agents are installed, so the console can show and drive them. */
  app.get('/api/harnesses', (c) =>
    c.json({
      harnesses: harnessStatuses(c.req.query('refresh') === '1'),
      customFile: join(PATHS.home, 'harnesses.json'),
    }),
  );

  app.get('/api/mcp', async (c) => c.json({ servers: await mcpServerInfos() }));

  app.post('/api/mcp/reload', async (c) => {
    const { reloadMcp } = await import('./mcp/index.ts');
    reloadMcp();
    const tools = await refreshMcpTools();
    return c.json({ ok: true, tools: tools.length, servers: await mcpServerInfos() });
  });

  app.get('/api/actions', (c) => c.json({ pending: pendingDeviceActions() }));

  app.post('/api/actions/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ok?: boolean; output?: string };
    const ok = resolveDeviceAction(c.req.param('id'), { ok: !!body.ok, output: String(body.output ?? '') });
    return c.json({ ok }, ok ? 200 : 404);
  });

  app.get('/api/models', (c) => {
    const dir = PATHS.models;
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => /\.(gguf|safetensors|bin)$/i.test(name))
          .map((name) => ({ name, bytes: statSync(join(dir, name)).size, modified: statSync(join(dir, name)).mtimeMs }))
          .sort((a, b) => b.modified - a.modified)
      : [];
    return c.json({ path: dir, files, providers: providerInfos().filter((p) => p.local || p.id === 'llamacpp' || p.id === 'ollama') });
  });

  /** Stream a GGUF (or any model file) straight into ~/.vesper/models. */
  app.post('/api/models/download', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; name?: string };
    const url = (body.url ?? '').trim();
    if (!/^https?:\/\//.test(url)) return c.json({ error: 'Give an http(s) URL to a model file' }, 400);
    const target = (body.name ?? url.split('/').pop() ?? 'model.gguf').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!target) return c.json({ error: 'Could not derive a file name' }, 400);

    mkdirSync(PATHS.models, { recursive: true, mode: 0o700 });
    const file = join(PATHS.models, target);
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) return c.json({ error: `HTTP ${response.status} for ${url}` }, 400);
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(file));
    return c.json({ ok: true, file, bytes: statSync(file).size });
  });

  // --- shared memory --------------------------------------------------------
  app.get('/api/memory', (c) => {
    const query = c.req.query('q');
    return c.json({ entries: store().listMemory({ query, limit: 300 }), stats: memoryStats() });
  });

  app.post('/api/memory', async (c) => {
    const body = (await c.req.json()) as {
      kind?: MemoryKind;
      title?: string;
      body?: string;
      tags?: string[];
      pinned?: boolean;
    };
    try {
      const entry = saveMemory({ ...body, title: body.title ?? '', body: body.body ?? '' });
      return c.json(entry);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not save memory' }, 400);
    }
  });

  app.patch('/api/memory/:id', async (c) => {
    const current = store().getMemory(c.req.param('id'));
    if (!current) return c.json({ error: 'Memory not found' }, 404);
    const body = (await c.req.json()) as Partial<{ title: string; body: string; tags: string[]; pinned: boolean; kind: MemoryKind }>;
    const saved = saveMemory({
      id: current.id,
      kind: body.kind ?? current.kind,
      title: body.title ?? current.title,
      body: body.body ?? current.body,
      tags: body.tags ?? current.tags,
      pinned: body.pinned ?? current.pinned,
      source: current.source,
      sourceNodeId: current.sourceNodeId,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    });
    return c.json(saved);
  });

  app.delete('/api/memory/:id', (c) => {
    store().deleteMemory(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/memory/sync', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { nodeId?: string };
    if (body.nodeId) {
      try {
        const peer = peerById(body.nodeId);
        return c.json({ ok: true, results: [{ node: peer.name, nodeId: peer.id, ...(await syncMemoryWithPeer(peer)) }] });
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : 'sync failed' }, 400);
      }
    }
    return c.json({ ok: true, results: await syncMemoryAll() });
  });

  // --- scheduled automations ------------------------------------------------
  app.get('/api/automations', (c) =>
    c.json({
      automations: store().listAutomations().map((job) => ({ ...job, running: isAutomationRunning(job.id) })),
    }),
  );

  app.post('/api/automations', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json({ automation: createAutomation(body), automations: store().listAutomations() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not create the automation' }, 400);
    }
  });

  app.patch('/api/automations/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return c.json({ automation: updateAutomation(c.req.param('id'), body) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not update the automation' }, 400);
    }
  });

  app.delete('/api/automations/:id', (c) => {
    store().deleteAutomation(c.req.param('id'));
    return c.json({ ok: true });
  });

  /** Starts in the background; the console polls for lastStatus. */
  app.post('/api/automations/:id/run', (c) => {
    const id = c.req.param('id');
    if (isAutomationRunning(id)) return c.json({ ok: false, error: 'Already running' }, 409);
    void runAutomation(id, { manual: true }).catch(() => undefined);
    return c.json({ ok: true, started: true });
  });

  // --- connectors -----------------------------------------------------------
  app.get('/api/connectors', (c) =>
    c.json({ connectors: connectorInfos(), catalog: CONNECTORS, redirectUri: oauthRedirectUri() }),
  );

  app.post('/api/connectors/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const connector = saveConnector(c.req.param('id'), body);
      // A saved credential is only a claim until it answers; probe immediately
      // so the card can show a green dot or the provider's own error text.
      try {
        const checked = await probeConnector(c.req.param('id'));
        return c.json({ connector: checked });
      } catch (err) {
        return c.json({
          connector: connectorInfos().find((entry) => entry.definition.id === c.req.param('id')),
          error: err instanceof Error ? err.message : 'Could not reach the service',
        });
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not save the connector' }, 400);
    }
  });

  app.delete('/api/connectors/:id', (c) => c.json({ ok: disconnectConnector(c.req.param('id')) }));

  app.post('/api/connectors/:id/test', async (c) => {
    try {
      return c.json({ ok: true, connector: await probeConnector(c.req.param('id')) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Could not reach the service' }, 400);
    }
  });

  app.post('/api/connectors/:id/oauth/start', (c) => {
    try {
      return c.json(oauthStart(c.req.param('id')));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not start sign-in' }, 400);
    }
  });

  app.get('/api/connectors/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const stateValue = c.req.query('state');
    if (!code || !stateValue) return c.html(oauthPage(false, 'The provider did not return a code.'), 400);
    try {
      const result = await oauthFinish(code, stateValue);
      return c.html(oauthPage(!result.error, result.error ?? 'Connected.'));
    } catch (err) {
      return c.html(oauthPage(false, err instanceof Error ? err.message : 'Sign-in failed.'), 400);
    }
  });

  // --- research library -----------------------------------------------------
  app.get('/api/library', (c) => {
    const entries = store().listLibrary({
      query: c.req.query('q'),
      status: c.req.query('status') || undefined,
      tag: c.req.query('tag') || undefined,
      limit: Number(c.req.query('limit')) || 300,
    });
    return c.json({ entries, stats: store().libraryStats(), styles: citationStyles() });
  });

  app.post('/api/library', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const { entry, created } = await saveLibraryEntry(body);
      return c.json({ entry, created, stats: store().libraryStats() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not save the entry' }, 400);
    }
  });

  app.patch('/api/library/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const entry = patchLibraryEntry(c.req.param('id'), body);
      return c.json({ entry, stats: store().libraryStats() });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not update the entry' }, 400);
    }
  });

  app.delete('/api/library/:id', (c) => {
    store().deleteLibraryEntry(c.req.param('id'));
    return c.json({ ok: true, stats: store().libraryStats() });
  });

  /** One entry, formatted for copying into a paper or a reference manager. */
  app.get('/api/library/:id/cite', (c) => {
    const entry = store().getLibraryEntry(c.req.param('id'));
    if (!entry) return c.json({ error: 'No such entry' }, 404);
    const style = c.req.query('style') ?? 'apa';
    if (!isCitationStyle(style)) return c.json({ error: `Unknown style; use ${citationStyles().join(', ')}` }, 400);
    return c.json({ style, citation: formatCitations([entry], style) });
  });

  /** Whole-library export as a file the user can drop into Zotero or LaTeX. */
  app.get('/api/library/export/:style', (c) => {
    const style = c.req.param('style');
    if (!isCitationStyle(style)) return c.json({ error: `Unknown style; use ${citationStyles().join(', ')}` }, 400);
    const entries = store().listLibrary({ query: c.req.query('q'), status: c.req.query('status') || undefined, limit: 1000 });
    const body = exportLibrary(entries, style);
    const ext = style === 'bibtex' ? 'bib' : style === 'ris' ? 'ris' : 'txt';
    return c.body(body, 200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="vesper-library-${new Date().toISOString().slice(0, 10)}.${ext}"`,
      'cache-control': 'private, no-store',
    });
  });

  // --- papers (search and read, keyless) ------------------------------------
  app.post('/api/papers/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; source?: string; limit?: number; yearFrom?: number };
    if (!body.query?.trim()) return c.json({ error: 'Give the search a query' }, 400);
    try {
      const result = await searchPapers({
        query: body.query,
        sources: body.source && body.source !== 'all' ? [body.source as 'arxiv'] : undefined,
        limit: Math.min(Number(body.limit) || 8, 25),
        yearFrom: body.yearFrom ? Number(body.yearFrom) : undefined,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Search failed' }, 502);
    }
  });

  app.post('/api/papers/read', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; maxChars?: number };
    if (!body.url) return c.json({ error: 'Give a PDF or article URL' }, 400);
    try {
      const paper = await readPaper(body.url);
      const cap = Math.min(Math.max(Number(body.maxChars) || 60_000, 2_000), 120_000);
      return c.json({ ...paper, text: paper.text.slice(0, cap) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not read that paper' }, 502);
    }
  });

  app.post('/api/papers/doi', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { doi?: string };
    if (!body.doi) return c.json({ error: 'Give a DOI' }, 400);
    try {
      return c.json(await paperByDoi(body.doi));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Could not resolve that DOI' }, 404);
    }
  });

  // --- paired devices -------------------------------------------------------
  app.get('/api/link', (c) => c.json(linkState()));

  app.patch('/api/link/self', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (body.name) renameIdentity(body.name);
    return c.json(linkState());
  });

  app.post('/api/link/pairing-code', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { scopes?: string[]; ttlMinutes?: number };
    const scopes = parseScopes(body.scopes?.length ? body.scopes : ['memory', 'files', 'agents']);
    issuePairingCode(scopes, Math.min(Math.max(Number(body.ttlMinutes) || 10, 1), 60) * 60_000);
    return c.json(linkState());
  });

  app.post('/api/link/pair', async (c) => {
    const body = (await c.req.json()) as { url?: string; code?: string; name?: string; scopes?: string[] };
    try {
      const node = await pairWithPeer({
        url: body.url ?? '',
        code: body.code ?? '',
        name: body.name,
        scopes: parseScopes(body.scopes) as NodeScope[],
      });
      return c.json({ ok: true, node, link: linkState() });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Pairing failed' }, 400);
    }
  });

  app.patch('/api/link/nodes/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      url?: string;
      scopes?: string[];
      granted?: string[];
    };
    const id = c.req.param('id');
    if (body.granted) setGranted(id, parseScopes(body.granted));
    if (body.name || body.url || body.scopes) {
      store().updateNode(id, {
        ...(body.name ? { name: body.name } : {}),
        ...(body.url ? { url: body.url.replace(/\/+$/, '') } : {}),
        ...(body.scopes ? { scopes: parseScopes(body.scopes) } : {}),
      });
    }
    return c.json(linkState());
  });

  app.delete('/api/link/nodes/:id', (c) => {
    store().deleteNode(c.req.param('id'));
    return c.json(linkState());
  });

  app.post('/api/link/nodes/:id/ping', async (c) => {
    try {
      const peer = peerById(c.req.param('id'));
      return c.json({ ok: true, node: await probePeer(peer) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'unreachable' }, 400);
    }
  });

  app.post('/api/link/nodes/:id/invoke', async (c) => {
    const body = (await c.req.json()) as { tool?: string; args?: Record<string, unknown> };
    try {
      const peer = peerById(c.req.param('id'));
      const result = await invokePeer(peer, body.tool ?? '', body.args ?? {});
      return c.json({ ...result, node: peer.name }, result.ok ? 200 : 400);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'invoke failed' }, 400);
    }
  });

  app.post('/api/link/nodes/:id/task', async (c) => {
    const body = (await c.req.json()) as { prompt?: string; agentId?: string };
    try {
      const peer = peerById(c.req.param('id'));
      const result = await runTaskOnPeer(peer, body.prompt ?? '', body.agentId);
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'remote task failed' }, 400);
    }
  });

  // --- coding CLI -----------------------------------------------------------
  app.get('/api/cli/context', (c) => {
    const settings = store().settings();
    const agents = listAgents();
    return c.json({
      agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, description: a.description, accent: a.accent, glyph: a.glyph })),
      defaultAgentId: agents[0]?.id ?? 'vesper',
      defaultModel: settings.defaultModel,
      workspace: PATHS.workspace,
      home: PATHS.home,
      memory: memoryStats(),
      nodes: linkState().peers,
      self: linkState().self,
    });
  });

  app.post('/api/cli/run', async (c) => {
    const body = (await c.req.json()) as {
      prompt?: string;
      agentId?: string;
      workspace?: string;
      timeoutMs?: number;
    };
    const prompt = String(body.prompt ?? '').trim();
    if (!prompt) return c.json({ error: 'prompt is required' }, 400);

    const workspace = body.workspace ? resolvePath(body.workspace) : PATHS.workspace;
    if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
      return c.json({ error: `Workspace directory does not exist: ${workspace}` }, 400);
    }

    const controller = new AbortController();
    return streamSSE(c, async (stream) => {
      let chain: Promise<void> = Promise.resolve();
      const send = (payload: unknown) => {
        chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(payload) })).catch(() => {});
      };
      stream.onAbort(() => controller.abort());

      try {
        const result = await runHeadless({
          prompt,
          agentId: body.agentId,
          workspace,
          timeoutMs: body.timeoutMs,
          signal: controller.signal,
          onDelta: (text) => send({ type: 'delta', text }),
          onTrace: (trace) => send({ type: 'trace', trace }),
          onEvent: (event) => {
            if (event.type === 'approval') send(event);
          },
        });
        send({
          type: 'done',
          content: result.content,
          usage: result.usage,
          agent: { id: result.agent.id, name: result.agent.name },
          workspace,
          error: result.error,
        });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      await chain;
      await stream.writeSSE({ data: '[DONE]' }).catch(() => {});
    });
  });

  return app;
}

/** Tiny landing page for the OAuth callback; the app's window stays open. */
function oauthPage(ok: boolean, message: string): string {
  const safe = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Vesper — connector</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0c0f;color:#e8e6e1;font:14px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif}
.card{max-width:420px;padding:28px 30px;border:1px solid #26262c;border-radius:14px;background:#121216;text-align:center}
h1{font:400 22px/1.2 Georgia,serif;margin:0 0 8px}
p{color:${ok ? '#8fb98f' : '#e08a7a'};margin:0 0 16px;word-break:break-word}
button{background:#1b1b21;color:#e8e6e1;border:1px solid #2e2e36;border-radius:8px;padding:7px 14px;font-size:12px;cursor:pointer}
</style></head><body><div class="card"><h1>${ok ? 'Connected' : 'Not connected'}</h1><p>${safe}</p>
<button onclick="window.close()">Close this tab</button></div>
<script>setTimeout(function(){window.close()}, 1800)</script></body></html>`;
}

function templateSkill(name: string) {
  return `---
name: ${name}
description: Describe what this skill does and, crucially, when to use it. The model only ever sees this line until it loads the skill.
license: MIT
---

# ${name.replace(/-/g, ' ')}

## When to use this

## Method

1.

## Output format

## Anti-patterns
`;
}
