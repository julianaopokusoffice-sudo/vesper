// Shared contract between the Vesper server and every surface (web, desktop, HTTP API).

export type ProviderKind = 'openai' | 'anthropic' | 'demo';

export type ProviderId =
  | 'demo'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'deepseek'
  | 'xai'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'cerebras'
  | 'perplexity'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'custom';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  baseURL: string;
  models: string[];
  hasKey: boolean;
  /** True when the endpoint is expected to run locally (no key, no egress). */
  local: boolean;
  docs?: string;
  keyHint?: string;
  configured: boolean;
}

export interface ModelRef {
  provider: ProviderId;
  id: string;
}

export interface Agent {
  id: string;
  name: string;
  handle: string;
  role: string;
  description: string;
  system: string;
  accent: string;
  glyph: string;
  model: ModelRef | null;
  temperature: number;
  maxSteps: number;
  /** Tool ids, or ["*"] for the always-on core set. */
  tools: string[];
  /** Skill ids pinned into the prompt (full body). */
  skills: string[];
  builtin: boolean;
  createdAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  body: string;
  path: string;
  enabled: boolean;
  tokens: number;
  builtin: boolean;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  kind: 'js' | 'command';
  enabled: boolean;
  tools: PluginTool[];
  path: string;
  builtin: boolean;
  error?: string;
}

export type ToolTraceKind = 'call' | 'result' | 'error';

export interface ToolTrace {
  id: string;
  name: string;
  source: string;
  input?: unknown;
  output?: string;
  ok?: boolean;
  ms?: number;
  approval?: 'auto' | 'granted' | 'denied';
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUSD?: number;
  ms?: number;
}

export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  agentId?: string;
  /** "synthesis" marks the council chair's merged answer. */
  lane?: 'agent' | 'synthesis';
  content: string;
  reasoning?: string;
  /** Attached images as data URIs — the vision input and any generated results. */
  images?: string[];
  traces: ToolTrace[];
  usage?: Usage;
  model?: string;
  /** Pages and papers the run actually read, in first-seen order. */
  sources?: MessageSource[];
  createdAt: number;
  seq: number;
}

export interface MessageSource {
  /** 1-based, matches [1] in the answer. */
  n: number;
  title: string;
  url: string;
  kind: 'page' | 'paper';
}

export type RunMode = 'single' | 'council' | 'research';

export interface Thread {
  id: string;
  title: string;
  agentId: string;
  mode: RunMode;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  preview?: string;
  messageCount?: number;
}

export type WallpaperId = 'aurora' | 'dusk' | 'ember' | 'tide' | 'graphite';

export type ThemeId = 'dark' | 'dim' | 'dusk' | 'ember' | 'tide' | 'moss' | 'ultraviolet' | 'paper';

export type VoiceEngine = 'browser' | 'server';
export type VoiceCharacter = 'aura' | 'prism' | 'sentinel' | 'wisp';
export type VoiceVisual = 'character' | 'orb';

/**
 * Voice mode is deliberately provider-shaped rather than vendor-shaped: any
 * OpenAI-compatible `/audio/transcriptions` and `/audio/speech` endpoint works,
 * including whisper.cpp, faster-whisper and Kokoro/Piper servers on localhost.
 * The API key never lives here; it is sealed separately by the server.
 */
export interface VoiceSettings {
  stt: VoiceEngine;
  tts: VoiceEngine;
  /** OpenAI-compatible root, e.g. http://127.0.0.1:8081/v1 */
  baseURL: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  character: VoiceCharacter;
  visual: VoiceVisual;
  /** Keep listening after each spoken reply. */
  autoListen: boolean;
}

export interface VoiceInfo {
  settings: VoiceSettings;
  hasKey: boolean;
  configured: boolean;
}

export interface Settings {
  defaultModel: ModelRef;
  /** Ambient background behind the console. Pure CSS, no image downloads. */
  wallpaper: WallpaperId;
  /** Read agent answers aloud as they finish (Web Speech API or a voice model). */
  speakReplies: boolean;
  councilSize: number;
  theme: ThemeId;
  reduceMotion: boolean;
  showInspector: boolean;
  systemPreamble: string;
  maxSteps: number;
  temperature: number;
  /** Image generation backend for the `generate_image` tool. */
  image: ImageSettings;
  voice: VoiceSettings;
}

// --- in-app browser -----------------------------------------------------------

export interface BrowserLink {
  /** Stable 1-based index used by `browser_click`. */
  index: number;
  text: string;
  url: string;
}

export interface BrowserPage {
  url: string;
  title: string;
  description?: string;
  site: string;
  text: string;
  links: BrowserLink[];
  status: number;
  contentType: string;
  fetchedAt: number;
  error?: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  page?: BrowserPage;
  history: string[];
  historyIndex: number;
  updatedAt: number;
  /** Who moved the tab last; the panel follows an agent automatically. */
  actor: 'user' | 'agent';
}

export interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string;
  revision: number;
}

export type ImageBackend = 'off' | 'openai' | 'sdcpp' | 'a1111';

