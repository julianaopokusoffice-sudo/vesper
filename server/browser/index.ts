import { randomUUID } from 'node:crypto';
import type { BrowserLink, BrowserPage, BrowserState, BrowserTab } from '../../shared/types.ts';

/**
 * One real browser session, owned by the server so every surface sees the same
 * tabs: the desktop panel, the phone, the CLI and any agent that calls the
 * `browser_*` tools. Pages are fetched and reduced to readable text plus an
 * indexed link list. That is intentional: the model gets a stable, small view
 * of the page instead of a megabyte of markup, and the panel can render the
 * same snapshot in reader mode when a site refuses to be framed.
 *
 * A live Chromium view (Electron) still renders the actual page; this module is
 * the shared source of truth for navigation, history, cookies and reading.
 */

const MAX_TABS = 6;
const MAX_TEXT = 24_000;
const MAX_LINKS = 80;
const FETCH_TIMEOUT = 20_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Vesper/1.0';

interface Cookie {
  host: string;
  name: string;
  value: string;
  path: string;
}

interface TabRecord extends BrowserTab {
  cookies: Cookie[];
}

type Listener = (state: BrowserState) => void;

function blankTab(): TabRecord {
  const tab: TabRecord = {
    id: randomUUID(),
    title: 'New tab',
    url: '',
    history: [],
    historyIndex: -1,
    updatedAt: Date.now(),
    actor: 'user',
    cookies: [],
  };
  return tab;
}

class BrowserSession {
  private tabs: TabRecord[] = [];
  private activeId = '';
  private revision = 0;
  private listeners = new Set<Listener>();

  constructor() {
    const first = blankTab();
    this.tabs.push(first);
    this.activeId = first.id;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  state(): BrowserState {
    return structuredClone({
      tabs: this.tabs.map(({ cookies: _cookies, ...tab }) => tab),
      activeTabId: this.activeId,
      revision: this.revision,
    });
  }

  active(): TabRecord {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? this.tabs[0]!;
  }

  private bump(actor: 'user' | 'agent') {
    this.revision += 1;
    this.active().actor = actor;
    const snapshot = this.state();
    for (const listener of this.listeners) listener(snapshot);
  }

  createTab(url = '', actor: 'user' | 'agent' = 'user'): TabRecord {
    if (this.tabs.length >= MAX_TABS) throw new Error(`Browser has ${MAX_TABS} tabs open. Close one first.`);
    const tab = blankTab();
    tab.url = url;
    tab.actor = actor;
    this.tabs.push(tab);
    this.activeId = tab.id;
    this.bump(actor);
    return tab;
  }

  activateTab(id: string): BrowserState {
    if (!this.tabs.some((tab) => tab.id === id)) throw new Error('No such browser tab.');
    this.activeId = id;
    this.revision += 1;
    this.bump('user');
    return this.state();
  }

  closeTab(id: string): BrowserState {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return this.state();
    this.tabs.splice(index, 1);
    if (!this.tabs.length) this.tabs.push(blankTab());
    if (this.activeId === id) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]!.id;
    this.revision += 1;
    this.bump('user');
    return this.state();
  }

