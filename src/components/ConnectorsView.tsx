import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import type { ConnectorCategory, ConnectorDefinition, ConnectorInfo } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { BrandIcon } from './BrandIcon';
import { Button, Chip, Field, Modal, PageHeader, SectionLabel, cn, inputClass } from './ui';

const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  email: 'Email',
  calendar: 'Calendar',
  code: 'Code',
  cloud: 'Cloud',
  data: 'Data',
  comms: 'Comms',
  payments: 'Payments',
  monitoring: 'Monitoring',
};

/**
 * Connectors are the services around the work: mail, calendar, the place code
 * deploys, the database behind it. Credentials are sealed server-side; agents
 * reach each service through its own REST API, reads directly and writes only
 * after an approval.
 */
export function ConnectorsView() {
  const toast = useStore((state) => state.toast);
  const [list, setList] = useState<ConnectorInfo[]>([]);
  const [redirectUri, setRedirectUri] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const [editing, setEditing] = useState<ConnectorDefinition | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  const load = async (quiet = false) => {
    try {
      const result = await api.connectors();
      setList(result.connectors);
      setRedirectUri(result.redirectUri);
    } catch (err) {
      if (!quiet) toast('error', err instanceof Error ? err.message : 'Could not load connectors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** While a popup is open, poll so the card flips green when the callback lands. */
  useEffect(() => {
    if (!awaiting) return;
    const started = Date.now();
    poll.current = window.setInterval(() => {
      void api
        .connectors()
        .then((result) => {
          setList(result.connectors);
          const target = result.connectors.find((entry) => entry.definition.id === awaiting);
          if (target?.connected && !target.error) {
            toast('success', `${target.definition.name} connected`);
            setAwaiting(null);
          } else if (Date.now() - started > 120_000) {
            setAwaiting(null);
          }
        })
        .catch(() => undefined);
    }, 3500);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter(({ definition }) => {
      if (category !== 'all' && definition.category !== category) return false;
      if (!needle) return true;
      return `${definition.name} ${definition.blurb} ${definition.category}`.toLowerCase().includes(needle);
    });
  }, [list, query, category]);

  const connectedCount = list.filter((entry) => entry.connected).length;

  const openEditor = (definition: ConnectorDefinition, existing?: ConnectorInfo) => {
    setEditing(definition);
    const values: Record<string, string> = {};
    for (const field of definition.fields) if (!field.secret && existing?.set.includes(field.key)) values[field.key] = '';
    setForm(values);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(editing.id);
    try {
      const result = await api.saveConnector(editing.id, form);
      setList((current) =>
        current.map((entry) => (entry.definition.id === editing.id ? result.connector ?? entry : entry)),
      );
      if (result.error) {
        toast('error', result.error);
        return;
      }
      if (editing.auth === 'oauth') {
        const { url } = await api.connectorOAuth(editing.id);
        window.open(url, 'vesper-oauth', 'width=520,height=720');
        setAwaiting(editing.id);
        setEditing(null);
        toast('info', 'Finish signing in in the window that just opened.');
        return;
      }
      toast('success', `${editing.name} connected`);
      setEditing(null);
      void load(true);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save the connector');
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string) => {
    setBusy(id);
    try {
      const result = await api.testConnector(id);
      setList((current) => current.map((entry) => (entry.definition.id === id ? result.connector : entry)));
      toast('success', `${result.connector.definition.name} answered`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'No answer from the service');
      void load(true);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api.disconnectConnector(id);
      setList((current) =>
        current.map((entry) =>
          entry.definition.id === id
            ? { ...entry, connected: false, account: undefined, error: undefined, set: [] }
            : entry,
        ),
      );
      toast('info', 'Disconnected — the credential is gone from this machine.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-[1040px] space-y-6">
        <PageHeader
          title="Connectors"
          subtitle="Mail, calendar, deploy targets, databases and payment rails. Credentials are sealed on this machine; agents read with them directly and every write asks first."
          meta={<Chip tone={connectedCount ? 'ok' : 'neutral'}>{connectedCount ? `${connectedCount} connected` : 'none connected'}</Chip>}
          actions={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw size={13} /> Refresh
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search services…"
            className={cn(inputClass, 'h-8 w-[220px] py-0 text-[12px]')}
          />
          <span className="mx-1 h-4 w-px bg-line-soft" />
          {(['all', ...Object.keys(CATEGORY_LABEL)] as (ConnectorCategory | 'all')[]).map((key) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.07em] transition-colors',
                category === key
                  ? 'border-accent/35 bg-accent/10 text-accent'
                  : 'border-line-soft text-faint hover:border-line hover:text-fg-2',
              )}
            >
              {key === 'all' ? 'All' : CATEGORY_LABEL[key]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-[132px] animate-pulse rounded-xl border border-line-soft bg-ink-950/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-line-soft bg-ink-950/30 px-5 py-10 text-center">
            <p className="text-[13px] text-muted">No service matches that filter.</p>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(({ definition, connected, account, error, lastCheck, set }) => (
              <div
                key={definition.id}
                className={cn(
                  'group relative flex flex-col rounded-xl border bg-ink-950/40 p-3.5 transition-colors',
                  connected && !error ? 'border-line' : 'border-line-soft hover:border-line',
                )}
              >
                <div className="flex items-start gap-2.5">
                  <BrandIcon
                    id={definition.id}
                    name={definition.name}
                    accent={definition.accent}
                    className="mt-0.5 h-7 w-7"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-fg">{definition.name}</span>
                      {connected && !error && <Check size={12} className="shrink-0 text-ok" />}
                    </div>
                    <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
                      {CATEGORY_LABEL[definition.category]} · {definition.auth === 'oauth' ? 'oauth' : 'api key'}
                    </p>
                  </div>
                </div>

                <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{definition.blurb}</p>

                {connected ? (
                  <p className="mt-2 truncate font-mono text-[10.5px] text-fg-2">
                    {account || 'connected'}
                    {lastCheck ? <span className="text-faint"> · checked {timeAgo(lastCheck)}</span> : null}
                  </p>
                ) : (
                  <p className="mt-2 text-[10.5px] text-faint">Not connected</p>
                )}

                {error && (
                  <p className="mt-1.5 line-clamp-2 rounded-md border border-danger/25 bg-danger/[0.06] px-2 py-1 font-mono text-[10px] leading-relaxed text-danger/90">
                    {error}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-1.5 border-t border-line-soft pt-2.5">
                  {connected ? (
                    <>
                      <Button size="xs" variant="subtle" disabled={busy === definition.id} onClick={() => void test(definition.id)}>
                        {busy === definition.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Test
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => openEditor(definition, { definition, connected, set } as ConnectorInfo)}>
                        {definition.auth === 'oauth' ? 'Reauthorize' : 'Rotate key'}
                      </Button>
                      <button
                        aria-label={`Disconnect ${definition.name}`}
                        onClick={() => void remove(definition.id)}
                        className="ml-auto grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Unplug size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      <Button size="xs" variant="primary" onClick={() => openEditor(definition)}>
                        <Plus size={11} /> Connect
                      </Button>
                      <a
                        href={definition.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-1 text-[10.5px] text-faint transition-colors hover:text-fg-2"
                      >
                        API docs <ExternalLink size={10} />
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="rounded-xl border border-line-soft bg-ink-950/30 p-4">
          <SectionLabel
            right={
              <span className="flex items-center gap-1 font-mono text-[10px] text-faint">
                <ShieldCheck size={11} /> AES-256-GCM at rest
              </span>
            }
          >
            <span className="flex items-center gap-1.5">
              <Plug size={10} /> how agents use these
            </span>
          </SectionLabel>
          <p className="mt-2 max-w-[80ch] text-[11.5px] leading-relaxed text-muted">
            Every connected service adds two tools to all agents: <span className="mono text-fg-2">connector_read</span> for
            GET requests and <span className="mono text-fg-2">connector_write</span> for anything that changes state. Paths
            are relative to the service API root, so the model uses the provider's own documentation instead of a wrapper
            that lags behind it. Writes always stop at the approval dialog. Scheduled runs get read access only.
          </p>
        </section>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Connect ${editing.name}` : 'Connect'}
        subtitle={editing?.blurb}
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!editing || busy === editing.id} onClick={() => void save()}>
              {busy === editing?.id ? <Loader2 size={12} className="animate-spin" /> : null}
              {editing?.auth === 'oauth' ? 'Save & sign in' : 'Save & test'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 px-5 py-4">
          {editing?.auth === 'oauth' && (
            <div className="rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              Create an OAuth client in the provider console, add{' '}
              <span className="mono break-all text-fg-2">{redirectUri || '/api/connectors/oauth/callback'}</span> as a redirect
              URI, then paste the id and secret here. Sign-in opens in a small window and the tokens stay sealed on this
              machine.
            </div>
          )}
          {editing?.fields.map((field) => (
            <Field key={field.key} label={field.label} hint={field.required ? 'required' : 'optional'}>
              <input
                type={field.secret ? 'password' : 'text'}
                value={form[field.key] ?? ''}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                className={cn(inputClass, 'font-mono text-[12px]')}
              />
              {field.hint && <span className="text-[10.5px] text-faint">{field.hint}</span>}
            </Field>
          ))}
          <p className="text-[10.5px] leading-relaxed text-faint">
            Leave a field blank to keep the value already stored. Keys are sealed before they touch disk and are never sent
            back to this window.
          </p>
          <a
            href={editing?.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-accent/85 hover:text-accent"
          >
            Where to find this credential <ExternalLink size={11} />
          </a>
        </div>
      </Modal>
    </div>
  );
}

function timeAgo(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
