import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import type { UpdateInfo } from '@shared/types';
import { api } from '@/lib/api';
import { Button, Chip, SectionLabel, cn } from './ui';

type Status = {
  state: 'available' | 'downloading' | 'ready' | 'error' | 'idle';
  percent?: number;
  version?: string;
  message?: string;
};

/**
 * Update detection is shared; installation is per surface. The desktop shell
 * replaces its own binary through electron-updater. Web and Android get the
 * verified release page instead of pretending they can patch themselves.
 */
export function UpdatesCard() {
  const desktop = typeof window !== 'undefined' ? window.vesperDesktop : undefined;
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeSupported, setNativeSupported] = useState(false);

  const platformAsset = useMemo(() => {
    if (!info) return undefined;
    const target =
      desktop?.platform === 'win32'
        ? 'windows'
        : desktop?.platform === 'darwin'
          ? 'macos'
          : /android/i.test(navigator.userAgent)
            ? 'android'
            : 'linux';
    return info.assets.find((asset) => asset.platform === target) ?? info.assets.find((asset) => asset.platform === 'other');
  }, [desktop?.platform, info]);

  const load = async (force: boolean) => {
    setChecking(true);
    setError(null);
    try {
      const next = force ? await api.checkUpdate() : await api.update();
      setInfo(next);
      if (force && desktop?.updates) {
        const native = await desktop.updates.check().catch(() => null);
        setNativeSupported(Boolean(native?.supported));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check for updates');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!desktop?.updates) return;
    return desktop.updates.onStatus(setStatus);
  }, [desktop?.updates]);

  const download = async () => {
    if (!desktop?.updates) return;
    setError(null);
    const result = await desktop.updates.download().catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    if (!result.ok) setError(result.error ?? 'The update could not be downloaded.');
  };

  const install = async () => {
    if (!desktop?.updates) return;
    await desktop.updates.install();
  };

  const openRelease = async () => {
    const url = info?.releaseUrl;
    if (!url) return;
    if (desktop) await desktop.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const busy = status?.state === 'downloading';
  const ready = status?.state === 'ready';
  const latest = info?.latestVersion;

  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-ink-950/30 p-3.5">
      <SectionLabel
        right={
          info ? (
            <Chip tone={info.available ? 'accent' : info.error ? 'neutral' : 'ok'}>
              {info.available ? `v${latest} available` : info.error ? 'not checked' : 'up to date'}
            </Chip>
          ) : null
        }
      >
        <span className="flex items-center gap-1.5">
          <Rocket size={10} /> updates
        </span>
      </SectionLabel>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-muted">
        <span>
          this build <span className="font-mono text-fg-2">v{info?.currentVersion ?? '—'}</span>
        </span>
        {latest && (
          <span>
            latest <span className="font-mono text-fg-2">v{latest}</span>
          </span>
        )}
        {info?.publishedAt && <span className="text-faint">{new Date(info.publishedAt).toLocaleDateString()}</span>}
      </div>

      {info?.available && info.notes && (
        <details className="mt-2 rounded-lg border border-line bg-ink-1000/40 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium text-fg-2">Release notes</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted">
            {info.notes}
          </pre>
        </details>
      )}

      {info?.error && <p className="mt-2 text-[11px] leading-relaxed text-muted">{info.error}</p>}
      {error && <p className="mt-2 text-[11px] leading-relaxed text-danger/90">{error}</p>}

      {busy && (
        <div className="mt-2">
          <div className="flex items-center justify-between font-mono text-[10px] text-muted">
            <span>downloading</span>
            <span>{status?.percent ?? 0}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-850">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${status?.percent ?? 0}%` }} />
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" onClick={() => void load(true)} disabled={checking || busy}>
          {checking ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Check
        </Button>

        {info?.available && ready && nativeSupported && (
          <Button size="xs" variant="primary" onClick={() => void install()}>
            <Rocket size={10} /> Restart &amp; install
          </Button>
        )}

        {info?.available && !ready && nativeSupported && (
          <Button size="xs" variant="primary" onClick={() => void download()} disabled={busy}>
            <Download size={10} /> Download update
          </Button>
        )}

        {info?.available && !nativeSupported && (
          <Button size="xs" variant="primary" onClick={() => void openRelease()}>
            <Download size={10} /> {platformAsset?.platform === 'android' ? 'Get the APK' : 'Open the release'}
          </Button>
        )}

        {!info?.available && status?.state === 'error' && (
          <span className="text-[10.5px] text-danger/90">{status.message}</span>
        )}

        {info && !info.error && !info.available && (
          <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-ok">
            <Check size={9} /> current
          </span>
        )}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck size={11} className="mt-px shrink-0" />
        {nativeSupported
          ? 'Downloads are verified against the release checksum before an in-place install.'
          : 'This surface opens the signed release page; the desktop app can install updates in place.'}
      </p>

      {desktop && !nativeSupported && (
        <p className="mt-1 text-[10px] leading-relaxed text-faint">
          In-place updates need a packaged desktop build with a published release.
        </p>
      )}
    </div>
  );
}
