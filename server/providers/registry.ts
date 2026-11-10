import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import { open as unseal, seal } from '../kernel/secrets.ts';
import { costFor } from './pricing.ts';
import { runAnthropic } from './anthropic.ts';
import { runOpenAI } from './openai.ts';
import { runDemo } from './demo.ts';
import type { ProviderId, ProviderInfo } from '../../shared/types.ts';
import type { ProviderCredentials, ProviderRequest, ProviderResponse } from './types.ts';

interface Stored {
  baseURL?: string;
  apiKey?: string; // sealed
  models?: string[];
}

interface ConfigFile {
  version: 1;
  providers: Partial<Record<ProviderId, Stored>>;
  defaultModel?: { provider: ProviderId; id: string };
}

const DEFAULTS: Record<ProviderId, Omit<ProviderInfo, 'hasKey' | 'configured'>> = {
  demo: {
    id: 'demo',
    label: 'Offline demo',
    kind: 'demo',
    baseURL: '',
    models: ['vesper-demo-1'],
    local: true,
    docs: 'A deterministic local model so the interface works with zero setup.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o4-mini'],
    local: false,
    keyHint: 'sk-…',
    docs: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    local: false,
    keyHint: 'sk-ant-…',
    docs: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    kind: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    local: false,
    keyHint: 'AIza…',
    docs: 'https://aistudio.google.com/apikey',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseURL: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'magistral-medium-latest', 'codestral-latest'],
    local: false,
    keyHint: '…',
    docs: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    local: false,
    keyHint: 'sk-…',
    docs: 'https://platform.deepseek.com/api_keys',
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    kind: 'openai',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    local: false,
    keyHint: 'xai-…',
    docs: 'https://console.x.ai',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b'],
    local: false,
    keyHint: 'gsk_…',
    docs: 'https://console.groq.com/keys',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseURL: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'],
    local: false,
    keyHint: '…',
    docs: 'https://api.together.ai/settings/api-keys',
  },
  fireworks: {
    id: 'fireworks',
    label: 'Fireworks',
    kind: 'openai',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/llama-v3p3-70b-instruct'],
    local: false,
    keyHint: 'fw_…',
    docs: 'https://fireworks.ai/account/api-keys',
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai',
    baseURL: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'qwen-3-32b'],
    local: false,
    keyHint: 'csk-…',
    docs: 'https://cloud.cerebras.ai',
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    kind: 'openai',
    baseURL: 'https://api.perplexity.ai',
    models: ['sonar-pro', 'sonar', 'sonar-reasoning-pro'],
    local: false,
    keyHint: 'pplx-…',
    docs: 'https://www.perplexity.ai/settings/api',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat', 'qwen/qwen3-235b-a22b'],
    local: false,
    keyHint: 'sk-or-…',
    docs: 'https://openrouter.ai/keys',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseURL: 'http://localhost:11434/v1',
    models: ['qwen3', 'llama3.2', 'deepseek-r1', 'mistral-small3.2'],
    local: true,
    docs: 'https://ollama.com/download',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai',
    baseURL: 'http://localhost:1234/v1',
    models: ['local-model'],
    local: true,
    docs: 'https://lmstudio.ai',
  },
  llamacpp: {
    id: 'llamacpp',
    label: 'llama.cpp server (local)',
    kind: 'openai',
    baseURL: 'http://localhost:8080/v1',
    models: ['local-model'],
    local: true,
    docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
  },
  custom: {
    id: 'custom',
    label: 'Custom endpoint',
    kind: 'openai',
    baseURL: '',
    models: [],
    local: true,
    docs: 'Any OpenAI-compatible endpoint: vLLM, LiteLLM, LocalAI, a company gateway.',
  },
};

let cache: ConfigFile | null = null;

function load(): ConfigFile {
  if (cache) return cache;
  if (!existsSync(PATHS.config)) {
    cache = { version: 1, providers: {}, defaultModel: { provider: 'demo', id: 'vesper-demo-1' } };
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(PATHS.config, 'utf8')) as ConfigFile;
    cache = { version: 1, providers: parsed.providers ?? {}, defaultModel: parsed.defaultModel };
  } catch {
    cache = { version: 1, providers: {} };
  }
  return cache;
}

function persist(next: ConfigFile) {
  cache = next;
  mkdirSync(dirname(PATHS.config), { recursive: true, mode: 0o700 });
  const tmp = `${PATHS.config}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, PATHS.config);
}

export function providerInfos(): ProviderInfo[] {
  const cfg = load();
  return (Object.keys(DEFAULTS) as ProviderId[]).map((id) => {
    const def = DEFAULTS[id];
    const stored = cfg.providers[id] ?? {};
    const apiKey = stored.apiKey ? unseal(stored.apiKey) : '';
    return {
      ...def,
      baseURL: stored.baseURL ?? def.baseURL,
      models: stored.models?.length ? stored.models : def.models,
      hasKey: !!apiKey,
      configured: !!apiKey || def.local || setByUser(stored),
    };
  });
}

function setByUser(stored: Stored) {
  return !!(stored.baseURL || stored.models?.length);
}

export function updateProvider(id: ProviderId, patch: { apiKey?: string; baseURL?: string; models?: string[] }) {
  const cfg = load();
  const current = cfg.providers[id] ?? {};
  const next: Stored = { ...current };
  if (patch.apiKey !== undefined) next.apiKey = patch.apiKey ? seal(patch.apiKey) : undefined;
  if (patch.baseURL !== undefined) next.baseURL = patch.baseURL.trim() || undefined;
  if (patch.models !== undefined) next.models = patch.models.map((m) => m.trim()).filter(Boolean);
  persist({ ...cfg, providers: { ...cfg.providers, [id]: next } });
  return providerInfos();
}

export function resolve(id: ProviderId): ProviderCredentials {
  const info = providerInfos().find((p) => p.id === id);
  if (!info) throw new Error(`Unknown provider "${id}"`);
  const stored = load().providers[id];
  const apiKey = stored?.apiKey ? unseal(stored.apiKey) : '';
  if (!apiKey && !info.local && !info.baseURL.includes('localhost')) {
    throw new Error(`${info.label} needs an API key. Add one in Settings → Providers.`);
  }
  return { baseURL: info.baseURL, apiKey, info };
}

export function hasAnyKey(): boolean {
  return providerInfos().some((p) => p.hasKey);
}

export async function streamProvider(cred: ProviderCredentials, req: ProviderRequest): Promise<ProviderResponse> {
  const started = Date.now();
  const result =
    cred.info.kind === 'anthropic'
      ? await runAnthropic(cred, req)
      : cred.info.kind === 'demo'
        ? await runDemo(cred, req)
        : await runOpenAI(cred, req);
  const ms = Date.now() - started;
  result.usage = {
    ...result.usage,
    ms,
    costUSD: result.usage.costUSD ?? costFor(req.model, result.usage.promptTokens, result.usage.completionTokens),
  };
  return result;
}

export function providerMeta(id: ProviderId): ProviderInfo {
  const found = providerInfos().find((p) => p.id === id);
  if (!found) throw new Error(`Unknown provider "${id}"`);
  return found;
}
