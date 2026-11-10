import { useEffect, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import type { ProviderId, ProviderInfo, Settings, WallpaperId } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button, Chip, Field, PageHeader, SectionLabel, Tooltip, Toggle, cn, inputClass } from './ui';
import { ThemePicker } from './ThemePicker';
import { DesktopCard } from './DesktopCard';
import { UpdatesCard } from './UpdatesCard';
import { VoiceCard } from './VoiceCard';

export function SettingsView() {
  const providers = useStore((s) => s.providers);
  const replaceProviders = useStore((s) => s.replaceProviders);
  const app = useStore((s) => s.app);
  const settings = useStore((s) => s.settings);
  const patchSettings = useStore((s) => s.patchSettings);
  const inspector = useStore((s) => s.inspector);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const toast = useStore((s) => s.toast);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-[900px] space-y-8">
        <PageHeader
          title="Settings"
          subtitle="Your keys, your endpoints. Nothing leaves this machine except the requests you address to a provider."
          meta={<Chip tone={app?.hasKeys ? 'ok' : 'accent'}>{app?.hasKeys ? 'connected' : 'demo only'}</Chip>}
        />

        <section>
          <SectionLabel right={<span className="font-mono text-[10px] text-faint">{providers.length} providers</span>}>
            <span className="flex items-center gap-1.5">
              <KeyRound size={10} /> providers
            </span>
          </SectionLabel>
          <p className="mt-1 text-[11.5px] text-muted">
            Keys are sealed with AES-256-GCM at rest. Local endpoints need no key — point the base URL at your server and hit test.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onSaved={(next) => {
                  replaceProviders(next);
                  toast('success', `${provider.label} saved`);
                }}
              />
            ))}
          </div>
        </section>

        <SearchSettings />

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
            <SectionLabel>defaults</SectionLabel>
            <div className="mt-3 space-y-3">
              <Field label="Default model" hint="used when an agent has no binding">
                <div className="flex gap-2">
                  <select
                    className={inputClass}
                    value={settings.defaultModel.provider}
                    onChange={(e) =>
                      patchSettings({
                        defaultModel: {
                          provider: e.target.value as ProviderId,
                          id: providers.find((p) => p.id === e.target.value)?.models[0] ?? '',
                        },
                      })
                    }
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={cn(inputClass, 'mono text-[12px]')}
                    value={settings.defaultModel.id}
                    onChange={(e) => patchSettings({ defaultModel: { ...settings.defaultModel, id: e.target.value } })}
                  />
                </div>
              </Field>

              <Field label="House style preamble" hint="appended to every system prompt">
                <textarea
                  className={cn(inputClass, 'min-h-[86px] resize-y text-[11.5px] leading-relaxed')}
                  value={settings.systemPreamble}
                  onChange={(e) => patchSettings({ systemPreamble: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Max tool steps" hint="ceiling">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    className={inputClass}
                    value={settings.maxSteps}
                    onChange={(e) => patchSettings({ maxSteps: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Default temperature" hint={settings.temperature.toFixed(2)}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.temperature}
                    onChange={(e) => patchSettings({ temperature: Number(e.target.value) })}
                    className="mt-2.5 w-full accent-[oklch(0.805_0.148_78)]"
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
            <SectionLabel>interface</SectionLabel>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[12px] text-fg-2">Theme</p>
                <p className="text-[10.5px] text-faint">Seven complete palettes — surfaces, borders and accent tuned together.</p>
                <div className="mt-2">
                  <ThemePicker theme={settings.theme} onChange={(theme) => void patchSettings({ theme })} />
                </div>
              </div>
              <div>
                <p className="text-[12px] text-fg-2">Wallpaper</p>
                <p className="text-[10.5px] text-faint">Ambient light behind the console. CSS only — no image downloaded.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'aurora', name: 'Aurora', css: 'radial-gradient(circle at 20% 10%, oklch(0.805 0.148 78 / 0.5), transparent 60%), radial-gradient(circle at 80% 0%, oklch(0.72 0.13 295 / 0.4), transparent 60%), oklch(0.16 0.01 272)' },
                      { id: 'dusk', name: 'Dusk', css: 'radial-gradient(circle at 20% 10%, oklch(0.72 0.16 310 / 0.55), transparent 60%), radial-gradient(circle at 85% 5%, oklch(0.68 0.15 25 / 0.35), transparent 62%), oklch(0.16 0.01 272)' },
                      { id: 'ember', name: 'Ember', css: 'radial-gradient(circle at 20% 10%, oklch(0.76 0.16 55 / 0.55), transparent 60%), radial-gradient(circle at 85% 10%, oklch(0.66 0.17 30 / 0.35), transparent 62%), oklch(0.16 0.01 272)' },
                      { id: 'tide', name: 'Tide', css: 'radial-gradient(circle at 20% 10%, oklch(0.74 0.12 200 / 0.55), transparent 60%), radial-gradient(circle at 85% 5%, oklch(0.7 0.13 165 / 0.3), transparent 62%), oklch(0.16 0.01 272)' },
                      { id: 'graphite', name: 'Graphite', css: 'repeating-linear-gradient(0deg, oklch(1 0 0 / 0.12) 0 1px, transparent 1px 14px), oklch(0.17 0.005 272)' },
                    ] as { id: WallpaperId; name: string; css: string }[]
                  ).map((wallpaper) => (
                    <button
                      key={wallpaper.id}
                      onClick={() => patchSettings({ wallpaper: wallpaper.id })}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors',
                        settings.wallpaper === wallpaper.id
                          ? 'border-accent/50 text-fg'
                          : 'border-line text-faint hover:border-line-strong hover:text-fg-2',
                      )}
                    >
                      <span className="h-5 w-7 rounded border border-white/10" style={{ background: wallpaper.css }} />
                      <span className="pr-0.5 font-mono text-[9px] uppercase tracking-wider">{wallpaper.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Row label="Speak replies" hint="Read each finished answer aloud — system voice or your local voice model.">
                <Toggle checked={settings.speakReplies} onChange={(next) => patchSettings({ speakReplies: next })} label="Speak replies" />
              </Row>
              <VoiceCard />
              <Row label="Reduce motion" hint="Disable entrance and drift animation.">
                <Toggle checked={settings.reduceMotion} onChange={(next) => patchSettings({ reduceMotion: next })} label="Reduce motion" />
              </Row>
              <Row label="Inspector panel" hint="Show agent context on the right.">
                <Toggle checked={inspector} onChange={toggleInspector} label="Inspector" />
              </Row>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] text-fg-2">Council size</p>
                  <p className="text-[10.5px] text-faint">Default agents per council run.</p>
                </div>
                <input
                  type="number"
                  min={2}
                  max={6}
                  className={cn(inputClass, 'w-16 text-center')}
                  value={settings.councilSize}
                  onChange={(e) => patchSettings({ councilSize: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <ImagePanel settings={settings} patch={patchSettings} toast={toast} />
          <ModelsPanel toast={toast} />
        </section>

        <HarnessPanel />

        <section>
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <HardDrive size={10} /> runtime
            </span>
          </SectionLabel>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <InfoRow label="version" value={`v${app?.version}`} />
            <InfoRow label="platform" value={app?.platform ?? ''} />
            <InfoRow label="data home" value={app?.home ?? ''} mono />
            <InfoRow label="workspace" value={app?.workspace ?? ''} mono />
          </div>
          <DesktopCard />
          <UpdatesCard />
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-line-soft bg-ink-950/30 p-3">
            <Shield size={13} className="mt-[2px] shrink-0 text-accent/80" />
            <p className="text-[11px] leading-relaxed text-muted">
              <span className="text-fg-2">Security model.</span> The server binds to loopback only. Secrets are encrypted with a local
              key at 0600. Filesystem tools resolve paths inside the workspace and refuse escapes; the shell tool requires explicit
              approval for every command, and the approval shows the exact string that will run. If you expose this port beyond
              loopback, put an authenticating proxy in front of it.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function ImagePanel({
  settings,
  patch,
  toast,
}: {
  settings: Settings;
  patch: (next: Partial<Settings>) => void;
  toast: (kind: 'success' | 'error' | 'info', text: string) => void;
}) {
  const image = settings.image;
  const set = (next: Partial<Settings['image']>) => patch({ image: { ...image, ...next } });

  return (
    <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
      <SectionLabel right={<span className="font-mono text-[10px] text-faint">{image.backend}</span>}>
        <span className="flex items-center gap-1.5">
          <ImageIcon size={10} /> image generation
        </span>
      </SectionLabel>
      <p className="mt-1 text-[11.5px] text-muted">
        Powers the <span className="mono text-fg-2">generate_image</span> tool. Local backends need no key.
      </p>
      <div className="mt-3 space-y-3">
        <Field label="Backend">
          <select className={inputClass} value={image.backend} onChange={(e) => set({ backend: e.target.value as Settings['image']['backend'] })}>
            <option value="off">off</option>
            <option value="sdcpp">stable-diffusion.cpp (local)</option>
            <option value="a1111">Stable Diffusion WebUI (local)</option>
            <option value="openai">OpenAI-compatible API</option>
          </select>
        </Field>
        {image.backend !== 'off' && (
          <>
            <Field label="Base URL" hint="where the backend listens">
              <input
                className={inputClass}
                value={image.baseURL}
                placeholder="http://127.0.0.1:8080"
                onChange={(e) => set({ baseURL: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Size">
                <input className={inputClass} value={image.size} placeholder="1024x1024" onChange={(e) => set({ size: e.target.value })} />
              </Field>
              <Field label="Steps" hint="fewer = faster">
                <input
                  type="number"
                  min={1}
                  max={80}
                  className={inputClass}
                  value={image.steps}
                  onChange={(e) => set({ steps: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Model id" hint="optional">
              <input className={inputClass} value={image.model} placeholder="leave blank for the backend default" onChange={(e) => set({ model: e.target.value })} />
            </Field>
            {image.backend === 'openai' && (
              <Field label="API key" hint="hosted only">
                <input
                  type="password"
                  className={inputClass}
                  value={image.apiKey ?? ''}
                  placeholder="sk-…"
                  onChange={(e) => set({ apiKey: e.target.value })}
                />
              </Field>
            )}
            <button
              type="button"
              onClick={() => toast('info', `Backend saved. Test it by asking an agent to “draw a simple map”.`)}
              className="rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 font-mono text-[10.5px] text-fg-2 hover:text-fg"
            >
              how to test
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function HarnessPanel() {
  const [statuses, setStatuses] = useState<
    Awaited<ReturnType<typeof api.harnesses>>['harnesses']
  >([]);
  const [customFile, setCustomFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const result = await api.harnesses(true);
      setStatuses(result.harnesses);
      setCustomFile(result.customFile);
    } catch {
      /* server not reachable yet */
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const ready = statuses.filter((status) => status.available);
  const missing = statuses.filter((status) => !status.available);
  const shown = showAll ? statuses : ready;

  return (
    <section>
      <SectionLabel
        right={
          <button
            onClick={() => void load()}
            className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-fg-2"
          >
            <RefreshCw size={9} className={busy ? 'animate-spin' : ''} /> rescan
          </button>
        }
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={10} /> coding agents on this machine
        </span>
      </SectionLabel>
      <p className="mt-1 text-[11.5px] text-muted">
        Vesper can hand a task to any agent CLI you already trust — Claude Code, aider, opencode, Codex, Gemini — and read the result
        back. Runs are approval-gated and happen in your workspace. Add anything else in{' '}
        <span className="mono text-[10.5px] text-fg-2">{customFile || 'harnesses.json'}</span>.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((status) => (
          <div
            key={status.id}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-2.5 py-2',
              status.available ? 'border-line-soft bg-ink-950/30' : 'border-line-soft/60 bg-ink-1000/20',
            )}
          >
            <span className={cn('mt-[3px] grid h-4 w-4 shrink-0 place-items-center', status.available ? 'text-ok' : 'text-faint')}>
              {status.available ? <Check size={11} /> : <Terminal size={11} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn('truncate text-[12px]', status.available ? 'text-fg-2' : 'text-muted')}>{status.name}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{status.vendor}</span>
                {status.autonomous && status.available ? (
                  <span className="rounded border border-accent/20 bg-accent-wash px-1 font-mono text-[8.5px] uppercase tracking-wider text-accent">
                    can edit
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[10.5px] text-faint">{status.available ? status.note : `not installed · ${status.bin}`}</p>
            </div>
            {status.homepage ? (
              <a
                href={status.homepage}
                target="_blank"
                rel="noreferrer noopener"
                title={status.available ? 'Project page' : 'How to install'}
                className="mt-[2px] shrink-0 text-faint hover:text-fg-2"
              >
                <ExternalLink size={11} />
              </a>
            ) : null}
          </div>
        ))}
        {!shown.length && !busy ? <p className="mono text-[10.5px] text-faint">No agent CLIs detected on PATH.</p> : null}
      </div>

      {missing.length ? (
        <button
          onClick={() => setShowAll((value) => !value)}
          className="mt-2 font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-fg-2"
        >
          {showAll ? 'hide' : `show ${missing.length} more that can be installed`}
        </button>
      ) : null}
    </section>
  );
}

function ModelsPanel({ toast }: { toast: (kind: 'success' | 'error' | 'info', text: string) => void }) {
  const [files, setFiles] = useState<{ name: string; bytes: number }[]>([]);
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await api.localModels().catch(() => null);
    if (result) {
      setFiles(result.files);
      setPath(result.path);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const download = async () => {
    if (!/^https?:\/\//.test(url.trim())) {
      toast('error', 'Give a direct URL to a .gguf file');
      return;
    }
    setBusy(true);
    try {
      const result = await api.downloadModel(url.trim());
      toast('success', `${result.file} · ${(result.bytes / 1_048_576).toFixed(0)} MB saved`);
      setUrl('');
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
      <SectionLabel right={<span className="font-mono text-[10px] text-faint">{files.length} files</span>}>
        <span className="flex items-center gap-1.5">
          <Download size={10} /> local models
        </span>
      </SectionLabel>
      <p className="mt-1 text-[11.5px] text-muted">
        Pull a GGUF straight into your state directory, then point the <span className="mono text-fg-2">llama.cpp</span> provider at it. On the
        phone, files land inside the PRoot guest.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className={inputClass}
          value={url}
          placeholder="https://huggingface.co/…/model-Q4_K_M.gguf"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-line bg-ink-900 px-3 font-mono text-[10.5px] text-fg-2 transition-colors hover:text-fg disabled:opacity-50"
        >
          {busy ? 'pulling…' : 'download'}
        </button>
      </div>
      <div className="mt-3 max-h-44 space-y-1 overflow-y-auto">
        {files.length === 0 && (
          <p className="mono text-[10.5px] text-faint">nothing downloaded yet</p>
        )}
        {files.map((file) => (
          <div key={file.name} className="flex items-center justify-between gap-2 rounded-md border border-line-soft bg-ink-1000/40 px-2 py-1.5">
            <span className="truncate font-mono text-[10.5px] text-fg-2">{file.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-faint">{(file.bytes / 1_048_576).toFixed(0)} MB</span>
          </div>
        ))}
      </div>
      {path && <p className="mono mt-2 text-[9.5px] text-faint/70">{path}</p>}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[12px] text-fg-2">{label}</p>
        <p className="text-[10.5px] text-faint">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-ink-1000/30 px-2.5 py-1.5">
      <span className="label shrink-0">{label}</span>
      <span className={cn('ml-auto truncate text-[10.5px] text-fg-2', mono && 'mono')} title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * Web search keys. The tool works without one (DuckDuckGo HTML), but a keyed
 * backend returns snippets and does not rate-limit a long research session.
 * Each provider links to the exact page where its key is created.
 */
function SearchSettings() {
  const toast = useStore((s) => s.toast);
  const [config, setConfig] = useState<{
    active: string;
    providers: { id: string; label: string; keyless?: boolean; hasKey: boolean; docs: string; note: string; keyHint?: string }[];
  } | null>(null);
  const [provider, setProvider] = useState('duckduckgo');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const next = await api.searchConfig();
      setConfig(next);
      setProvider(next.active);
    } catch {
      /* the section stays hidden if the runtime is older */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!config) return null;
  const current = config.providers.find((entry) => entry.id === provider);

  const save = async (body: { provider: string; key?: string; clear?: boolean }) => {
    setBusy(true);
    try {
      await api.saveSearchConfig(body);
      await load();
      setKey('');
      toast('success', body.clear ? 'Search key removed' : `${provider} is now the search backend`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save the search key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionLabel right={<span className="font-mono text-[10px] text-faint">{config.active}</span>}>
        <span className="flex items-center gap-1.5">
          <Globe size={10} /> web search
        </span>
      </SectionLabel>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
        Used by the <span className="mono text-fg-2">web_search</span> tool and deep-research runs. DuckDuckGo works with no key;
        the others return snippets and survive heavy use. Keys are sealed at rest and never sent back to the console.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {config.providers.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setProvider(entry.id)}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors',
              provider === entry.id ? 'border-accent/40 bg-accent/[0.05]' : 'border-line-soft bg-ink-950/30 hover:border-line',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-[6px] w-[6px] rounded-full',
                  entry.keyless ? 'bg-cool' : entry.hasKey ? 'bg-ok' : 'bg-ink-800',
                )}
              />
              <span className="truncate text-[12px] font-medium text-fg">{entry.label}</span>
              {config.active === entry.id && <Chip tone="accent">active</Chip>}
              {entry.keyless && <Chip tone="cool">no key</Chip>}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{entry.note}</p>
            <a
              href={entry.docs}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-accent"
            >
              where to get a key <ExternalLink size={9} />
            </a>
          </button>
        ))}
      </div>

      {current && !current.keyless && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={current.hasKey ? '•••••••••••• (saved)' : (current.keyHint ?? 'api key')}
            className={cn(inputClass, 'mono max-w-[320px] flex-1 text-[11px]')}
            spellCheck={false}
            autoComplete="off"
          />
          <Button size="sm" variant="primary" onClick={() => void save({ provider, key })} disabled={busy || !key.trim()}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : null} Save key
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save({ provider, clear: true })} disabled={busy || !current.hasKey}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void save({ provider: 'duckduckgo' })} disabled={busy}>
            Use keyless
          </Button>
        </div>
      )}
    </section>
  );
}

function ProviderCard({ provider, onSaved }: { provider: ProviderInfo; onSaved: (providers: ProviderInfo[]) => void }) {
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [models, setModels] = useState(provider.models);
  const [newModel, setNewModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    setBaseURL(provider.baseURL);
    setModels(provider.models);
  }, [provider.baseURL, provider.models]);

  const save = async () => {
    try {
      const next = await api.saveProvider(provider.id, {
        ...(key ? { apiKey: key } : {}),
        baseURL,
        models,
      });
      onSaved(next);
      setKey('');
      setResult(null);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await api.testProvider(provider.id);
      setResult({ ok: res.ok, message: res.message });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const isDemo = provider.kind === 'demo';

  return (
    <div className="flex flex-col rounded-xl border border-line-soft bg-ink-950/40 p-3.5">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full',
            provider.hasKey || provider.local ? 'bg-ok' : 'bg-ink-800',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[12.5px] font-medium text-fg">{provider.label}</h3>
            {provider.local && <Chip tone="cool">local</Chip>}
            {provider.hasKey && <Chip tone="ok">key set</Chip>}
          </div>
          <span className="mono block truncate text-[9.5px] text-faint">{provider.baseURL || 'built-in'}</span>
        </div>
        {provider.docs && (
          <Tooltip text="Get a key">
            <a
              href={provider.docs}
              target="_blank"
              rel="noreferrer"
              className="text-faint transition-colors hover:text-accent"
              aria-label={`${provider.label} docs`}
            >
              <ExternalLink size={12} />
            </a>
          </Tooltip>
        )}
      </div>

      {!isDemo && (
        <>
          <div className="mt-2.5 flex gap-1.5">
            <div className="relative flex-1">
              <input
                type={reveal ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider.hasKey ? '•••••••••••• (saved)' : (provider.keyHint ?? 'api key')}
                className={cn(inputClass, 'mono pr-8 text-[11px]')}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={() => setReveal((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
                aria-label={reveal ? 'Hide key' : 'Show key'}
              >
                {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </div>

          <input
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="base URL"
            className={cn(inputClass, 'mono mt-1.5 text-[10.5px]')}
            spellCheck={false}
          />

          <div className="mt-1.5 flex flex-wrap gap-1">
            {models.map((model) => (
              <span key={model} className="flex items-center gap-1 rounded border border-line bg-white/[0.03] px-1.5 py-[2px] font-mono text-[9.5px] text-fg-2">
                {model}
                <button onClick={() => setModels(models.filter((m) => m !== model))} className="text-faint hover:text-danger">
                  <X size={8} />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1 rounded border border-dashed border-line px-1.5 py-[2px]">
              <Plus size={8} className="text-faint" />
              <input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newModel.trim()) {
                    setModels([...new Set([...models, newModel.trim()])]);
                    setNewModel('');
                  }
                }}
                placeholder="add model"
                className="w-[84px] bg-transparent font-mono text-[9.5px] text-fg outline-none placeholder:text-faint/70"
              />
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <Button size="xs" variant="primary" onClick={save}>
              Save
            </Button>
            <Button size="xs" variant="outline" onClick={test} disabled={testing}>
              {testing ? <Loader2 size={10} className="animate-spin" /> : null} Test
            </Button>
            {result && (
              <span className={cn('flex min-w-0 items-center gap-1 font-mono text-[9.5px]', result.ok ? 'text-ok' : 'text-danger')}>
                {result.ok ? <Check size={10} /> : <X size={10} />}
                <span className="truncate" title={result.message}>
                  {result.message}
                </span>
              </span>
            )}
          </div>
        </>
      )}

      {isDemo && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          A deterministic local model with no network access. Every screen, tool loop and council run works against it, which makes
          it the safe default before you add a key.
        </p>
      )}
    </div>
  );
}