  /**
   * Fetch a page and make it current. A failed fetch still becomes the tab's
   * page (with `error`) so the panel can explain what happened instead of
   * silently keeping stale content.
   */
  async open(rawUrl: string, options: { tabId?: string; newTab?: boolean; actor?: 'user' | 'agent'; signal?: AbortSignal } = {}): Promise<{ state: BrowserState; tab: BrowserTab; page: BrowserPage }> {
    const actor = options.actor ?? 'user';
    const url = normalizeUrl(rawUrl);
    assertPublicUrl(url);
    let tab: TabRecord;
    if (options.newTab) tab = this.createTab(url, actor);
    else if (options.tabId) {
      const found = this.tabs.find((entry) => entry.id === options.tabId);
      if (!found) throw new Error('No such browser tab.');
      tab = found;
      this.activeId = tab.id;
    } else {
      tab = this.active();
    }

    tab.url = url;
    tab.title = tab.title === 'New tab' ? hostOf(url) : tab.title;
    tab.actor = actor;
    tab.updatedAt = Date.now();
    this.revision += 1;
    this.bump(actor);

    const page = await loadPage(url, tab, options.signal);
    tab.page = page;
    tab.title = page.title || hostOf(url);
    tab.url = page.url || url;
    tab.updatedAt = Date.now();
    tab.actor = actor;

    // Record where we actually landed (redirects included).
    if (tab.historyIndex < 0 || tab.history[tab.historyIndex] !== tab.url) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(tab.url);
      tab.historyIndex = tab.history.length - 1;
    }
    this.bump(actor);
    return { state: this.state(), tab: stripTab(tab), page };
  }

  async back(actor: 'user' | 'agent' = 'user'): Promise<{ state: BrowserState; tab: BrowserTab; page: BrowserPage }> {
    return this.move(-1, actor);
  }

  async forward(actor: 'user' | 'agent' = 'user'): Promise<{ state: BrowserState; tab: BrowserTab; page: BrowserPage }> {
    return this.move(1, actor);
  }

  private async move(step: -1 | 1, actor: 'user' | 'agent') {
    const tab = this.active();
    const next = tab.historyIndex + step;
    if (next < 0 || next >= tab.history.length) throw new Error(step < 0 ? 'No page behind this one.' : 'No page ahead of this one.');
    const url = tab.history[next]!;
    const page = await loadPage(url, tab);
    tab.historyIndex = next;
    tab.url = page.url || url;
    tab.title = page.title || hostOf(url);
    tab.actor = actor;
    tab.page = page;
    tab.updatedAt = Date.now();
    this.revision += 1;
    this.bump(actor);
    return { state: this.state(), tab: stripTab(tab), page };
  }

  async reload(actor: 'user' | 'agent' = 'user'): Promise<{ state: BrowserState; tab: BrowserTab; page: BrowserPage }> {
    const tab = this.active();
    if (!tab.url) throw new Error('This tab has no page open.');
    const page = await loadPage(tab.url, tab);
    tab.page = page;
    tab.title = page.title || hostOf(tab.url);
    tab.actor = actor;
    tab.updatedAt = Date.now();
    this.revision += 1;
    this.bump(actor);
    return { state: this.state(), tab: stripTab(tab), page };
  }

  async find(query: string): Promise<string> {
    const tab = this.active();
    const page = requirePage(tab);
    const needle = query.trim().toLowerCase();
    if (!needle) throw new Error('Give browser_find a word or phrase to look for.');
    const haystack = page.text.toLowerCase();
    const hits: string[] = [];
    let at = haystack.indexOf(needle);
    while (at !== -1 && hits.length < 8) {
      const start = Math.max(0, at - 90);
      const end = Math.min(page.text.length, at + needle.length + 90);
      hits.push(`…${page.text.slice(start, end).replace(/\s+/g, ' ').trim()}…`);
      at = haystack.indexOf(needle, at + needle.length);
    }
    if (!hits.length) return `“${query}” is not on ${page.title} (${page.url}).`;
    return `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${query}”:\n\n${hits.join('\n\n')}`;
  }

  links(): BrowserLink[] {
    return requirePage(this.active()).links;
  }

  page(): BrowserPage {
    return requirePage(this.active());
  }

  async click(target: string | number): Promise<{ state: BrowserState; tab: BrowserTab; page: BrowserPage }> {
    const tab = this.active();
    const page = requirePage(tab);
    const link =
      typeof target === 'number'
        ? page.links.find((entry) => entry.index === target)
        : page.links.find((entry) => entry.text.toLowerCase() === String(target).toLowerCase()) ??
          page.links.find((entry) => entry.text.toLowerCase().includes(String(target).toLowerCase())) ??
          page.links.find((entry) => entry.url === String(target));
    if (!link) {
      throw new Error(`No link ${typeof target === 'number' ? `#${target}` : `matching “${target}”`} on this page. Call browser_links first.`);
    }
    return this.open(link.url, { actor: 'agent' });
  }
}

function stripTab(tab: TabRecord): BrowserTab {
  const { cookies: _cookies, ...rest } = tab;
  return structuredClone(rest);
}

