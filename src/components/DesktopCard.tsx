import { useEffect, useState } from 'react';
import { Check, Loader2, Terminal, X } from 'lucide-react';
import { SectionLabel, cn } from './ui';

/**
 * The desktop installer ships the CLI next to the app and puts a `vesper` shim
 * on the user's PATH. This card is the honest place to see whether that
 * happened, and to repair it without reinstalling.
 */
export function DesktopCard() {
  const desktop = typeof window !== 'undefined' ? window.vesperDesktop : undefined;
  const [status, setStatus] = useState<{ installed: boolean; onPath: boolean; path?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    if (!desktop) return;
    void desktop
      .cliStatus()
      .then(setStatus)
      .catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async () => {
    if (!desktop) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await desktop.installCli();
      setStatus({ installed: result.ok, onPath: Boolean(result.onPath), path: result.path });
      setMessage(result.detail);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not install the command');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-ink-950/30 p-3.5">
      <SectionLabel
        right={
          status ? (
            <span className={cn('flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider', status.onPath ? 'text-ok' : 'text-accent')}>
              {status.onPath ? <Check size={9} /> : <Terminal size={9} />}
              {status.onPath ? 'on path' : status.installed ? 'installed' : 'not installed'}
            </span>
          ) : null
        }
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={10} /> command line
        </span>
      </SectionLabel>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        The same agents, threads and provider keys from a terminal. The desktop installer bundles <span className="mono text-fg-2">vesper</span>{' '}
        and adds it to your PATH; from a source checkout, run <span className="mono text-fg-2">npm run cli --</span> or link it.
      </p>

      {desktop ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void install()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-accent/35 bg-accent/[0.08] px-2.5 py-1 text-[10.5px] text-accent hover:bg-accent/[0.13] disabled:opacity-50"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Terminal size={10} />}
            {status?.installed ? 'Repair command' : 'Install command'}
          </button>
          {status?.path && <span className="min-w-0 truncate font-mono text-[9px] text-faint">{status.path}</span>}
          {message && (
            <span className="flex items-center gap-1 font-mono text-[9px] text-muted">
              {message.startsWith('OK') ? <Check size={9} className="text-ok" /> : <X size={9} className="text-danger" />}
              {message}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-2 font-mono text-[9.5px] text-faint">
          vesper run "find the failing test" --yes
        </p>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-faint/80">
        The CLI is a thin client over this machine's runtime, and starts the bundled runtime when the desktop app is not already
        running. <span className="mono">vesper browser open &lt;url&gt;</span> drives the in-app browser from the terminal.
      </p>
    </div>
  );
}
