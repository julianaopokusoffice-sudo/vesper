import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  Copy,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  Unplug,
  Wifi,
} from 'lucide-react';
import type { NodeKind, NodeScope, PairedNode } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { relativeTime } from '@/lib/format';
import { Button, Chip, PageHeader, SectionLabel, Tooltip, cn, inputClass } from './ui';

const SCOPES: NodeScope[] = ['memory', 'files', 'agents', 'shell'];

const KIND_ICON: Record<NodeKind, typeof Laptop> = {
  desktop: Laptop,
  phone: Smartphone,
  server: Server,
};

export function DevicesView() {
  const link = useStore((s) => s.link);
  const refreshLink = useStore((s) => s.refreshLink);
  const mintCode = useStore((s) => s.mintCode);
  const pairDevice = useStore((s) => s.pairDevice);
  const toast = useStore((s) => s.toast);

  const [grantScopes, setGrantScopes] = useState<NodeScope[]>(['memory', 'files', 'agents']);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState(link?.self.name ?? '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(link?.self.name ?? '');
  }, [link?.self.name]);

  useEffect(() => {
    void refreshLink().catch(() => {});
  }, [refreshLink]);

  const self = link?.self;
  const peers = link?.peers ?? [];
  const pairing = link?.pairingCode;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const join = async () => {
    if (!url.trim() || !code.trim()) return;
    setJoining(true);
    try {
      await pairDevice(url.trim(), code.trim(), grantScopes);
      setUrl('');
      setCode('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader
          title="Devices"
          meta={<Chip tone={peers.length ? 'ok' : 'neutral'}>{peers.length ? `${peers.length} paired` : 'solo'}</Chip>}
          subtitle="Pair a phone, laptop or server running Vesper. Each pairing exchanges two keys and a capability grant, so either side can drive tools and agents on the other — over your own network, with no relay."
          actions={
            <Button variant="outline" size="sm" onClick={() => void refreshLink()}>
              <RefreshCw size={12} /> Refresh
            </Button>
          }
        />

        <div className="mt-4 grid gap-2.5 lg:grid-cols-[1.1fr_1fr]">
          {/* this device */}
          <div className="relative overflow-hidden rounded-xl border border-line bg-ink-950/40 p-4">
            <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
            <SectionLabel right={<span className="flex items-center gap-1 font-mono text-[9.5px] text-ok"><span className="h-[5px] w-[5px] rounded-full bg-ok pulse-dot" /> online</span>}>
              this device
            </SectionLabel>
            <div className="mt-3 flex items-start gap-2.5">
              <span className="mt-[2px] grid h-9 w-9 place-items-center rounded-lg border border-line bg-ink-900 text-muted">
                {(() => {
                  const Icon = KIND_ICON[(self?.kind as NodeKind) ?? 'desktop'];
                  return <Icon size={15} />;
                })()}
              </span>
              <div className="min-w-0 flex-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={async () => {
                    if (!name.trim() || name === self?.name) return;
                    try {
                      await api.renameSelf(name.trim());
                      await refreshLink();
                      toast('success', 'Device renamed');
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Rename failed');
                    }
                  }}
                  className="w-full bg-transparent text-[14px] font-medium text-fg outline-none focus:text-accent"
                  aria-label="Device name"
                />
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-faint">
                  <span className="mono">{self?.url ?? '—'}</span>
                  <button onClick={() => copy(self?.url ?? '')} className="text-faint hover:text-fg" aria-label="Copy address">
                    {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              <Chip tone="cool">{self?.kind ?? 'desktop'}</Chip>
              <Chip>{self?.platform ?? 'unknown'}</Chip>
              <Chip tone="ok">
                <ShieldCheck size={8} /> keys sealed
              </Chip>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              The management API stays loopback-only. Paired devices reach this machine through <span className="mono text-fg-2">/link</span>,
              which requires a per-device signature and a five-minute timestamp window.
            </p>
          </div>

          {/* pairing */}
          <div className="rounded-xl border border-line bg-ink-950/40 p-4">
            <SectionLabel right={pairing ? <span className="font-mono text-[9.5px] text-accent">live</span> : null}>pair a device</SectionLabel>

            {pairing ? (
              <div className="mt-3">
                <button
                  onClick={() => copy(pairing.code)}
                  className="group flex w-full items-center justify-between rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2.5"
                >
                  <span className="mono text-[22px] tracking-[0.18em] text-accent">{pairing.code}</span>
                  <span className="text-faint group-hover:text-accent">{copied ? <Check size={13} /> : <Copy size={13} />}</span>
                </button>
                <p className="mt-1.5 font-mono text-[9.5px] text-faint">
                  single use · expires {new Date(pairing.expiresAt).toLocaleTimeString()} · grants {grantScopes.join(', ') || 'nothing'}
                </p>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-line-soft bg-ink-1000/40 px-2 py-1.5">
                  <span className="mono truncate text-[10px] text-muted">vesper pair {self?.url} {pairing.code}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-[11.5px] leading-relaxed text-muted">
                  Generate a code here, then enter it on the other device. Only the capabilities you tick are handed over.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {SCOPES.map((scope) => {
                    const on = grantScopes.includes(scope);
                    return (
                      <button
                        key={scope}
                        onClick={() => setGrantScopes(on ? grantScopes.filter((s) => s !== scope) : [...grantScopes, scope])}
                        className={cn(
                          'rounded-md border px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wider transition-colors',
                          on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-faint hover:text-fg-2',
                        )}
                      >
                        {scope}
                      </button>
                    );
                  })}
                </div>
                <Button variant="primary" size="sm" className="mt-2.5 w-full" onClick={() => void mintCode(grantScopes)}>
                  <Link2 size={12} /> Generate pairing code
                </Button>
              </div>
            )}

            <div className="my-3 flex items-center gap-2">
              <span className="h-px flex-1 bg-line-soft" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-faint">or join a device</span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>

            <div className="space-y-1.5">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://192.168.1.20:8787"
                className={cn(inputClass, 'mono text-[11px]')}
                spellCheck={false}
              />
              <div className="flex gap-1.5">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  className={cn(inputClass, 'mono text-[12px] tracking-[0.12em]')}
                  spellCheck={false}
                />
                <Button variant="subtle" size="md" onClick={join} disabled={joining || !url.trim() || !code.trim()}>
                  {joining ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />} Pair
                </Button>
              </div>
              <p className="font-mono text-[9px] text-faint">
                grants them: {grantScopes.join(', ') || 'nothing'} · they grant you what their code says
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SectionLabel right={<span className="font-mono text-[10px] text-faint">{peers.length} peer{peers.length === 1 ? '' : 's'}</span>}>
            paired machines
          </SectionLabel>

          {peers.length === 0 ? (
            <div className="mt-2 rounded-xl border border-dashed border-line bg-ink-950/20 px-6 py-10 text-center">
              <Unplug size={20} className="mx-auto text-faint" />
              <p className="mt-3 font-serif text-[19px] text-fg">No devices paired yet</p>
              <p className="mx-auto mt-1 max-w-[50ch] text-[12px] leading-relaxed text-muted">
                Pair your phone to keep memory and runs in sync, or pair two laptops to let one agent drive builds on the other. The
                phone app also exposes its PRoot sandbox as a <span className="mono">shell</span> capability.
              </p>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {peers.map((peer) => (
                <PeerCard key={peer.id} peer={peer} />
              ))}
            </div>
          )}
        </div>

        {link?.audit?.length ? (
          <div className="mt-6">
            <SectionLabel right={<span className="font-mono text-[10px] text-faint">last {Math.min(link.audit.length, 10)}</span>}>
              link activity
            </SectionLabel>
            <div className="mt-2 overflow-hidden rounded-xl border border-line-soft">
              {link.audit.slice(0, 10).map((entry, index) => (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 font-mono text-[10px]',
                    index % 2 === 0 ? 'bg-ink-950/30' : 'bg-ink-1000/20',
                  )}
                >
                  <span className={entry.direction === 'in' ? 'text-cool' : 'text-accent'}>{entry.direction === 'in' ? '←' : '→'}</span>
                  <span className="w-[126px] shrink-0 truncate text-fg-2">{entry.nodeName}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{entry.action}</span>
                  <span className={entry.ok ? 'text-ok' : 'text-danger'}>{entry.ok ? 'ok' : 'fail'}</span>
                  <span className="w-[52px] shrink-0 text-right text-faint">{entry.ms}ms</span>
                  <span className="hidden w-[64px] shrink-0 text-right text-faint sm:block">{relativeTime(entry.at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Explain title="One code, two keys" body="Pairing rotates an inbound and an outbound key on both sides. Either device can then call the other; neither needs a relay." />
          <Explain title="Capabilities, not trust" body="Memory, files, agents and shell are separate grants. A phone can contribute memory without ever being able to run code on your laptop." />
          <Explain title="Every call is signed" body="HMAC over the body, a nonce and a timestamp. Replayed or edited requests are rejected, and each call lands in the audit log." />
        </div>
      </div>
    </div>
  );
}

function Explain({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3.5">
      <p className="text-[12px] font-medium text-fg">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function PeerCard({ peer }: { peer: PairedNode }) {
  const patchNode = useStore((s) => s.patchNode);
  const forgetNode = useStore((s) => s.forgetNode);
  const pingNode = useStore((s) => s.pingNode);
  const runRemoteTask = useStore((s) => s.runRemoteTask);
  const runRemoteShell = useStore((s) => s.runRemoteShell);
  const toast = useStore((s) => s.toast);

  const [pinging, setPinging] = useState(false);
  const [task, setTask] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState<'task' | 'shell' | null>(null);
  const [output, setOutput] = useState<{ kind: 'task' | 'shell'; text: string; ms?: number; traces?: { name: string; ms?: number }[] } | null>(null);

  const Icon = KIND_ICON[peer.kind] ?? Laptop;
  const can = (scope: NodeScope) => peer.scopes.includes(scope);

  const sendTask = async () => {
    if (!task.trim()) return;
    setBusy('task');
    setOutput(null);
    try {
      const result = await runRemoteTask(peer.id, task.trim());
      setOutput({ kind: 'task', text: result.output, ms: result.ms, traces: result.traces });
      setTask('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Remote task failed');
    } finally {
      setBusy(null);
    }
  };

  const sendShell = async () => {
    if (!command.trim()) return;
    setBusy('shell');
    setOutput(null);
    try {
      const result = await runRemoteShell(peer.id, command.trim());
      setOutput({ kind: 'shell', text: result.output, ms: result.ms });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Remote command failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-line-soft bg-ink-950/40 p-3.5"
    >
      <div className="flex flex-wrap items-start gap-2.5">
        <span className="mt-[2px] grid h-8 w-8 place-items-center rounded-lg border border-line bg-ink-900 text-muted">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[13px] font-medium text-fg">{peer.name}</h3>
            <Chip tone={peer.online ? 'ok' : 'neutral'}>{peer.online ? 'online' : 'idle'}</Chip>
            <Chip tone="cool">{peer.kind}</Chip>
          </div>
          <span className="mono block truncate text-[10px] text-faint">{peer.url || 'no address advertised'}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={pinging}
            onClick={async () => {
              setPinging(true);
              const ok = await pingNode(peer.id);
              setPinging(false);
              toast(ok ? 'success' : 'error', ok ? `${peer.name} answered` : `${peer.name} is unreachable`);
            }}
          >
            {pinging ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />} Ping
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (!window.confirm(`Forget ${peer.name}? This device's key is deleted on both sides.`)) return;
              void forgetNode(peer.id);
            }}
          >
            <Unplug size={11} /> Forget
          </Button>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line-soft bg-ink-1000/25 px-2.5 py-1.5">
          <span className="label">you can use there</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {peer.scopes.length ? (
              peer.scopes.map((scope) => (
                <Chip key={scope} tone={scope === 'shell' ? 'danger' : 'accent'}>
                  {scope}
                </Chip>
              ))
            ) : (
              <span className="text-[10px] text-faint">nothing</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-line-soft bg-ink-1000/25 px-2.5 py-1.5">
          <span className="label">they can use here</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {SCOPES.map((scope) => {
              const on = peer.granted.includes(scope);
              return (
                <Tooltip key={scope} text={on ? `Revoke ${scope}` : `Grant ${scope}`}>
                  <button
                    onClick={() =>
                      void patchNode(peer.id, {
                        granted: on ? peer.granted.filter((s) => s !== scope) : [...peer.granted, scope],
                      })
                    }
                    className={cn(
                      'rounded-md border px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-wider transition-colors',
                      on ? 'border-accent/35 bg-accent/10 text-accent' : 'border-line text-faint hover:text-fg-2',
                    )}
                  >
                    {scope}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendTask()}
          disabled={!can('agents')}
          placeholder={can('agents') ? `Ask an agent on ${peer.name}…` : 'agent capability not granted by that device'}
          className={cn(inputClass, 'h-8 min-w-[180px] flex-1 py-1 text-[11.5px]')}
        />
        <Button size="sm" variant="primary" onClick={sendTask} disabled={!can('agents') || busy !== null || !task.trim()}>
          {busy === 'task' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Run there
        </Button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendShell()}
          disabled={!can('shell')}
          placeholder={can('shell') ? `Run a shell command on ${peer.name}…` : 'shell capability not granted'}
          className={cn(inputClass, 'mono h-8 min-w-[180px] flex-1 py-1 text-[11px]')}
        />
        <Button size="sm" variant="outline" onClick={sendShell} disabled={!can('shell') || busy !== null || !command.trim()}>
          {busy === 'shell' ? <Loader2 size={11} className="animate-spin" /> : <Terminal size={11} />} Shell
        </Button>
      </div>

      {output && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line bg-ink-1000/60">
          <div className="flex items-center gap-2 border-b border-line-soft px-2 py-1">
            <span className="label">{output.kind === 'task' ? 'remote answer' : 'remote shell'}</span>
            {output.ms !== undefined && <span className="ml-auto font-mono text-[9px] text-faint">{(output.ms / 1000).toFixed(1)}s</span>}
          </div>
          <pre className="mono max-h-[260px] overflow-auto whitespace-pre-wrap px-2.5 py-2 text-[10.5px] leading-relaxed text-fg-2">
            {output.text || '(no output)'}
          </pre>
          {output.traces?.length ? (
            <div className="flex flex-wrap gap-1 border-t border-line-soft px-2 py-1">
              {output.traces.map((trace, index) => (
                <span key={`${trace.name}-${index}`} className="rounded border border-line-soft px-1 py-[1px] font-mono text-[9px] text-faint">
                  {trace.name} {trace.ms}ms
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </motion.div>
  );
}
