import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Globe2,
  Link2,
  Loader2,
  Plus,
  Radio,
  RotateCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type { BrowserPage, BrowserTab } from '@shared/types';
import { useStore } from '@/lib/store';
import { cn, Tooltip } from './ui';

/**
 * A real browser for the console. The server owns the session, so an agent's
 * navigation appears here while it works. Reader mode is the honest default:
 * it survives X-Frame-Options and gives the model the same text the user sees.
 * Live mode renders the actual page (Electron webview, iframe elsewhere).
 */
export function BrowserView() {
  const browser = useStore((s) => s.browser);
  const busy = useStore((s) => s.browserBusy);
  const openBrowser = useStore((s) => s.openBrowser);
  const refresh = useStore((s) => s.refreshBrowser);
  const action = useStore((s) => s.browserAction);
  const newTab = useStore((s) => s.newBrowserTab);
  const selectTab = useStore((s) => s.selectBrowserTab);
  const closeTab = useStore((s) => s.closeBrowserTab);
  const [mode, setMode] = useState<'reader' | 'live'>('reader');
  const [address, setAddress] = useState('');
  const [liveUrl, setLiveUrl] = useState('');
  const addressRef = useRef<HTMLInputElement>(null);
  const lastTab = useRef('');

  const tab = useMemo(
    () => browser?.tabs.find((entry) => entry.id === browser.activeTabId) ?? browser?.tabs[0],
    [browser],
  );
  const page = tab?.page;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the address bar in step with the shared session, including agent moves.
  useEffect(() => {
    if (!tab) return;
    if (tab.id !== lastTab.current || mode === 'reader') {
      setAddress(tab.url);
      if (tab.id !== lastTab.current) {
        setLiveUrl(tab.url);
        lastTab.current = tab.id;
      }
    }
    if (tab.actor === 'agent') {
      setAddress(tab.url);
      setLiveUrl(tab.url);
    }
  }, [tab?.id, tab?.url, tab?.actor, mode, tab]);

  const navigate = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setAddress(value);
    setLiveUrl(toLiveUrl(value));
    if (mode === 'reader') {
      await openBrowser(value);
      return;
    }
    // Live pages are rendered by Chromium, so a reader fetch is unnecessary —
    // but record the URL with the session when it is publicly readable.
    try {
      await openBrowser(value);
    } catch {
      /* local and private pages are allowed in Live mode only */
    }
  };

  const focusAddress = () => {
    addressRef.current?.focus();
    addressRef.current?.select();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        focusAddress();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const switchMode = async (next: 'reader' | 'live') => {
    setMode(next);
    if (next === 'live') {
      setLiveUrl(toLiveUrl(address || tab?.url || ''));
    } else if (address) {
      await openBrowser(address);
    }
  };

  return (
    <div className="relative z-10 flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <Globe2 size={14} className="text-accent" />
        <span className="text-[12.5px] font-medium text-fg">Browser</span>
        <span className="hidden items-center gap-1 rounded-full border border-line-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-faint sm:flex">
          <Sparkles size={8} className="text-accent/80" /> shared with agents
        </span>
        <div className="flex-1" />
        <Tooltip text="Open this page in your system browser">
          <button
            onClick={() => openExternal(address || tab?.url || '')}
            disabled={!address && !tab?.url}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-fg disabled:opacity-30"
            aria-label="Open in system browser"
          >
            <ExternalLink size={13} />
          </button>
        </Tooltip>
        <div className="flex rounded-md border border-line p-0.5">
          <ModeButton active={mode === 'reader'} onClick={() => void switchMode('reader')} icon={BookOpen} label="Reader" />
          <ModeButton active={mode === 'live'} onClick={() => void switchMode('live')} icon={Radio} label="Live" />
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-line-soft px-2 py-1.5">
        <Tooltip text="Back">
          <IconButton onClick={() => void action('back')} label="Back">
            <ArrowLeft size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Forward">
          <IconButton onClick={() => void action('forward')} label="Forward">
            <ArrowRight size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip text="Reload">
          <IconButton onClick={() => (mode === 'live' ? setLiveUrl((value) => value) : void action('reload'))} label="Reload">
            <RotateCw size={13} />
          </IconButton>
        </Tooltip>

        <form
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-ink-950/70 px-2 focus-within:border-line-strong"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(address);
          }}
        >
          {busy ? <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> : <Search size={12} className="shrink-0 text-faint" />}
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder="Paste a URL, or type a domain"
            aria-label="Address"
            className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-fg placeholder:text-faint/70 focus:outline-none"
          />
          {address && (
            <button
              type="button"
              onClick={() => {
                setAddress('');
                addressRef.current?.focus();
              }}
              className="text-faint hover:text-fg"
              aria-label="Clear address"
            >
              <X size={12} />
            </button>
          )}
        </form>

        <Tooltip text="New tab">
          <IconButton onClick={() => void newTab()} label="New tab">
            <Plus size={14} />
          </IconButton>
        </Tooltip>
      </div>

      <TabStrip
        tabs={browser?.tabs ?? []}
        activeId={browser?.activeTabId ?? ''}
        onSelect={(id) => void selectTab(id)}
        onClose={(id) => void closeTab(id)}
        onNew={() => void newTab()}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!tab?.url && !page ? (
          <BrowserStart onOpen={(url) => void navigate(url)} onLive={(url) => {
            setMode('live');
            setLiveUrl(toLiveUrl(url));
            setAddress(url);
          }} />
        ) : mode === 'live' ? (
          <LiveFrame url={liveUrl || tab?.url || ''} onNavigated={(url) => setAddress(url)} />
        ) : (
          <Reader
            page={page}
            url={tab?.url ?? ''}
            onLink={(url) => void navigate(url)}
            onLive={() => void switchMode('live')}
          />
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-line-soft px-3 font-mono text-[9px] uppercase tracking-wider text-faint/80">
        <span className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', tab?.page?.error ? 'bg-danger' : tab?.page ? 'bg-ok' : 'bg-faint/50')} />
          {tab?.page?.error ? 'read failed' : tab?.page ? 'reader snapshot' : 'idle'}
        </span>
        <span className="hidden truncate sm:inline">{tab?.page?.site}</span>
        <div className="flex-1" />
        <span>{mode === 'live' ? 'live · Chromium' : 'text · server-side'}</span>
      </footer>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BookOpen;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors',
        active ? 'bg-ink-800 text-fg' : 'text-faint hover:text-fg-2',
      )}
    >
      <Icon size={10} />
      {label}
    </button>
  );
}

function IconButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-fg"
    >
      {children}
    </button>
  );
}

function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BrowserTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line-soft bg-ink-950/30 px-2 py-1">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            'group flex max-w-[190px] shrink-0 items-center gap-1 rounded-md border px-2 py-1',
            tab.id === activeId ? 'border-line bg-ink-850 text-fg' : 'border-transparent text-faint hover:bg-white/[0.03] hover:text-fg-2',
          )}
        >
          <button onClick={() => onSelect(tab.id)} className="min-w-0 flex-1 truncate text-left text-[10.5px]">
            {tab.title || tab.url || 'New tab'}
          </button>
          <button onClick={() => onClose(tab.id)} aria-label="Close tab" className="opacity-40 hover:text-danger group-hover:opacity-100">
            <X size={10} />
          </button>
        </div>
      ))}
      <button onClick={onNew} aria-label="New tab" className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-white/[0.05] hover:text-fg">
        <Plus size={11} />
      </button>
    </div>
  );
}

function Reader({
  page,
  url,
  onLink,
  onLive,
}: {
  page?: BrowserPage;
  url: string;
  onLink: (url: string) => void;
  onLive: () => void;
}) {
  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 size={18} className="animate-spin text-accent" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-faint">reading {url}</p>
      </div>
    );
  }

  if (page.error) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col items-start justify-center gap-3 px-6">
        <ShieldAlert size={20} className="text-danger" />
        <h2 className="font-serif text-[26px] leading-tight text-fg">The reader could not open this page.</h2>
        <p className="text-[12.5px] leading-relaxed text-muted">{page.error}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={onLive} className="rounded-md border border-accent/30 bg-accent/[0.07] px-3 py-1.5 text-[11.5px] text-accent hover:bg-accent/[0.12]">
            Try Live mode
          </button>
          <button onClick={() => openExternal(page.url)} className="rounded-md border border-line px-3 py-1.5 text-[11.5px] text-fg-2 hover:border-line-strong">
            Open in system browser
          </button>
        </div>
        <p className="font-mono text-[9.5px] uppercase tracking-wider text-faint/70">{page.url}</p>
      </div>
    );
  }

  const paragraphs = page.text.split(/\n{2,}/).filter(Boolean).slice(0, 120);

  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto max-w-[64ch] px-5 py-7 sm:px-8">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-faint">
          <span className="rounded border border-line-soft px-1.5 py-0.5 text-accent/80">{page.site}</span>
          <span>{page.status ? `http ${page.status}` : ''}</span>
          <span>·</span>
          <span>{new Date(page.fetchedAt).toLocaleTimeString()}</span>
        </div>
        <h1 className="mt-3 font-serif text-[30px] leading-[1.12] tracking-[-0.015em] text-fg">{page.title}</h1>
        {page.description && <p className="mt-2 text-[13px] leading-relaxed text-muted">{page.description}</p>}
        <div className="mt-5 h-px bg-line-soft" />
        <div className="mt-5 space-y-3.5">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap text-[13.5px] leading-[1.7] text-fg-2/90">
              {paragraph}
            </p>
          ))}
        </div>

        {page.links.length > 0 && (
          <section className="mt-8 border-t border-line-soft pt-4">
            <div className="flex items-center gap-1.5">
              <Link2 size={11} className="text-accent/70" />
              <h2 className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-faint">links on this page</h2>
              <span className="font-mono text-[9px] text-faint/60">{page.links.length}</span>
            </div>
            <ol className="mt-2 divide-y divide-line-soft/60">
              {page.links.slice(0, 40).map((link) => (
                <li key={link.index}>
                  <button
                    onClick={() => onLink(link.url)}
                    className="group flex w-full items-baseline gap-2 py-1.5 text-left hover:text-accent"
                  >
                    <span className="w-5 shrink-0 font-mono text-[9px] text-faint/60">{link.index}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-2 group-hover:text-accent">{link.text}</span>
                    <span className="hidden max-w-[38%] shrink-0 truncate font-mono text-[9px] text-faint/60 sm:block">{hostOf(link.url)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </div>
  );
}

function BrowserStart({ onOpen, onLive }: { onOpen: (url: string) => void; onLive: (url: string) => void }) {
  const pages = [
    { title: 'Hacker News', url: 'https://news.ycombinator.com', note: 'what shipped today' },
    { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', note: 'start from the source' },
    { title: 'MDN Web Docs', url: 'https://developer.mozilla.org', note: 'the reference' },
    { title: 'GitHub Trending', url: 'https://github.com/trending', note: 'what people are building' },
  ];
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center px-6 py-10">
      <Globe2 size={26} className="text-accent/80" />
      <h2 className="mt-4 font-serif text-[30px] leading-tight text-fg">The web, inside the console.</h2>
      <p className="mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
        Vesper reads pages server-side, keeps the history, and shares the session with its agents. Live mode renders the
        actual page; Reader mode works even when a site refuses to be framed.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {pages.map((page) => (
          <button
            key={page.url}
            onClick={() => onOpen(page.url)}
            className="group flex items-center justify-between gap-3 rounded-lg border border-line-soft bg-ink-950/30 px-3 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent/[0.04]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] text-fg-2 group-hover:text-fg">{page.title}</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-wider text-faint">{page.note}</span>
            </span>
            <ArrowRight size={12} className="shrink-0 text-faint group-hover:text-accent" />
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3 font-mono text-[9px] uppercase tracking-wider text-faint/70">
        <button onClick={() => onLive('http://localhost:3000')} className="hover:text-accent">
          localhost:3000 → live
        </button>
        <span>·</span>
        <span>⌘L focuses the address</span>
      </div>
    </div>
  );
}

function LiveFrame({ url, onNavigated }: { url: string; onNavigated: (url: string) => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const isDesktop = typeof window !== 'undefined' && !!window.vesperDesktop?.isDesktop;

  useEffect(() => {
    const element = ref.current as any;
    if (!element || !isDesktop) return;
    const onDidNavigate = (event: any) => {
      if (typeof event?.url === 'string') onNavigated(event.url);
    };
    element.addEventListener('did-navigate', onDidNavigate);
    element.addEventListener('did-navigate-in-page', onDidNavigate);
    return () => {
      element.removeEventListener('did-navigate', onDidNavigate);
      element.removeEventListener('did-navigate-in-page', onDidNavigate);
    };
  }, [isDesktop, url, onNavigated]);

  if (!url) {
    return <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-wider text-faint">no page</div>;
  }

  if (isDesktop) {
    return (
      <div className="relative h-full w-full">
        {createElement('webview' as any, {
          ref,
          src: url,
          partition: 'persist:vesper-browser',
          allowpopups: undefined,
          webpreferences: 'contextIsolation=yes,nodeIntegration=no,sandbox=yes',
          style: { width: '100%', height: '100%', border: '0', background: '#fff' },
        })}
        <p className="pointer-events-none absolute bottom-2 right-2 rounded bg-ink-1000/80 px-2 py-1 font-mono text-[8.5px] uppercase tracking-wider text-faint backdrop-blur">
          live · isolated session
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-white">
      <iframe
        src={url}
        title="Live page"
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        referrerPolicy="no-referrer"
      />
      <p className="pointer-events-none absolute bottom-2 right-2 max-w-[80%] rounded bg-ink-1000/85 px-2 py-1 text-right font-mono text-[8.5px] uppercase tracking-wider text-faint backdrop-blur">
        some sites block embedding — use reader or the system browser
      </p>
    </div>
  );
}

function toLiveUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(value)) return `http://${value}`;
  return `https://${value}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function openExternal(url: string) {
  if (!url) return;
  if (window.vesperDesktop?.openExternal) {
    void window.vesperDesktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

