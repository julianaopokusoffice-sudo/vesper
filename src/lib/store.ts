import { create } from 'zustand';
import { api, streamChat } from './api';
import { runDeviceAction } from './device';
import { speakText, stopSpeaking } from './voice';
import type {
  Agent,
  Bootstrap,
  BrowserState,
  LinkState,
  MemoryEntry,
  MemoryKind,
  Message,
  MessageSource,
  Plugin,
  Project,
  ProjectKind,
  ProviderId,
  ProviderInfo,
  RunEvent,
  RunMode,
  Settings,
  Skill,
  Thread,
  ToolInfo,
  ToolTrace,
  Usage,
  VoiceInfo,
  VoiceSettings,
} from '@shared/types';

export type View =
  | 'chat'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'memory'
  | 'library'
  | 'workspace'
  | 'automations'
  | 'connectors'
  | 'studio'
  | 'link'
  | 'artifacts'
  | 'browser'
  | 'voice'
  | 'crew'
  | 'settings';

export interface Lane {
  agentId: string;
  name: string;
  accent: string;
  messageId?: string;
  label?: string;
  lane?: 'agent' | 'synthesis';
  text: string;
  reasoning: string;
  traces: ToolTrace[];
  sources: MessageSource[];
  usage?: Usage;
  model?: string;
  error?: string;
  done: boolean;
}

export interface RunState {
  input: string;
  mode: RunMode;
  status: 'submitted' | 'streaming' | 'done' | 'error';
  lanes: Lane[];
  startedAt: number;
  showOptimistic: boolean;
}

export interface FinishedRun {
  at: number;
  text: string;
  agentId?: string;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  agentId: string;
  name: string;
  reason: string;
  input: unknown;
}

interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface State {
  ready: boolean;
  app: Bootstrap['app'] | null;
  agents: Agent[];
  tools: ToolInfo[];
  memory: MemoryEntry[];
  link: LinkState | null;
  threadsOpen: boolean;
  skills: Skill[];
  plugins: Plugin[];
  providers: ProviderInfo[];
  settings: Settings;
  threads: Thread[];
  projects: Project[];
  /** threadId → projectId. Threads without one use the default workspace. */
  threadProjects: Record<string, string>;
  activeThreadId: string | null;
  messages: Message[];
  view: View;
  run: RunState | null;
  /** The last completed answer, kept after the live run is cleared. Voice mode reads it. */
  lastRun: FinishedRun | null;
  council: string[];
  inspector: boolean;
  paletteOpen: boolean;
  approvals: ApprovalRequest[];
  toasts: Toast[];
  focusedAgentId: string | null;
  browser: BrowserState | null;
  /** The agent navigated while the user was elsewhere. */
  browserAttention: boolean;
  browserBusy: boolean;

  init: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  initBrowser: () => void;
  refreshBrowser: () => Promise<void>;
  openBrowser: (url: string, options?: { tabId?: string; newTab?: boolean }) => Promise<boolean>;
  browserAction: (action: 'back' | 'forward' | 'reload') => Promise<void>;
  newBrowserTab: () => Promise<void>;
  selectBrowserTab: (id: string) => Promise<void>;
  closeBrowserTab: (id: string) => Promise<void>;
  focusBrowser: () => void;
  selectThread: (id: string) => Promise<void>;
  newThread: (agentId?: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  pinThread: (id: string, pinned: boolean) => Promise<void>;
  setMode: (mode: RunMode) => Promise<void>;
  setThreadAgent: (agentId: string) => Promise<void>;
  createProject: (name: string, kind: ProjectKind) => Promise<Project | null>;
  setThreadProject: (threadId: string | null, projectId: string | null) => Promise<void>;
  setCouncil: (ids: string[]) => void;
  send: (input: string, images?: string[]) => Promise<void>;
  /** Data URIs attached to the next message, waiting in the composer. */
  draftImages: string[];
  setDraftImages: (images: string[]) => void;
  regenerate: () => Promise<void>;
  stop: () => void;
  setView: (view: View) => void;
  setThreadsOpen: (open: boolean) => void;
  refreshLink: () => Promise<void>;
  mintCode: (scopes: string[]) => Promise<void>;
  pairDevice: (url: string, code: string, scopes: string[]) => Promise<void>;
  patchNode: (id: string, patch: { name?: string; url?: string; scopes?: string[]; granted?: string[] }) => Promise<void>;
  forgetNode: (id: string) => Promise<void>;
  pingNode: (id: string) => Promise<boolean>;
  runRemoteTask: (id: string, prompt: string) => Promise<{ ok: boolean; output: string; ms: number; traces?: { name: string; ms?: number }[] }>;
  runRemoteShell: (id: string, command: string) => Promise<{ ok: boolean; output: string; ms: number }>;
  saveMemory: (input: { kind?: MemoryKind; title: string; body: string; tags?: string[]; pinned?: boolean }) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  toggleMemoryPin: (entry: MemoryEntry) => Promise<void>;
  syncMemory: (nodeId?: string) => Promise<{ node: string; pulled?: number; pushed?: number; error?: string }[]>;
  toggleInspector: () => void;
  setPalette: (open: boolean) => void;
  setFocusedAgent: (id: string | null) => void;
  approve: (id: string, approved: boolean) => Promise<void>;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
  replaceSkills: (skills: Skill[]) => void;
  replacePlugins: (plugins: Plugin[]) => void;
  replaceProviders: (providers: ProviderInfo[]) => void;
  updateAgentLocal: (agent: Agent) => void;
  removeAgentLocal: (id: string) => void;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
  saveVoice: (patch: Partial<VoiceSettings>, key?: string) => Promise<VoiceInfo>;
}

let controller: AbortController | null = null;
let browserEvents: EventSource | null = null;

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const useStore = create<State>()((set, get) => ({
  ready: false,
  app: null,
  agents: [],
  tools: [],
  memory: [],
  link: null,
  threadsOpen: false,
  skills: [],
  plugins: [],
  providers: [],
  settings: {
    defaultModel: { provider: 'demo', id: 'vesper-demo-1' },
    wallpaper: 'aurora',
    speakReplies: false,
    councilSize: 3,
    theme: 'dark',
    reduceMotion: false,
    showInspector: true,
    systemPreamble: '',
    maxSteps: 6,
    temperature: 0.7,
    image: { backend: 'off', baseURL: 'http://127.0.0.1:8080', model: '', steps: 20, size: '1024x1024' },
    voice: {
      stt: 'browser',
      tts: 'browser',
      baseURL: 'http://127.0.0.1:8081/v1',
      sttModel: 'whisper-1',
      ttsModel: 'tts-1',
      ttsVoice: 'alloy',
      character: 'aura',
      visual: 'character',
      autoListen: true,
    },
  },
  threads: [],
  projects: [],
  threadProjects: {},
  activeThreadId: null,
  messages: [],
  view: 'chat',
  run: null,
  lastRun: null,
  council: readLS<string[]>('vesper.council', []),
  inspector: readLS<boolean>('vesper.inspector', true),
  paletteOpen: false,
  approvals: [],
  draftImages: [],
  setDraftImages(images) {
    set({ draftImages: images.slice(0, 4) });
  },
  toasts: [],
  focusedAgentId: null,
  browser: null,
  browserAttention: false,
  browserBusy: false,

  async init() {
    const boot = await api.bootstrap();
    const thread = boot.threads[0] ?? null;
    const messages = thread ? await api.messages(thread.id).catch(() => []) : [];
    const council = get().council.length
      ? get().council.filter((id) => boot.agents.some((a) => a.id === id))
      : boot.agents.slice(0, boot.settings.councilSize || 3).map((a) => a.id);
    set({
      ready: true,
      app: boot.app,
      agents: boot.agents,
      tools: boot.tools ?? [],
      memory: boot.memory ?? [],
      link: boot.link ?? null,
      skills: boot.skills,
      plugins: boot.plugins,
      providers: boot.providers,
      settings: boot.settings,
      threads: boot.threads,
      projects: boot.projects ?? [],
      threadProjects: boot.threadProjects ?? {},
      activeThreadId: thread?.id ?? null,
      messages,
      council,
      inspector: get().inspector,
      focusedAgentId: thread?.agentId ?? boot.agents[0]?.id ?? null,
    });
    document.documentElement.dataset.theme = boot.settings.theme ?? 'dark';
    document.documentElement.dataset.motion = boot.settings.reduceMotion ? 'reduced' : 'full';
    get().initBrowser();
  },

  async refreshMeta() {
    const boot = await api.bootstrap();
    set({
      app: boot.app,
      agents: boot.agents,
      tools: boot.tools ?? [],
      memory: boot.memory ?? [],
      link: boot.link ?? null,
      skills: boot.skills,
      plugins: boot.plugins,
      providers: boot.providers,
      settings: boot.settings,
      threads: boot.threads,
      projects: boot.projects ?? [],
      threadProjects: boot.threadProjects ?? {},
    });
  },

  async selectThread(id) {
    if (get().activeThreadId === id && get().messages.length) {
      set({ view: 'chat' });
      return;
    }
    const messages = await api.messages(id);
    const thread = get().threads.find((t) => t.id === id);
    set({
      activeThreadId: id,
      messages,
      view: 'chat',
      run: null,
      focusedAgentId: thread?.agentId ?? get().focusedAgentId,
    });
  },

  async newThread(agentId) {
    const state = get();
    const agent = agentId ?? state.focusedAgentId ?? state.agents[0]?.id ?? 'vesper';
    const thread = await api.createThread({ agentId: agent });
    set({
      threads: [thread, ...state.threads],
      activeThreadId: thread.id,
      messages: [],
      view: 'chat',
      run: null,
      focusedAgentId: agent,
    });
  },

  async deleteThread(id) {
    await api.deleteThread(id);
    const threads = get().threads.filter((t) => t.id !== id);
    const wasActive = get().activeThreadId === id;
    if (wasActive) {
      const next = threads[0];
      set({ threads, activeThreadId: next?.id ?? null, messages: next ? await api.messages(next.id) : [] });
    } else {
      set({ threads });
    }
    get().toast('info', 'Thread deleted');
  },

  async renameThread(id, title) {
    const updated = await api.patchThread(id, { title });
    set({ threads: get().threads.map((t) => (t.id === id ? updated : t)) });
  },

  async pinThread(id, pinned) {
    const updated = await api.patchThread(id, { pinned });
    set({ threads: get().threads.map((t) => (t.id === id ? { ...updated, messageCount: t.messageCount } : t)) });
  },

  async setMode(mode) {
    const id = get().activeThreadId;
    if (!id) {
      set({ view: 'chat' });
      return;
    }
    const updated = await api.patchThread(id, { mode });
    set({ threads: get().threads.map((t) => (t.id === id ? updated : t)) });
  },

  async setThreadAgent(agentId) {
    const id = get().activeThreadId;
    set({ focusedAgentId: agentId });
    if (!id) return;
    const updated = await api.patchThread(id, { agentId });
    set({ threads: get().threads.map((t) => (t.id === id ? updated : t)) });
  },

  async createProject(name, kind) {
    try {
      const result = await api.createProject({ name, kind });
      set({ projects: result.projects });
      get().toast('success', `Project “${result.project.name}” created`);
      return result.project;
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : 'Could not create project');
      return null;
    }
  },

  async setThreadProject(threadId, projectId) {
    const id = threadId ?? get().activeThreadId;
    if (!id) {
      if (projectId) get().toast('info', 'Send one message first — then the thread can hold a project.');
      return;
    }
    try {
      const result = await api.attachProject(id, projectId);
      set({ threadProjects: result.threads });
      const project = get().projects.find((p) => p.id === projectId);
      get().toast('success', project ? `Thread now lives in “${project.name}”` : 'Thread moved to the default workspace');
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : 'Could not move the thread');
    }
  },

  setCouncil(ids) {
    localStorage.setItem('vesper.council', JSON.stringify(ids));
    set({ council: ids });
  },

  async send(input, images) {
    stopSpeaking();
    const state = get();
    const text = input.trim();
    const attachments = (images ?? []).slice(0, 4);
    if (!text && !attachments.length) return;

    let threadId = state.activeThreadId;
    let threads = state.threads;
    if (!threadId) {
      const created = await api.createThread({ agentId: state.focusedAgentId ?? state.agents[0]?.id ?? 'vesper' });
      threadId = created.id;
      threads = [created, ...threads];
      set({ activeThreadId: threadId, threads, messages: [] });
    }

    const thread = threads.find((t) => t.id === threadId);
    const mode: RunMode = thread?.mode === 'research' ? 'research' : thread?.mode === 'council' ? 'council' : 'single';
    const council = get().council;
    const agentIds =
      mode === 'council'
        ? (council.length ? council : get().agents.slice(0, 3).map((a) => a.id))
        : [thread?.agentId ?? get().focusedAgentId ?? 'vesper'];

    get().setDraftImages([]);
    await runRequest(threadId, text || 'Describe the attached image(s).', agentIds, mode, false, attachments, set, get);
  },

  async regenerate() {
    const state = get();
    const threadId = state.activeThreadId;
    if (!threadId) return;
    const thread = state.threads.find((t) => t.id === threadId);
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const mode: RunMode = thread?.mode === 'research' ? 'research' : thread?.mode === 'council' ? 'council' : 'single';
    const agentIds = mode === 'council' ? get().council : [thread?.agentId ?? 'vesper'];
    const cut = state.messages.findIndex((m) => m.id === lastUser.id);
    if (cut >= 0) set({ messages: state.messages.slice(0, cut + 1) });
    await runRequest(threadId, lastUser.content, agentIds, mode, true, lastUser.images ?? [], set, get);
  },

  stop() {
    stopSpeaking();
    controller?.abort();
    set({ run: get().run ? { ...get().run!, status: 'done' } : null });
    const threadId = get().activeThreadId;
    setTimeout(async () => {
      if (!threadId) return;
      const [messages, threads] = await Promise.all([
        api.messages(threadId).catch(() => []),
        api.threads().catch(() => get().threads),
      ]);
      set({ messages, threads, run: null, approvals: [] });
    }, 350);
  },

  setView(view) {
    set({ view, paletteOpen: false, threadsOpen: false, ...(view === 'browser' ? { browserAttention: false } : {}) });
    if (view === 'browser') get().initBrowser();
  },

  initBrowser() {
    if (typeof window === 'undefined' || browserEvents) return;
    const refresh = () =>
      api
        .browser()
        .then((browser) => set({ browser }))
        .catch(() => undefined);
    void refresh();
    try {
      browserEvents = new EventSource('/api/browser/events');
      browserEvents.addEventListener('state', (event) => {
        try {
          const browser = JSON.parse((event as MessageEvent<string>).data) as BrowserState;
          set({ browser });
          const agentMoved = browser.tabs.some((tab) => tab.actor === 'agent');
          if (agentMoved && get().view !== 'browser') set({ browserAttention: true });
        } catch {
          /* a malformed frame is not worth a crash */
        }
      });
    } catch {
      /* EventSource is unavailable in a few embedded webviews; polling still works */
    }
  },

  async refreshBrowser() {
    try {
      set({ browser: await api.browser() });
    } catch {
      /* runtime asleep */
    }
  },

  async openBrowser(url, options) {
    set({ browserBusy: true });
    try {
      const result = await api.browserOpen(url, options);
      set({ browser: result.state, browserBusy: false, browserAttention: false });
      return true;
    } catch (error) {
      set({ browserBusy: false });
      get().toast('error', error instanceof Error ? error.message : 'The browser could not open that page');
      return false;
    }
  },

  async browserAction(action) {
    try {
      const result = await api.browserAct(action);
      set({ browser: result.state });
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : 'The browser could not go there');
    }
  },

  async newBrowserTab() {
    try {
      set({ browser: await api.browserNewTab(), browserAttention: false });
    } catch (error) {
      get().toast('error', error instanceof Error ? error.message : 'Could not open a tab');
    }
  },

  async selectBrowserTab(id) {
    try {
      set({ browser: await api.browserActivateTab(id) });
    } catch {
      /* the tab may have just closed */
    }
  },

  async closeBrowserTab(id) {
    try {
      set({ browser: await api.browserCloseTab(id) });
    } catch {
      /* ignore */
    }
  },

  focusBrowser() {
    get().setView('browser');
  },
  setThreadsOpen(open) {
    set({ threadsOpen: open });
  },

  async refreshLink() {
    set({ link: await api.link() });
  },

  async mintCode(scopes) {
    const link = await api.mintCode(scopes);
    set({ link });
  },

  async pairDevice(url, code, scopes) {
    const result = await api.pair({ url, code, scopes });
    set({ link: result.link });
    get().toast('success', `Paired with ${result.node.name}`);
  },

  async patchNode(id, patch) {
    set({ link: await api.patchNode(id, patch) });
  },

  async forgetNode(id) {
    set({ link: await api.forgetNode(id) });
    get().toast('info', 'Device removed. Its key no longer works.');
  },

  async pingNode(id) {
    try {
      const result = await api.pingNode(id);
      set({ link: await api.link() });
      return true;
    } catch {
      return false;
    }
  },

  async runRemoteTask(id, prompt) {
    return api.taskNode(id, prompt);
  },

  async runRemoteShell(id, command) {
    return api.invokeNode(id, 'run_shell', { command });
  },

  async saveMemory(input) {
    const entry = await api.addMemory(input);
    set({ memory: [entry, ...get().memory.filter((e) => e.id !== entry.id)] });
    get().toast('success', 'Saved to shared memory');
  },

  async deleteMemory(id) {
    await api.deleteMemory(id);
    set({ memory: get().memory.filter((e) => e.id !== id) });
  },

  async toggleMemoryPin(entry) {
    const updated = await api.patchMemory(entry.id, { pinned: !entry.pinned });
    set({ memory: get().memory.map((e) => (e.id === updated.id ? updated : e)) });
  },

  async syncMemory(nodeId) {
    const result = await api.syncMemory(nodeId);
    const refreshed = await api.memory();
    set({ memory: refreshed.entries, link: await api.link() });
    return result.results;
  },

  toggleInspector() {
    const next = !get().inspector;
    localStorage.setItem('vesper.inspector', JSON.stringify(next));
    set({ inspector: next });
  },
  setPalette(open) {
    set({ paletteOpen: open });
  },
  setFocusedAgent(id) {
    set({ focusedAgentId: id });
  },

  async approve(id, approved) {
    set({ approvals: get().approvals.filter((a) => a.id !== id) });
    await api.approve(id, approved).catch(() => {});
  },

  toast(kind, text) {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  replaceSkills(skills) {
    set({ skills });
  },
  replacePlugins(plugins) {
    set({ plugins });
  },
  replaceProviders(providers) {
    set({ providers });
  },
  updateAgentLocal(agent) {
    const exists = get().agents.some((a) => a.id === agent.id);
    set({ agents: exists ? get().agents.map((a) => (a.id === agent.id ? agent : a)) : [...get().agents, agent] });
  },
  removeAgentLocal(id) {
    set({ agents: get().agents.filter((a) => a.id !== id) });
  },

  async patchSettings(patch) {
    const settings = await api.saveSettings(patch);
    set({ settings });
    if (patch.theme) document.documentElement.dataset.theme = patch.theme;
    if (patch.reduceMotion !== undefined) document.documentElement.dataset.motion = patch.reduceMotion ? 'reduced' : 'full';
  },

  async saveVoice(patch, key) {
    const info = await api.saveVoice(patch, key);
    set({ settings: { ...get().settings, voice: info.settings } });
    return info;
  },
}));

