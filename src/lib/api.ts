import type {
  Agent,
  Automation,
  Bootstrap,
  BrowserState,
  ChatRequest,
  CitationStyle,
  CliAdapterInfo,
  CliCrewRequest,
  CliCrewRun,
  CliRole,
  ConnectorDefinition,
  ConnectorInfo,
  LibraryEntry,
  LibraryStatus,
  LinkState,
  MemoryEntry,
  MemoryKind,
  Message,
  Plugin,
  Project,
  ProjectKind,
  PaperHit,
  PaperSource,
  ProviderId,
  ProviderInfo,
  RunEvent,
  Settings,
  Skill,
  StudioMedia,
  StudioProject,
  Thread,
  UpdateInfo,
  VoiceInfo,
  VoiceSettings,
} from '@shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail;
    try {
      const parsed = JSON.parse(detail);
      message = parsed.error ?? parsed.message ?? detail;
    } catch {
      /* plain text */
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  threads: () => request<Thread[]>('/api/threads'),
  createThread: (body: { agentId: string; title?: string; mode?: string }) =>
    request<Thread>('/api/threads', { method: 'POST', body: JSON.stringify(body) }),
  patchThread: (id: string, body: Partial<Thread>) =>
    request<Thread>(`/api/threads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteThread: (id: string) => request<{ ok: true }>(`/api/threads/${id}`, { method: 'DELETE' }),
  messages: (id: string) => request<Message[]>(`/api/threads/${id}/messages`),

  agents: () => request<Agent[]>('/api/agents'),
  saveAgent: (body: Partial<Agent>) =>
    request<Agent>(`/api/agents/${body.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createAgent: (body: Partial<Agent> & { markdown?: string }) =>
    request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request<{ ok: true }>(`/api/agents/${id}`, { method: 'DELETE' }),
  exportAgent: (id: string) => request<{ ok: boolean; file: string }>(`/api/agents/${id}/export`, { method: 'POST' }),
  resolveAction: (id: string, result: { ok: boolean; output: string }) =>
    request<{ ok: boolean }>(`/api/actions/${id}`, { method: 'POST', body: JSON.stringify(result) }),
  mcp: () => request<{ servers: Bootstrap['mcp'] }>('/api/mcp'),
  mcpReload: () =>
    request<{ ok: boolean; tools: number; servers: Bootstrap['mcp'] }>('/api/mcp/reload', { method: 'POST' }),
  localModels: () => request<{ path: string; files: { name: string; bytes: number; modified: number }[] }>('/api/models'),
  downloadModel: (url: string, name?: string) =>
    request<{ ok: boolean; file: string; bytes: number }>('/api/models/download', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    }),
  imageUrl: (marker: string) => `/api/images/${marker.replace('image://', '')}`,
  images: () => request<{ files: { name: string; bytes: number; modified: number }[] }>('/api/images'),

  // visuals, documents and other coding harnesses
  harnesses: (refresh = false) =>
    request<{
      harnesses: Array<{
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
      }>;
      customFile: string;
    }>(`/api/harnesses${refresh ? '?refresh=1' : ''}`),
  artifacts: () =>
    request<{ path: string; files: { name: string; bytes: number; modified: number }[] }>('/api/artifacts'),
  artifactUrl: (name: string) => `/api/artifacts/${encodeURIComponent(name)}`,

  skills: () => request<Skill[]>('/api/skills'),
  toggleSkill: (id: string, enabled: boolean) =>
    request<Skill[]>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  createSkill: (body: { name: string; markdown?: string }) =>
    request<Skill[]>('/api/skills', { method: 'POST', body: JSON.stringify(body) }),
  rawSkill: async (id: string) => (await fetch(`/api/skills/${id}/raw`)).text(),

  plugins: () => request<Plugin[]>('/api/plugins'),
  togglePlugin: (id: string, enabled: boolean) =>
    request<Plugin[]>(`/api/plugins/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  reloadPlugins: () => request<Plugin[]>('/api/plugins/reload', { method: 'POST' }),

  providers: () => request<ProviderInfo[]>('/api/providers'),
  saveProvider: (id: ProviderId, body: { apiKey?: string; baseURL?: string; models?: string[] }) =>
    request<ProviderInfo[]>(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  testProvider: (id: ProviderId) =>
    request<{ ok: boolean; message: string; models?: string[] }>(`/api/providers/${id}/test`, { method: 'POST' }),
  models: (id: ProviderId) => request<{ models: string[] }>(`/api/providers/${id}/models`),

  // in-app browser (shared with the agent tools)
  browser: () => request<BrowserState>('/api/browser'),
  browserOpen: (url: string, options: { tabId?: string; newTab?: boolean } = {}) =>
    request<{ state: BrowserState }>('/api/browser/open', {
      method: 'POST',
      body: JSON.stringify({ url, ...options }),
    }),
  browserAct: (action: 'back' | 'forward' | 'reload', tabId?: string) =>
    request<{ state: BrowserState }>('/api/browser/act', {
      method: 'POST',
      body: JSON.stringify({ action, tabId }),
    }),
  browserNewTab: (url = '') =>
    request<BrowserState>('/api/browser/tabs', { method: 'POST', body: JSON.stringify({ url }) }),
  browserActivateTab: (id: string) =>
    request<BrowserState>(`/api/browser/tabs/${id}/activate`, { method: 'POST' }),
  browserCloseTab: (id: string) => request<BrowserState>(`/api/browser/tabs/${id}`, { method: 'DELETE' }),
  browserFind: (query: string) =>
    request<{ result: string }>('/api/browser/find', { method: 'POST', body: JSON.stringify({ query }) }),

  // voice: browser or a local OpenAI-compatible speech stack
  voice: () => request<VoiceInfo>('/api/voice'),
  saveVoice: (settings: Partial<VoiceSettings>, key?: string) =>
    request<VoiceInfo>('/api/voice', { method: 'PUT', body: JSON.stringify({ settings, key }) }),
  testVoice: () => request<{ ok: boolean; models?: string[]; message: string }>('/api/voice/test', { method: 'POST' }),
  transcribe: async (audio: Blob) => {
    const body = new FormData();
    body.append('file', audio, `speech.${audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'}`);
    const res = await fetch('/api/voice/transcribe', { method: 'POST', body });
    const text = await res.text().catch(() => '');
    let payload: { text?: string; error?: string } = {};
    try {
      payload = JSON.parse(text) as { text?: string; error?: string };
    } catch {
      /* plain text */
    }
    if (!res.ok) throw new Error(payload.error || text || `Transcription failed (${res.status})`);
    return payload.text ?? '';
  },
  speak: async (text: string): Promise<Blob> => {
    const res = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let message = detail;
      try {
        message = (JSON.parse(detail) as { error?: string }).error ?? detail;
      } catch {
        /* plain text */
      }
      throw new Error(message || `Speech failed (${res.status})`);
    }
    return await res.blob();
  },

  // updates (GitHub Releases)
  update: () => request<UpdateInfo>('/api/update'),
  checkUpdate: () => request<UpdateInfo>('/api/update/check', { method: 'POST' }),

  // CLI crew: third-party agentic CLIs working in one workspace
  cliAdapters: (refresh = false) =>
    request<{ adapters: CliAdapterInfo[]; roles: Partial<Record<CliRole, string>> }>(
      `/api/cli/adapters${refresh ? '?refresh=1' : ''}`,
    ),
  cliRuns: () => request<{ runs: CliCrewRun[] }>('/api/cli/runs'),
  startCrew: (body: CliCrewRequest) =>
    request<CliCrewRun>('/api/cli/crew', { method: 'POST', body: JSON.stringify(body) }),
  cancelCrew: (id: string) => request<CliCrewRun>(`/api/cli/runs/${id}/cancel`, { method: 'POST' }),

  settings: () => request<Settings>('/api/settings'),
  saveSettings: (body: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  approve: (id: string, approved: boolean) =>
    request<{ ok: boolean }>(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ approved }) }),
  workspace: () => request<{ path: string; entries: { name: string; dir: boolean }[] }>('/api/workspace'),

  // projects (isolated workspaces)
  projects: () => request<{ projects: Project[]; threads: Record<string, string> }>('/api/projects'),
  createProject: (body: { name: string; kind: ProjectKind }) =>
    request<{ project: Project; projects: Project[] }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  attachProject: (threadId: string, projectId: string | null) =>
    request<{ ok: boolean; threads: Record<string, string> }>(`/api/projects/thread/${threadId}`, {
      method: 'PUT',
      body: JSON.stringify({ projectId }),
    }),

  // research library
  library: (query?: string, status?: string) =>
    request<{ entries: LibraryEntry[]; stats: LibraryStats; styles: CitationStyle[] }>(
      `/api/library${query || status ? `?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(status ? { status } : {}) })}` : ''}`,
    ),
  saveLibrary: (body: Partial<LibraryEntry> & { title: string }) =>
    request<{ entry: LibraryEntry; created: boolean; stats: LibraryStats }>('/api/library', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchLibrary: (id: string, body: Partial<LibraryEntry>) =>
    request<{ entry: LibraryEntry; stats: LibraryStats }>(`/api/library/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteLibrary: (id: string) => request<{ ok: true; stats: LibraryStats }>(`/api/library/${id}`, { method: 'DELETE' }),
  citeLibrary: (id: string, style: CitationStyle) =>
    request<{ style: CitationStyle; citation: string }>(`/api/library/${id}/cite?style=${style}`),
  libraryExportUrl: (style: CitationStyle) => `/api/library/export/${style}`,
  searchPapers: (body: { query: string; source?: PaperSource | 'all'; limit?: number; yearFrom?: number }) =>
    request<{ hits: PaperHit[]; warnings: string[] }>('/api/papers/search', { method: 'POST', body: JSON.stringify(body) }),
  paperByDoi: (doi: string) => request<PaperHit>('/api/papers/doi', { method: 'POST', body: JSON.stringify({ doi }) }),

  // web search backends (keys live sealed on the server)
  searchConfig: () =>
    request<{
      active: string;
      providers: { id: string; label: string; keyless?: boolean; hasKey: boolean; docs: string; note: string; keyHint?: string }[];
    }>('/api/search'),
  saveSearchConfig: (body: { provider?: string; key?: string; clear?: boolean }) =>
    request<{ ok: boolean; active: string }>('/api/search', { method: 'PUT', body: JSON.stringify(body) }),

  // workspace + git (developer surface)
  tree: (path = '.') =>
    request<{ path: string; entries: { name: string; dir: boolean; size: number; modified: number }[] }>(
      `/api/tree?path=${encodeURIComponent(path)}`,
    ),
  fileText: (path: string) =>
    request<{ path: string; text: string; truncated: boolean; binary: boolean; bytes: number }>(
      `/api/file?path=${encodeURIComponent(path)}`,
    ),
  git: (action: 'status' | 'diff' | 'log', args: { path?: string; staged?: boolean } = {}) =>
    request<{ ok: boolean; output: string; repo: boolean }>(`/api/git/${action}`, {
      method: 'POST',
      body: JSON.stringify(args),
    }),

  // scheduled automations
  automations: () => request<{ automations: (Automation & { running?: boolean })[] }>('/api/automations'),
  createAutomation: (body: { name?: string; prompt: string; agentId?: string; everyMinutes?: number; enabled?: boolean }) =>
    request<{ automation: Automation; automations: Automation[] }>('/api/automations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchAutomation: (id: string, body: Partial<Automation>) =>
    request<{ automation: Automation }>(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAutomation: (id: string) => request<{ ok: true }>(`/api/automations/${id}`, { method: 'DELETE' }),
  runAutomation: (id: string) => request<{ ok: boolean; started?: boolean }>(`/api/automations/${id}/run`, { method: 'POST' }),

  // connectors: services around the work
  connectors: () =>
    request<{ connectors: ConnectorInfo[]; catalog: ConnectorDefinition[]; redirectUri: string }>('/api/connectors'),
  saveConnector: (id: string, fields: Record<string, string>) =>
    request<{ connector: ConnectorInfo; error?: string }>(`/api/connectors/${id}`, {
      method: 'POST',
      body: JSON.stringify(fields),
    }),
  disconnectConnector: (id: string) => request<{ ok: boolean }>(`/api/connectors/${id}`, { method: 'DELETE' }),
  testConnector: (id: string) =>
    request<{ ok: boolean; connector: ConnectorInfo }>(`/api/connectors/${id}/test`, { method: 'POST' }),
  connectorOAuth: (id: string) =>
    request<{ url: string }>(`/api/connectors/${id}/oauth/start`, { method: 'POST' }),

  // studio: media bin and timelines
  media: () => request<{ files: StudioMedia[] }>('/api/media'),
  uploadMedia: async (files: File[]) => {
    const body = new FormData();
    for (const file of files) body.append('file', file);
    const response = await fetch('/api/media', { method: 'POST', body });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* plain text */
      }
      throw new Error(message || `Upload failed (${response.status})`);
    }
    return (await response.json()) as { files: StudioMedia[]; media: StudioMedia[] };
  },
  studioList: () =>
    request<{ projects: { id: string; name: string; updatedAt: number; clips: number }[]; latest: StudioProject | null }>(
      '/api/studio',
    ),
  studioProject: (id: string) => request<{ project: StudioProject; summary: string }>(`/api/studio/${id}`),
  saveStudio: (project: StudioProject) =>
    request<{ project: StudioProject; summary: string }>(`/api/studio/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    }),

  // shared memory
  memory: (query?: string) =>
    request<{ entries: MemoryEntry[]; stats: { count: number; pinned: number; sources: number } }>(
      `/api/memory${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  addMemory: (body: { kind?: MemoryKind; title: string; body: string; tags?: string[]; pinned?: boolean }) =>
    request<MemoryEntry>('/api/memory', { method: 'POST', body: JSON.stringify(body) }),
  patchMemory: (id: string, body: Partial<MemoryEntry>) =>
    request<MemoryEntry>(`/api/memory/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMemory: (id: string) => request<{ ok: true }>(`/api/memory/${id}`, { method: 'DELETE' }),
  syncMemory: (nodeId?: string) =>
    request<{ ok: boolean; results: { node: string; nodeId: string; pulled?: number; pushed?: number; error?: string }[] }>(
      '/api/memory/sync',
      { method: 'POST', body: JSON.stringify({ nodeId }) },
    ),

  // paired devices
  link: () => request<LinkState>('/api/link'),
  renameSelf: (name: string) => request<LinkState>('/api/link/self', { method: 'PATCH', body: JSON.stringify({ name }) }),
  mintCode: (scopes: string[], ttlMinutes = 10) =>
    request<LinkState>('/api/link/pairing-code', { method: 'POST', body: JSON.stringify({ scopes, ttlMinutes }) }),
  pair: (body: { url: string; code: string; name?: string; scopes?: string[] }) =>
    request<{ ok: boolean; node: PairedNodeSummary; link: LinkState }>('/api/link/pair', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  patchNode: (id: string, body: { name?: string; url?: string; scopes?: string[]; granted?: string[] }) =>
    request<LinkState>(`/api/link/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  forgetNode: (id: string) => request<LinkState>(`/api/link/nodes/${id}`, { method: 'DELETE' }),
  pingNode: (id: string) =>
    request<{ ok: boolean; node: Bootstrap['link']['peers'][number] }>(`/api/link/nodes/${id}/ping`, { method: 'POST' }),
  invokeNode: (id: string, tool: string, args: Record<string, unknown>) =>
    request<{ ok: boolean; output: string; ms: number; node?: string }>(`/api/link/nodes/${id}/invoke`, {
      method: 'POST',
      body: JSON.stringify({ tool, args }),
    }),
  taskNode: (id: string, prompt: string, agentId?: string) =>
    request<{ ok: boolean; output: string; ms: number; traces?: { name: string; ms?: number }[] }>(
      `/api/link/nodes/${id}/task`,
      { method: 'POST', body: JSON.stringify({ prompt, agentId }) },
    ),
};

type PairedNodeSummary = Bootstrap['link']['peers'][number];

export interface LibraryStats {
  total: number;
  reading: number;
  read: number;
  inbox: number;
}

export type { LibraryStatus };

/** POST /api/chat and fan SSE frames out to the caller. */
export async function streamChat(
  body: ChatRequest,
  handlers: { onEvent: (event: RunEvent) => void; signal: AbortSignal },
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          handlers.onEvent(JSON.parse(payload) as RunEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}