function requirePage(tab: TabRecord): BrowserPage {
  if (!tab.page) throw new Error('No page is open in the browser. Call browser_open with a URL first.');
  if (tab.page.error) throw new Error(`The current page could not be read: ${tab.page.error}`);
  return tab.page;
}

// --- URL safety ---------------------------------------------------------------

export function normalizeUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new Error('Give the browser a URL.');
  let candidate = trimmed;
  const hasWebScheme = /^https?:\/\//i.test(candidate);
  const otherScheme = /^(mailto|tel|data|javascript|file|ftp|ws|wss):/i.test(candidate);
  if (!hasWebScheme && !otherScheme) {
    const looksLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)(:|\/|$)/i.test(candidate);
    candidate = `${looksLocal ? 'http' : 'https'}://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`That is not a valid URL: ${trimmed}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('The browser only opens http and https URLs.');
  return url.href;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Reader requests must not become an SSRF pivot into the user's LAN. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.endsWith('.internal') || h.endsWith('.local') || h === 'metadata.google.internal') return true;
  return false;
}

export function assertPublicUrl(raw: string): void {
  const url = new URL(raw);
  if (isPrivateHost(url.hostname) && process.env.VESPER_BROWSER_ALLOW_PRIVATE !== '1') {
    throw new Error(
      'The reader cannot fetch private or loopback addresses. Use Live mode for local pages, or set VESPER_BROWSER_ALLOW_PRIVATE=1 if you understand the SSRF risk.',
    );
  }
}

// --- fetching + extraction ----------------------------------------------------

async function loadPage(url: string, tab: TabRecord, signal?: AbortSignal): Promise<BrowserPage> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
        cookie: cookieHeader(tab, url),
      },
    });
    rememberCookies(tab, res, res.url || url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const finalUrl = res.url || url;
    const contentType = res.headers.get('content-type') ?? '';
    const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim() ?? 'utf-8';
    let body: string;
    try {
      body = new TextDecoder(charset).decode(buffer);
    } catch {
      body = buffer.toString('utf8');
    }

    if (!res.ok) {
      return failedPage(finalUrl, `HTTP ${res.status} ${res.statusText}`.trim(), res.status, contentType, started);
    }

    if (contentType.includes('html') || /^\s*</.test(body.slice(0, 200))) {
      return { ...extractPage(body, finalUrl), status: res.status, contentType, fetchedAt: started };
    }
    if (contentType.includes('json')) {
      const pretty = (() => {
        try {
          return JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          return body;
        }
      })();
      return {
        url: finalUrl,
        title: new URL(finalUrl).pathname || hostOf(finalUrl),
        site: hostOf(finalUrl),
        text: pretty.slice(0, MAX_TEXT),
        links: [],
        status: res.status,
        contentType,
        fetchedAt: started,
      };
    }
    if (contentType.startsWith('image/')) {
      return {
        url: finalUrl,
        title: `Image · ${new URL(finalUrl).pathname.split('/').pop() ?? hostOf(finalUrl)}`,
        site: hostOf(finalUrl),
        text: `This URL is an image (${contentType}). The agent cannot see raster pixels through the reader; the panel can display it in Live mode.`,
        links: [],
        status: res.status,
        contentType,
        fetchedAt: started,
      };
    }
    return {
      url: finalUrl,
      title: new URL(finalUrl).pathname.split('/').pop() || hostOf(finalUrl),
      site: hostOf(finalUrl),
      text: body.slice(0, MAX_TEXT),
      links: [],
      status: res.status,
      contentType,
      fetchedAt: started,
    };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? `Timed out after ${FETCH_TIMEOUT / 1000}s` : err instanceof Error ? err.message : String(err);
    return failedPage(url, message, 0, '', started);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function failedPage(url: string, error: string, status: number, contentType: string, fetchedAt: number): BrowserPage {
  return {
    url,
    title: hostOf(url),
    site: hostOf(url),
    text: `This page could not be read.\n\n${error}\n\nIf it is a local development server or an app that requires JavaScript, use Live mode.`,
    links: [],
    status,
    contentType,
    fetchedAt,
    error,
  };
}

function cookieHeader(tab: TabRecord, url: string): string {
  const host = new URL(url).hostname;
  const path = new URL(url).pathname || '/';
  return tab.cookies
    .filter((cookie) => host === cookie.host || host.endsWith(`.${cookie.host}`))
    .filter((cookie) => path.startsWith(cookie.path))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function rememberCookies(tab: TabRecord, res: Response, url: string) {
  const host = new URL(url).hostname;
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : splitSetCookie(res.headers.get('set-cookie') ?? '');
  for (const raw of list) {
    const [pair, ...attrs] = raw.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domain = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a))?.slice(7).replace(/^\./, '');
    const path = attrs.map((a) => a.trim()).find((a) => /^path=/i.test(a))?.slice(5) || '/';
    const cookieHost = domain || host;
    tab.cookies = tab.cookies.filter((cookie) => !(cookie.host === cookieHost && cookie.name === name && cookie.path === path));
    tab.cookies.push({ host: cookieHost, name, value, path });
    if (tab.cookies.length > 120) tab.cookies.splice(0, tab.cookies.length - 120);
  }
}