export interface ImageSettings {
  backend: ImageBackend;
  /** Where the backend listens, e.g. http://127.0.0.1:8080 for stable-diffusion.cpp. */
  baseURL: string;
  model: string;
  /** Optional hosted key; local backends need none. */
  apiKey?: string;
  steps?: number;
  size?: string;
}

export interface McpServerInfo {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  enabled: boolean;
  tools: string[];
  status: 'idle' | 'ready' | 'error';
  error?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  requiresApproval: boolean;
  source: string;
}

export type MemoryKind = 'fact' | 'decision' | 'snippet' | 'preference' | 'question';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string[];
  /** Human label of the device that wrote it, e.g. "Pixel 9 · phone". */
  source: string;
  sourceNodeId?: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Content hash used for de-duplication when two devices sync. */
  hash: string;
}

export type NodeKind = 'desktop' | 'phone' | 'server';
export type NodeScope = 'memory' | 'files' | 'shell' | 'agents';

export interface PairedNode {
  id: string;
  name: string;
  platform: string;
  kind: NodeKind;
  url: string;
  /** What this device may do on the peer. */
  scopes: NodeScope[];
  /** What the peer may do on this device. */
  granted: NodeScope[];
  pairedAt: number;
  lastSeen: number;
  /** Reachability from the local machine, measured on demand. */
  online?: boolean;
  self?: boolean;
}

export interface LinkAuditEntry {
  id: string;
  at: number;
  direction: 'in' | 'out';
  nodeId: string;
  nodeName: string;
  action: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface LinkState {
  self: PairedNode;
  peers: PairedNode[];
  audit: LinkAuditEntry[];
  /** Present only while a pairing code is live. */
  pairingCode?: { code: string; expiresAt: number };
}

export interface RemoteRunResult {
  ok: boolean;
  output: string;
  traces?: ToolTrace[];
  ms: number;
  node: string;
}

export type ProjectKind = 'code' | 'research' | 'writing' | 'general';

export interface Project {
  id: string;
  name: string;
  kind: ProjectKind;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface Bootstrap {
  tools: ToolInfo[];
  projects?: Project[];
  /** threadId → projectId, so each conversation keeps its own sandbox. */
  threadProjects?: Record<string, string>;
  memory: MemoryEntry[];
  link: LinkState;
  mcp: McpServerInfo[];
  app: {
    version: string;
    home: string;
    workspace: string;
    platform: string;
    hasKeys: boolean;
    demoOnly: boolean;
  };
  agents: Agent[];
  skills: Skill[];
  plugins: Plugin[];
  providers: ProviderInfo[];
  threads: Thread[];
  settings: Settings;
}

// --- streaming protocol (server -> client, SSE) -------------------------------

export type RunEvent =
  | { type: 'run_start'; runId: string; mode: RunMode; lanes: { agentId: string; name: string; accent: string }[]; synthesisAgentId?: string }
  | { type: 'lane_start'; agentId: string; messageId: string; label?: string; lane?: 'agent' | 'synthesis' }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'reasoning'; agentId: string; text: string }
  | { type: 'trace'; agentId: string; trace: ToolTrace }
  | { type: 'approval'; agentId: string; approvalId: string; name: string; input: unknown; reason: string }
  | { type: 'lane_end'; agentId: string; messageId: string; usage?: Usage; model?: string; error?: string }
  /** A tool wants to act on the host device (camera, clipboard, share, …). */
  | { type: 'device_action'; agentId: string; actionId: string; name: string; input: unknown; supported: boolean }
  /** A page or paper the run read, collected into the answer's source list. */
  | { type: 'source'; agentId: string; source: Omit<MessageSource, 'n'> }
  | { type: 'run_end'; runId: string; status: 'ok' | 'error' | 'aborted'; threadId: string }
  | { type: 'error'; message: string };

// --- research library ---------------------------------------------------------

export type PaperSource = 'arxiv' | 'pubmed' | 'semanticscholar' | 'crossref';

export interface PaperHit {
  source: PaperSource;
  /** Source-native id: arXiv id, PMID, S2 id or DOI. */
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  url: string;
  pdf?: string;
  doi?: string;
  citations?: number;
}

export type LibraryStatus = 'inbox' | 'reading' | 'read';

export interface LibraryEntry {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  pdf?: string;
  abstract?: string;
  tags: string[];
  note: string;
  status: LibraryStatus;
  /** Where the record came from: arxiv, pubmed, manual, … */
  source: string;
  citations?: number;
  createdAt: number;
  updatedAt: number;
}

export type CitationStyle = 'bibtex' | 'apa' | 'mla' | 'chicago' | 'ris';

// --- automations -------------------------------------------------------------

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  /** Persona whose voice the scheduled run uses. */
  agentId: string;
  everyMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastStatus?: 'ok' | 'error' | 'running';
  lastOutput?: string;
  createdAt: number;
  updatedAt: number;
}

// --- connectors --------------------------------------------------------------