async function runRequest(
  threadId: string,
  input: string,
  agentIds: string[],
  mode: RunMode,
  regenerate: boolean,
  images: string[] = [],
  set: (partial: Partial<State> | ((state: State) => Partial<State>)) => void,
  get: () => State,
) {
  controller?.abort();
  controller = new AbortController();
  const agents = get().agents;
  const seeded: Lane[] = agentIds.map((id) => {
    const agent = agents.find((a) => a.id === id);
    return {
      agentId: id,
      name: agent?.name ?? id,
      accent: agent?.accent ?? '#f0b429',
      text: '',
      reasoning: '',
      traces: [],
      sources: [],
      done: false,
    };
  });

  set({
    run: {
      input: regenerate ? (get().run?.input ?? '') : input,
      mode,
      status: 'submitted',
      lanes: seeded,
      startedAt: Date.now(),
      showOptimistic: !regenerate,
    },
    approvals: [],
    // A spoken turn stays in voice mode; typing a turn returns to the chat.
    view: get().view === 'voice' ? 'voice' : 'chat',
  });

  const patchLane = (agentId: string, patch: Partial<Lane>, create?: { name: string; accent: string; label?: string }) => {
    set((state) => {
      if (!state.run) return {};
      const lanes = state.run.lanes.map((lane) => (lane.agentId === agentId ? { ...lane, ...patch } : lane));
      const exists = lanes.some((l) => l.agentId === agentId);
      if (!exists && create) {
        lanes.push({ agentId, name: create.name, accent: create.accent, label: create.label, text: '', reasoning: '', traces: [], sources: [], done: false, ...patch });
      }
      return { run: { ...state.run, status: 'streaming', lanes } };
    });
  };

  const onEvent = (event: RunEvent) => {
    switch (event.type) {
      case 'run_start':
        set((state) =>
          state.run
            ? {
                run: {
                  ...state.run,
                  status: 'streaming',
                  lanes: event.lanes.map((lane) => ({
                    agentId: lane.agentId,
                    name: lane.name,
                    accent: lane.accent,
                    text: '',
                    reasoning: '',
                    traces: [],
                    sources: [],
                    done: false,
                  })),
                },
              }
            : {},
        );
        break;
      case 'lane_start':
        patchLane(event.agentId, { messageId: event.messageId, lane: event.lane, label: event.label }, {
          name: get().agents.find((a) => a.id === event.agentId)?.name ?? event.agentId,
          accent: get().agents.find((a) => a.id === event.agentId)?.accent ?? '#f0b429',
          label: event.label,
        });
        break;
      case 'delta':
        set((state) => {
          if (!state.run) return {};
          return {
            run: {
              ...state.run,
              status: 'streaming',
              lanes: state.run.lanes.map((lane) =>
                lane.agentId === event.agentId ? { ...lane, text: lane.text + event.text } : lane,
              ),
            },
          };
        });
        break;
      case 'reasoning':
        set((state) => {
          if (!state.run) return {};
          return {
            run: {
              ...state.run,
              lanes: state.run.lanes.map((lane) =>
                lane.agentId === event.agentId && lane.lane !== 'synthesis'
                  ? { ...lane, reasoning: lane.reasoning + event.text }
                  : lane,
              ),
            },
          };
        });
        break;
      case 'trace':
        set((state) => {
          if (!state.run) return {};
          return {
            run: {
              ...state.run,
              lanes: state.run.lanes.map((lane) => {
                if (lane.agentId !== event.agentId) return lane;
                const index = lane.traces.findIndex((t) => t.id === event.trace.id);
                const traces =
                  index >= 0
                    ? lane.traces.map((t, i) => (i === index ? { ...t, ...event.trace } : t))
                    : [...lane.traces, event.trace];
                return { ...lane, traces };
              }),
            },
          };
        });
        break;
      case 'source':
        set((state) => {
          if (!state.run) return {};
          return {
            run: {
              ...state.run,
              lanes: state.run.lanes.map((lane) => {
                if (lane.agentId !== event.agentId) return lane;
                if (lane.sources.some((source) => source.url === event.source.url)) return lane;
                return { ...lane, sources: [...lane.sources, { n: lane.sources.length + 1, ...event.source }] };
              }),
            },
          };
        });
        break;
      case 'approval':
        set((state) => ({
          approvals: [
            ...state.approvals,
            { id: event.approvalId, agentId: event.agentId, name: event.name, reason: event.reason, input: event.input },
          ],
        }));
        break;
      case 'device_action':
        // The host surface answers; a browser without the capability fails
        // loudly rather than leaving the tool hanging.
        void (async () => {
          const result = await runDeviceAction(event.actionId, event.name, event.input);
          await api.resolveAction(event.actionId, result).catch(() => {});
        })();
        break;
      case 'lane_end': {
        const lane = get().run?.lanes.find((entry) => entry.agentId === event.agentId);
        if (get().settings.speakReplies && get().view !== 'voice' && lane?.text && lane.lane !== 'synthesis') {
          void speakText(lane.text, get().settings.voice);
        }
        patchLane(event.agentId, { done: true, usage: event.usage, model: event.model, error: event.error });
        break;
      }
      case 'error':
        get().toast('error', event.message);
        set((state) => (state.run ? { run: { ...state.run, status: 'error' } } : {}));
        break;
      case 'run_end': {
        const current = get().run;
        const lane =
          current?.lanes.find((entry) => entry.lane === 'synthesis') ??
          [...(current?.lanes ?? [])].reverse().find((entry) => entry.done && entry.text.trim());
        set((state) => ({
          ...(state.run ? { run: { ...state.run, status: state.run.status === 'error' ? 'error' : 'done' } } : {}),
          lastRun: { at: Date.now(), text: lane?.text ?? '', agentId: lane?.agentId },
        }));
        break;
      }
    }
  };

  try {
    await streamChat(
      { threadId, input: regenerate ? '' : input, agentIds, mode, regenerate, images: images.length ? images : undefined },
      { onEvent, signal: controller.signal },
    );
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      get().toast('error', err instanceof Error ? err.message : 'Run failed');
      set((state) => (state.run ? { run: { ...state.run, status: 'error' } } : {}));
    }
  } finally {
    const [messages, threads] = await Promise.all([
      api.messages(threadId).catch(() => get().messages),
      api.threads().catch(() => get().threads),
    ]);
    const thread = threads.find((t) => t.id === threadId);
    set({
      messages,
      threads,
      run: null,
      approvals: [],
      focusedAgentId: thread?.agentId ?? get().focusedAgentId,
    });
  }
}