/** Node normally has getSetCookie; this is a conservative fallback. */
function splitSetCookie(header: string): string[] {
  if (!header) return [];
  const parts: string[] = [];
  let current = '';
  let inExpires = false;
  for (const chunk of header.split(/,(?=[^;]+=[^;]+)/)) {
    if (/^\s*expires=/i.test(chunk) || inExpires) {
      current += `,${chunk}`;
      inExpires = !/;/.test(chunk) || /^\s*expires=/i.test(chunk);
    } else {
      if (current) parts.push(current);
      current = chunk;
    }
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function extractPage(html: string, pageUrl: string): Omit<BrowserPage, 'status' | 'contentType' | 'fetchedAt'> {
  const base = /<base\b[^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  let baseUrl = pageUrl;
  if (base) {
    try {
      baseUrl = new URL(decodeEntities(base), pageUrl).href;
    } catch {
      /* bad base tag */
    }
  }

  const title =
    metaContent(html, 'og:title') ||
    decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() ||
    hostOf(pageUrl);
  const description =
    metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description') || undefined;

  const links: BrowserLink[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorRe.exec(html)) && links.length < MAX_LINKS) {
    const attrs = anchor[1] ?? '';
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawHref = href?.[1] ?? href?.[2] ?? href?.[3] ?? '';
    if (!rawHref || /^(#|javascript:|mailto:|tel:|data:)/i.test(rawHref.trim())) continue;
    let url: string;
    try {
      url = new URL(decodeEntities(rawHref.trim()), baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const text = stripTags(anchor[2] ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(url);
    links.push({ index: links.length + 1, text: text.slice(0, 160), url });
  }

  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  const text = stripTags(
    withoutNoise
      .replace(/<h([1-6])\b[^>]*>/gi, '\n\n')
      .replace(/<\/(h[1-6]|p|div|section|article|header|main|ul|ol|table|blockquote)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n\n'),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);

  // Only claim the page is a JavaScript shell when there is almost nothing to
  // read. A short static page plus an analytics <script> is not a shell.
  const jsShell =
    text.length < 140 && links.length === 0 && /(<div[^>]+id=["'](root|app|__next|__nuxt)["']|<script[^>]+src=)/i.test(html)
      ? '\n\nThe reader extracted almost no text — this page may render entirely with JavaScript. Switch the panel to Live mode to interact with it.'
      : '';

  return {
    url: pageUrl,
    title: title || hostOf(pageUrl),
    description,
    site: hostOf(pageUrl),
    text: `${text}${jsShell}`.trim(),
    links,
  };
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"');
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["']`, 'i');
  const found = re.exec(html)?.[1] ?? alt.exec(html)?.[1];
  return found ? decodeEntities(found).replace(/\s+/g, ' ').trim() : undefined;
}

// --- singleton -----------------------------------------------------------------

let session: BrowserSession | null = null;

export function browser(): BrowserSession {
  session ??= new BrowserSession();
  return session;
}

/** Used by tests to start from a clean session. */
export function resetBrowser(): BrowserState {
  session = new BrowserSession();
  return session.state();
}

export type { BrowserSession };