export type ConnectorCategory = 'email' | 'calendar' | 'code' | 'cloud' | 'data' | 'comms' | 'payments' | 'monitoring';

export type ConnectorAuth = 'token' | 'oauth';

export interface ConnectorField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  secret?: boolean;
  required?: boolean;
}

/** Catalog entry: what a service is and how to authenticate against it. */
export interface ConnectorDefinition {
  id: string;
  name: string;
  blurb: string;
  category: ConnectorCategory;
  auth: ConnectorAuth;
  accent: string;
  docsUrl: string;
  /** Default API root; a `baseUrl` field can override it per connection. */
  baseUrl?: string;
  fields: ConnectorField[];
  /** How the credential travels: Authorization bearer, raw, or a named header. */
  style?: 'bearer' | 'raw' | 'header';
  header?: string;
  /** Request body encoding. Stripe, for one, only accepts form posts. */
  encoding?: 'json' | 'form';
  extraHeaders?: Record<string, string>;
  oauth?: { authorizeUrl: string; tokenUrl: string; scopes: string[] };
  /** Cheap request that proves the credential works. */
  probe?: { method?: 'GET' | 'POST'; path: string; body?: unknown };
  /** Dot path into the probe response for a human label (email, login, …). */
  accountPath?: string;
}

/** What the UI needs: the definition plus connection state, never raw secrets. */
export interface ConnectorInfo {
  definition: ConnectorDefinition;
  connected: boolean;
  account?: string;
  connectedAt?: number;
  lastCheck?: number;
  error?: string;
  /** Field keys that already have a value stored. */
  set: string[];
}

// --- studio ------------------------------------------------------------------

export type StudioClipKind = 'video' | 'image' | 'audio';

export interface StudioClip {
  id: string;
  /** Original file name, shown on the block. */
  name: string;
  /** /api/media/<name> — stable enough to persist in a project file. */
  url: string;
  kind: StudioClipKind;
  /** Seconds on the timeline where the clip begins. */
  start: number;
  /** Seconds trimmed from the head of the source. */
  in: number;
  /** Length on the timeline, in seconds. */
  duration: number;
  volume?: number;
  muted?: boolean;
}

export type StudioTrackKind = 'video' | 'overlay';

export interface StudioTrack {
  id: string;
  kind: StudioTrackKind;
  clips: StudioClip[];
}

export interface StudioProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  tracks: StudioTrack[];
  updatedAt: number;
}

export interface StudioMedia {
  name: string;
  kind: StudioClipKind;
  bytes: number;
  modified: number;
  url: string;
}

export interface ChatRequest {
  threadId: string;
  input: string;
  agentIds: string[];
  mode: RunMode;
  regenerate?: boolean;
  /** Vision input: data URIs ("data:image/png;base64,…."), capped by the server. */
  images?: string[];
}

// --- CLI crew ----------------------------------------------------------------

/** What a stage is allowed to do. `build` and `fix` may write. */
export type CliRole = 'scout' | 'build' | 'verify' | 'review' | 'fix';

export interface CliAdapterInfo {
  id: string;
  label: string;
  command: string;
  version?: string;
  available: boolean;
  capabilities: CliRole[];
  promptVia: 'stdin' | 'arg';
  install?: string;
  notes?: string;
  builtin: boolean;
  /** Why detection failed, when it did. */
  error?: string;
}

export type CliStageStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface CliStage {
  id: string;
  role: CliRole;
  adapterId: string;
  label: string;
  status: CliStageStatus;
  writes: boolean;
  dependsOn: string[];
  startedAt?: number;
  endedAt?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  /** Bounded tail of merged stdout/stderr, ANSI stripped. */
  output: string;
  error?: string;
}

export type CliCrewShape = 'solo' | 'pair' | 'crew';
export type CliRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface CliCrewRun {
  id: string;
  task: string;
  workspace: string;
  shape: CliCrewShape;
  status: CliRunStatus;
  createdAt: number;
  endedAt?: number;
  stages: CliStage[];
  adapterIds: string[];
  summary?: string;
  /** `git diff` captured after the last writing stage. */
  diff?: string;
  error?: string;
}

export type CliCrewEvent =
  | { type: 'run_start'; run: CliCrewRun }
  | { type: 'stage_start'; runId: string; stage: CliStage }
  | { type: 'chunk'; runId: string; stageId: string; text: string }
  | { type: 'stage_end'; runId: string; stage: CliStage }
  | { type: 'run_end'; run: CliCrewRun };

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'other';
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  available: boolean;
  releaseUrl?: string;
  notes?: string;
  publishedAt?: number;
  repo: string;
  assets: UpdateAsset[];
  checkedAt: number;
  error?: string;
}

export interface CliCrewRequest {
  task: string;
  workspace?: string;
  shape?: CliCrewShape;
  /** Role → adapter id. Missing roles use the first available adapter. */
  roles?: Partial<Record<CliRole, string>>;
  /** Run the optional fix stage after review. */
  fix?: boolean;
  /** Wall-clock budget for the whole run, milliseconds. */
  budgetMs?: number;
}

