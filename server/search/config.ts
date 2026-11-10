import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import { open as unseal, seal } from '../kernel/secrets.ts';

/**
 * Web search backends.
 *
 * The app ships with keyless DuckDuckGo HTML search so the tool works on first
 * run, but that endpoint is rate-limited and has no snippets. A researcher who
 * searches all day should put a key in Settings → Web search; the key is sealed
 * with the same AES-256-GCM envelope as provider keys and never returned.
 *
 * Each backend normalises to the same three-line result shape, because the
 * agent prompt, the sources panel and the parser all depend on it.
 */

export type SearchProviderId = 'duckduckgo' | 'tavily' | 'brave' | 'serper' | 'exa';

export interface SearchProviderInfo {
  id: SearchProviderId;
  label: string;
  keyless?: boolean;
  hasKey: boolean;
  docs: string;
  note: string;
  keyHint?: string;
}

const PROVIDERS: Omit<SearchProviderInfo, 'hasKey'>[] = [
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo (keyless)',
    keyless: true,
    docs: 'https://duckduckgo.com',
    note: 'No key, no account. Titles and URLs only, rate-limited — fine for occasional lookups.',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    docs: 'https://app.tavily.com/home',
    note: 'Built for agents: returns page extracts, not just links. Free tier covers daily use.',
    keyHint: 'tvly-…',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    docs: 'https://api-dashboard.search.brave.com/app/keys',
    note: 'Independent index, generous free tier, good for anything Google is biased on.',
    keyHint: 'BSA…',
  },
  {
    id: 'serper',
    label: 'Serper (Google)',
    docs: 'https://serper.dev/api-key',
    note: 'Google results through an API. Best coverage; 2,500 free queries to start.',
    keyHint: '…',
  },
  {
    id: 'exa',
    label: 'Exa',
    docs: 'https://dashboard.exa.ai/api-keys',
    note: 'Semantic search over the web — strong for “papers like this” and technical reading.',
    keyHint: 'exa-…',
  },
];

const IDS = PROVIDERS.map((provider) => provider.id);

interface Stored {
  active: SearchProviderId;
  keys: Partial<Record<SearchProviderId, string>>;
}

interface ConfigFile {
  version: 1;
  active: SearchProviderId;
  keys: Partial<Record<SearchProviderId, string>>;
}

const FILE = join(PATHS.home, 'search.json');
let cache: ConfigFile | null = null;

function load(): ConfigFile {
  if (cache) return cache;
  if (!existsSync(FILE)) {
    // An environment key is a sensible first-run default; the UI can override it.
    const envTavily = process.env.TAVILY_API_KEY?.trim();
    cache = { version: 1, active: envTavily ? 'tavily' : 'duckduckgo', keys: envTavily ? { tavily: seal(envTavily) } : {} };
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<ConfigFile>;
    cache = {
      version: 1,
      active: IDS.includes(parsed.active as SearchProviderId) ? (parsed.active as SearchProviderId) : 'duckduckgo',
      keys: parsed.keys ?? {},
    };
  } catch {
    cache = { version: 1, active: 'duckduckgo', keys: {} };
  }
  return cache;
}

function persist(next: ConfigFile) {
  cache = next;
  mkdirSync(dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
}

export function searchConfig(): { active: SearchProviderId; providers: SearchProviderInfo[] } {
  const cfg = load();
  const envTavily = !!process.env.TAVILY_API_KEY?.trim();
  return {
    active: cfg.active,
    providers: PROVIDERS.map((provider) => ({
      ...provider,
      hasKey: provider.keyless ? true : !!(cfg.keys[provider.id] || (provider.id === 'tavily' && envTavily)),
    })),
  };
}

/** Keys are write-only: sending a new one replaces it, `clear` removes it. */
export function saveSearchConfig(input: { provider?: string; key?: string; clear?: boolean }): { active: SearchProviderId } {
  const cfg = load();
  const provider = IDS.includes(input.provider as SearchProviderId) ? (input.provider as SearchProviderId) : cfg.active;
  const keys = { ...cfg.keys };
  if (input.clear) delete keys[provider];
  else if (input.key?.trim()) keys[provider] = seal(input.key.trim());
  const active = provider === 'duckduckgo' || keys[provider] || (provider === 'tavily' && process.env.TAVILY_API_KEY) ? provider : cfg.active;
  persist({ version: 1, active, keys });
  return { active };
}

function keyFor(provider: SearchProviderId): string {
  const cfg = load();
  if (provider === 'tavily' && !cfg.keys.tavily && process.env.TAVILY_API_KEY) return process.env.TAVILY_API_KEY;
  const sealed = cfg.keys[provider];
  return sealed ? unseal(sealed) : '';
}

export function activeSearchProvider(): SearchProviderId {
  const cfg = load();
  if (cfg.active === 'duckduckgo') return 'duckduckgo';
  return keyFor(cfg.active) ? cfg.active : 'duckduckgo';
}

// --- search ------------------------------------------------------------------

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Search the web with the configured backend. Throws with a fixable message
 * when a key is missing or rejected, because the agent reads the error and can
 * tell the user exactly which setting to open.
 */
export async function webSearch(query: string, limit: number, signal: AbortSignal): Promise<string> {
  const provider = activeSearchProvider();
  let hits: SearchHit[] = [];
  if (provider === 'duckduckgo') return duckduckgo(query, limit, signal);
  try {
    hits = await runProvider(provider, query, limit, signal);
  } catch (err) {
    throw new Error(
      `${provider} search failed: ${err instanceof Error ? err.message : String(err)}. Check the key in Settings → Web search, or switch the backend to DuckDuckGo (keyless).`,
    );
  }
  if (!hits.length) return 'No results.';
  return hits
    .slice(0, limit)
    .map((hit) => `- ${hit.title}\n  ${hit.url}${hit.snippet ? `\n  ${hit.snippet.replace(/\s+/g, ' ').slice(0, 320)}` : ''}`)
    .join('\n');
}

async function runProvider(provider: SearchProviderId, query: string, limit: number, signal: AbortSignal): Promise<SearchHit[]> {
  const key = keyFor(provider);
  if (!key) throw new Error('no API key configured');
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);

  switch (provider) {
    case 'tavily': {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: key, query, max_results: limit, search_depth: 'basic', include_answer: false }),
        signal: timeout,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      return (json.results ?? []).map((row: any) => ({
        title: String(row.title ?? row.url ?? ''),
        url: String(row.url ?? ''),
        snippet: row.content ? String(row.content) : undefined,
      }));
    }
    case 'brave': {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`,
        {
          headers: { accept: 'application/json', 'x-subscription-token': key },
          signal: timeout,
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      return (json.web?.results ?? []).map((row: any) => ({
        title: String(row.title ?? ''),
        url: String(row.url ?? ''),
        snippet: row.description ? String(row.description).replace(/<[^>]+>/g, '') : undefined,
      }));
    }
    case 'serper': {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
        signal: timeout,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      return (json.organic ?? []).map((row: any) => ({
        title: String(row.title ?? ''),
        url: String(row.link ?? ''),
        snippet: row.snippet ? String(row.snippet) : undefined,
      }));
    }
    case 'exa': {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query, numResults: Math.min(limit, 20), contents: { text: { maxCharacters: 320 } } }),
        signal: timeout,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      return (json.results ?? []).map((row: any) => ({
        title: String(row.title ?? row.url ?? ''),
        url: String(row.url ?? ''),
        snippet: row.text ? String(row.text) : undefined,
      }));
    }
    default:
      return [];
  }
}

async function duckduckgo(query: string, limit: number, signal: AbortSignal): Promise<string> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Vesper/1.0; +https://github.com/vesper-agents/vesper)',
      accept: 'text/html',
    },
  });
  if (!response.ok) {
    return `Search failed (HTTP ${response.status}). Add a search API key in Settings → Web search for reliable results, or ask the user to paste the source.`;
  }
  const html = await response.text();
  const results: string[] = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && results.length < limit) {
    const rawUrl = decodeURIComponent(match[1]!.replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ''));
    const url = rawUrl.startsWith('http') ? rawUrl.split('&rut=')[0]! : `https:${rawUrl}`;
    const title = match[2]!.replace(/<[^>]+>/g, '').trim();
    if (title && url.startsWith('http')) results.push(`- ${title}\n  ${url}`);
  }
  return results.length
    ? `${results.join('\n')}\n\n(keyless search — no snippets; use fetch_url to read a result, or add a key in Settings → Web search)`
    : 'No results parsed. The keyless endpoint may be rate-limiting; add a search key in Settings → Web search.';
}
