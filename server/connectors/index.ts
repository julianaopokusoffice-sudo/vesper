import { randomUUID } from 'node:crypto';
import { readKV, writeKV } from '../kernel/kv.ts';
import { open, seal } from '../kernel/secrets.ts';
import type { ConnectorCategory, ConnectorDefinition, ConnectorInfo } from '../../shared/types.ts';

/**
 * Connectors — the services around the work, not inside it.
 *
 * Two rules shape this module:
 * - Credentials are sealed with the same AES-256-GCM key as provider keys and
 *   never returned to the renderer. The UI sees which fields are set, not what
 *   they contain.
 * - Agents reach a service through its own REST API (one read tool, one write
 *   tool) rather than a pile of hand-written wrappers. That keeps every service
 *   at full capability and makes a new connector a catalog entry, not code.
 *
 * OAuth connectors (Gmail, Calendar) use the authorization-code flow. The app
 * has no client secret of its own — the user registers an OAuth client and
 * pastes its id/secret, so the tokens stay theirs.
 */

const GOOGLE_OAUTH = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
};

export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    blurb: 'Read, search, draft and send mail from the inbox you already use.',
    category: 'email',
    auth: 'oauth',
    accent: '#ea4335',
    baseUrl: 'https://gmail.googleapis.com',
    docsUrl: 'https://developers.google.com/gmail/api/reference/rest',
    fields: [
      { key: 'clientId', label: 'OAuth client id', placeholder: '1234-abc.apps.googleusercontent.com', required: true },
      { key: 'clientSecret', label: 'OAuth client secret', secret: true, required: true, hint: 'Same Google client works for Gmail and Calendar.' },
    ],
    style: 'bearer',
    oauth: { ...GOOGLE_OAUTH, scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'] },
    probe: { path: '/gmail/v1/users/me/profile' },
    accountPath: 'emailAddress',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    blurb: 'List calendars, find free time, create and move events.',
    category: 'calendar',
    auth: 'oauth',
    accent: '#4285f4',
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    docsUrl: 'https://developers.google.com/calendar/api/v3/reference',
    fields: [
      { key: 'clientId', label: 'OAuth client id', placeholder: '1234-abc.apps.googleusercontent.com', required: true },
      { key: 'clientSecret', label: 'OAuth client secret', secret: true, required: true, hint: 'Same Google client works for Gmail and Calendar.' },
    ],
    style: 'bearer',
    oauth: { ...GOOGLE_OAUTH, scopes: ['https://www.googleapis.com/auth/calendar'] },
    probe: { path: '/calendars/primary' },
    accountPath: 'id',
  },
  {
    id: 'outlook',
    name: 'Outlook Mail',
    blurb: 'Search, read, draft and send mail through Microsoft Graph.',
    category: 'email',
    auth: 'oauth',
    accent: '#0f6cbd',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview',
    fields: [
      { key: 'clientId', label: 'Entra client id', placeholder: '00000000-0000-0000-0000-000000000000', required: true },
      {
        key: 'clientSecret',
        label: 'Entra client secret',
        secret: true,
        required: true,
        hint: 'One Entra app works for both Outlook Mail and Calendar.',
      },
    ],
    style: 'bearer',
    oauth: {
      authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send'],
    },
    probe: { path: '/me' },
    accountPath: 'userPrincipalName',
  },
  {
    id: 'outlook-calendar',
    name: 'Outlook Calendar',
    blurb: 'Read calendars, find meeting times and create or move events.',
    category: 'calendar',
    auth: 'oauth',
    accent: '#4f93d1',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/calendar',
    fields: [
      { key: 'clientId', label: 'Entra client id', placeholder: '00000000-0000-0000-0000-000000000000', required: true },
      {
        key: 'clientSecret',
        label: 'Entra client secret',
        secret: true,
        required: true,
        hint: 'One Entra app works for both Outlook Mail and Calendar.',
      },
    ],
    style: 'bearer',
    oauth: {
      authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'https://graph.microsoft.com/Calendars.ReadWrite'],
    },
    probe: { path: '/me' },
    accountPath: 'userPrincipalName',
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Search pages, read databases and file notes where your team looks.',
    category: 'comms',
    auth: 'token',
    accent: '#e5e5e5',
    baseUrl: 'https://api.notion.com/v1',
    docsUrl: 'https://developers.notion.com/reference/intro',
    fields: [{ key: 'token', label: 'Internal integration token', placeholder: 'ntn_…', secret: true, required: true }],
    style: 'bearer',
    extraHeaders: { 'Notion-Version': '2022-06-28' },
    probe: { path: '/users/me' },
    accountPath: 'name',
  },
  {
    id: 'slack',
    name: 'Slack',
    blurb: 'Search channels, read threads, post updates as the bot.',
    category: 'comms',
    auth: 'token',
    accent: '#611f69',
    baseUrl: 'https://slack.com/api',
    docsUrl: 'https://api.slack.com/methods',
    fields: [{ key: 'token', label: 'Bot or user token', placeholder: 'xoxb-…', secret: true, required: true }],
    style: 'bearer',
    probe: { path: '/auth.test' },
    accountPath: 'team',
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Issues, pull requests, releases, actions and repository search.',
    category: 'code',
    auth: 'token',
    accent: '#8b949e',
    baseUrl: 'https://api.github.com',
    docsUrl: 'https://docs.github.com/en/rest',
    fields: [{ key: 'token', label: 'Personal access token', placeholder: 'github_pat_…', secret: true, required: true }],
    style: 'bearer',
    extraHeaders: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    probe: { path: '/user' },
    accountPath: 'login',
  },
  {
    id: 'linear',
    name: 'Linear',
    blurb: 'Triage issues, read cycles and write updates through GraphQL.',
    category: 'code',
    auth: 'token',
    accent: '#5e6ad2',
    baseUrl: 'https://api.linear.app/graphql',
    docsUrl: 'https://developers.linear.app/docs/graphql/working-with-the-graphql-api',
    fields: [{ key: 'token', label: 'Personal API key', placeholder: 'lin_api_…', secret: true, required: true }],
    style: 'raw',
    probe: { method: 'POST', path: '', body: { query: '{ viewer { email } }' } },
    accountPath: 'data.viewer.email',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    blurb: 'Deployments, projects, logs and domain state.',
    category: 'cloud',
    auth: 'token',
    accent: '#ededed',
    baseUrl: 'https://api.vercel.com',
    docsUrl: 'https://vercel.com/docs/rest-api',
    fields: [{ key: 'token', label: 'Access token', placeholder: 'vercel token', secret: true, required: true }],
    style: 'bearer',
    probe: { path: '/v2/user' },
    accountPath: 'user.email',
  },
  {
    id: 'railway',
    name: 'Railway',
    blurb: 'Services, deployments and variables through the GraphQL API.',
    category: 'cloud',
    auth: 'token',
    accent: '#a78bfa',
    baseUrl: 'https://backboard.railway.app/graphql/v2',
    docsUrl: 'https://docs.railway.com/reference/public-api',
    fields: [{ key: 'token', label: 'Account or project token', secret: true, required: true }],
    style: 'bearer',
    probe: { method: 'POST', path: '', body: { query: '{ me { email } }' } },
    accountPath: 'data.me.email',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    blurb: 'Project REST tables, storage, functions and SQL via Management API.',
    category: 'data',
    auth: 'token',
    accent: '#3ecf8e',
    docsUrl: 'https://supabase.com/docs/reference',
    fields: [
      { key: 'baseUrl', label: 'Project URL', placeholder: 'https://xyzcompany.supabase.co', required: true },
      { key: 'token', label: 'Service role or anon key', secret: true, required: true },
    ],
    style: 'bearer',
    header: 'apikey',
    probe: { path: '/rest/v1/' },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    blurb: 'Customers, invoices, subscriptions and balance — test or live.',
    category: 'payments',
    auth: 'token',
    accent: '#635bff',
    baseUrl: 'https://api.stripe.com',
    docsUrl: 'https://docs.stripe.com/api',
    fields: [{ key: 'token', label: 'Secret key', placeholder: 'sk_test_…', secret: true, required: true }],
    style: 'bearer',
    encoding: 'form',
    probe: { path: '/v1/balance' },
  },
  {
    id: 'resend',
    name: 'Resend',
    blurb: 'Send transactional email and inspect delivered messages.',
    category: 'email',
    auth: 'token',
    accent: '#f3f4f6',
    baseUrl: 'https://api.resend.com',
    docsUrl: 'https://resend.com/docs/api-reference/introduction',
    fields: [{ key: 'token', label: 'API key', placeholder: 're_…', secret: true, required: true }],
    style: 'bearer',
    probe: { path: '/domains' },
    accountPath: 'data.0.name',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    blurb: 'Issues, events and release health for the projects you run.',
    category: 'monitoring',
    auth: 'token',
    accent: '#f97316',
    baseUrl: 'https://sentry.io/api/0',
    docsUrl: 'https://docs.sentry.io/api/',
    fields: [{ key: 'token', label: 'Auth token', secret: true, required: true }],
    style: 'bearer',
    probe: { path: '/organizations/' },
    accountPath: '0.slug',
  },
];

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  'email',
  'calendar',
  'code',
  'cloud',
  'data',
  'comms',
  'payments',
  'monitoring',
];

interface StoredConnector {
  fields: Record<string, string>;
  tokens?: string;
  connectedAt: number;
  account?: string;
  lastCheck?: number;
  error?: string;
}

interface State {
  connectors: Record<string, StoredConnector>;
}

function state(): State {
  const loaded = readKV<State>('connectors', { connectors: {} });
  return { connectors: loaded.connectors ?? {} };
}

function save(next: State) {
  writeKV('connectors', next);
}

export function definitionOf(id: string): ConnectorDefinition {
  const found = CONNECTORS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown connector: ${id}`);
  return found;
}

function values(stored?: StoredConnector): Record<string, string> {
  if (!stored) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored.fields ?? {})) out[key] = open(value);
  return out;
}

export function connectorInfos(): ConnectorInfo[] {
  const all = state().connectors;
  return CONNECTORS.map((definition) => {
    const stored = all[definition.id];
    const filled = values(stored);
    return {
      definition,
      connected: !!stored && Object.keys(filled).length > 0,
      account: stored?.account,
      connectedAt: stored?.connectedAt,
      lastCheck: stored?.lastCheck,
      error: stored?.error,
      set: Object.keys(filled).filter((key) => !!filled[key]),
    };
  });
}

export function connectedConnectorIds(): string[] {
  const all = state().connectors;
  return CONNECTORS.filter((definition) => !!all[definition.id]).map((definition) => definition.id);
}

export function connectedConnectorSummary(): { id: string; name: string; baseUrl: string; docsUrl: string; api: string }[] {
  const all = state().connectors;
  return CONNECTORS.filter((definition) => !!all[definition.id]).map((definition) => ({
    id: definition.id,
    name: definition.name,
    baseUrl: values(all[definition.id]).baseUrl || definition.baseUrl || '',
    docsUrl: definition.docsUrl,
    api: all[definition.id]?.account ?? 'connected',
  }));
}

export function saveConnector(id: string, input: Record<string, unknown>): ConnectorInfo {
  const definition = definitionOf(id);
  const current = state();
  const previous = current.connectors[id];
  const fields = { ...(previous?.fields ?? {}) };

  for (const field of definition.fields) {
    const raw = input[field.key];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;
    fields[field.key] = seal(value);
  }

  for (const field of definition.fields) {
    if (field.required && !fields[field.key]) throw new Error(`${field.label} is required.`);
  }

  current.connectors[id] = {
    fields,
    tokens: previous?.tokens,
    connectedAt: previous?.connectedAt ?? Date.now(),
    account: previous?.account,
    lastCheck: previous?.lastCheck,
    error: undefined,
  };
  save(current);
  return connectorInfos().find((entry) => entry.definition.id === id)!;
}

export function disconnectConnector(id: string): boolean {
  const current = state();
  if (!current.connectors[id]) return false;
  delete current.connectors[id];
  save(current);
  return true;
}

// --- OAuth -------------------------------------------------------------------

const oauthStates = new Map<string, { id: string; at: number }>();

function appOrigin(): string {
  return (process.env.VESPER_PUBLIC_URL ?? `http://127.0.0.1:${process.env.VESPER_PORT ?? 8787}`).replace(/\/$/, '');
}

export function oauthRedirectUri(): string {
  return `${appOrigin()}/api/connectors/oauth/callback`;
}

export function oauthStart(id: string): { url: string } {
  const definition = definitionOf(id);
  if (!definition.oauth) throw new Error(`${definition.name} does not use OAuth.`);
  const stored = state().connectors[id];
  const filled = values(stored);
  if (!filled.clientId || !filled.clientSecret) throw new Error('Save the OAuth client id and secret first.');

  const stateValue = randomUUID();
  oauthStates.set(stateValue, { id, at: Date.now() });
  // Expire abandoned attempts instead of letting the map grow forever.
  for (const [key, entry] of oauthStates) if (Date.now() - entry.at > 10 * 60_000) oauthStates.delete(key);

  const url = new URL(definition.oauth.authorizeUrl);
  url.searchParams.set('client_id', filled.clientId);
  url.searchParams.set('redirect_uri', oauthRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', definition.oauth.scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', stateValue);
  return { url: url.toString() };
}

export async function oauthFinish(code: string, stateValue: string): Promise<{ id: string; error?: string }> {
  const pending = oauthStates.get(stateValue);
  if (!pending) throw new Error('This sign-in link expired. Start the connection again.');
  oauthStates.delete(stateValue);
  const definition = definitionOf(pending.id);
  if (!definition.oauth) throw new Error('Not an OAuth connector.');
  const stored = state().connectors[pending.id];
  const filled = values(stored);
  if (!filled.clientId || !filled.clientSecret) throw new Error('OAuth client credentials are missing.');

  const body = new URLSearchParams({
    code,
    client_id: filled.clientId,
    client_secret: filled.clientSecret,
    redirect_uri: oauthRedirectUri(),
    grant_type: 'authorization_code',
  });
  const response = await fetch(definition.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}): ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new Error('Google did not return an access token.');

  const current = state();
  current.connectors[pending.id] = {
    ...(current.connectors[pending.id] ?? { fields: {}, connectedAt: Date.now() }),
    tokens: seal(
      JSON.stringify({
        access: parsed.access_token,
        refresh: parsed.refresh_token ?? '',
        expiry: Date.now() + (parsed.expires_in ?? 3600) * 1000,
      }),
    ),
    connectedAt: Date.now(),
    error: undefined,
  };
  save(current);

  try {
    await probeConnector(pending.id);
    return { id: pending.id };
  } catch (err) {
    return { id: pending.id, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- requests ----------------------------------------------------------------

function credentialHeaders(definition: ConnectorDefinition, credential: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (definition.style === 'raw') headers.authorization = credential;
  else if (definition.style === 'header' && definition.header) headers[definition.header.toLowerCase()] = credential;
  else headers.authorization = `Bearer ${credential}`;
  // Supabase wants the same key in `apikey` as well as the bearer token.
  if (definition.header) headers[definition.header.toLowerCase()] = credential;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function accessToken(definition: ConnectorDefinition, stored: StoredConnector, filled: Record<string, string>): Promise<string> {
  if (definition.auth === 'token') return filled.token ?? '';
  const raw = stored.tokens ? open(stored.tokens) : '';
  if (!raw) throw new Error(`${definition.name} is not signed in yet.`);
  const tokens = JSON.parse(raw) as { access: string; refresh?: string; expiry?: number };
  if (tokens.expiry && tokens.expiry - 60_000 > Date.now()) return tokens.access;
  if (!tokens.refresh) throw new Error(`${definition.name} needs to be reconnected — the token expired.`);

  const response = await fetch(definition.oauth!.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: filled.clientId ?? '',
      client_secret: filled.clientSecret ?? '',
      refresh_token: tokens.refresh,
      grant_type: 'refresh_token',
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Token refresh failed (${response.status}): ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text) as { access_token: string; expires_in?: number };
  const next = {
    access: parsed.access_token,
    refresh: tokens.refresh,
    expiry: Date.now() + (parsed.expires_in ?? 3600) * 1000,
  };
  const current = state();
  if (current.connectors[definition.id]) {
    current.connectors[definition.id]!.tokens = seal(JSON.stringify(next));
    save(current);
  }
  return next.access;
}

export interface ConnectorResponse {
  status: number;
  body: unknown;
  text: string;
}

export async function connectorRequest(
  id: string,
  options: { method?: string; path: string; query?: Record<string, unknown>; body?: unknown },
): Promise<ConnectorResponse> {
  const definition = definitionOf(id);
  const stored = state().connectors[id];
  if (!stored) throw new Error(`${definition.name} is not connected.`);
  const filled = values(stored);
  const method = (options.method ?? 'GET').toUpperCase();
  const path = String(options.path ?? '').trim();

  const base = (filled.baseUrl || definition.baseUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error(`${definition.name} has no API base URL.`);
  if (path && !path.startsWith('/')) throw new Error('Path must start with /.');

  const isGraphql = definition.baseUrl?.endsWith('/graphql') ?? false;
  const url = new URL(isGraphql ? base : `${base}${path}`);
  if (url.origin !== new URL(base).origin) throw new Error('Refusing to call a host outside this connector.');
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((entry) => url.searchParams.append(key, String(entry)));
    else url.searchParams.set(key, String(value));
  }

  const credential = filled.token ?? '';
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...definition.extraHeaders,
    ...credentialHeaders(definition, credential, definition.auth === 'oauth' ? await accessToken(definition, stored, filled) : undefined),
  };
  let payload: string | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      payload = options.body;
    } else if (definition.encoding === 'form') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = formEncode(options.body).toString();
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }
  }
  if (isGraphql) headers['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* plain text */
    }
    if (!response.ok) {
      throw new Error(`${definition.name} ${method} ${path || '/'} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return { status: response.status, body, text: text.slice(0, 40_000) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeConnector(id: string): Promise<ConnectorInfo> {
  const definition = definitionOf(id);
  const current = state();
  const stored = current.connectors[id];
  if (!stored) throw new Error(`${definition.name} is not connected.`);
  try {
    const result = await connectorRequest(id, {
      method: definition.probe?.method ?? 'GET',
      path: definition.probe?.path ?? '/',
      body: definition.probe?.body,
    });
    const account = definition.accountPath ? pick(result.body, definition.accountPath) : '';
    const latest = state();
    if (latest.connectors[id]) {
      latest.connectors[id]!.account = account || latest.connectors[id]!.account;
      latest.connectors[id]!.lastCheck = Date.now();
      latest.connectors[id]!.error = undefined;
      save(latest);
    }
    return connectorInfos().find((entry) => entry.definition.id === id)!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const latest = state();
    if (latest.connectors[id]) {
      latest.connectors[id]!.lastCheck = Date.now();
      latest.connectors[id]!.error = message;
      save(latest);
    }
    throw new Error(message);
  }
}

/** Stripe and friends take bracketed form fields, not JSON. */
function formEncode(value: unknown, prefix = '', out = new URLSearchParams()): URLSearchParams {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => formEncode(entry, prefix ? `${prefix}[${index}]` : String(index), out));
  } else if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      formEncode(entry, prefix ? `${prefix}[${key}]` : key, out);
    }
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

function pick(value: unknown, path: string): string {
  let cursor: any = value;
  for (const part of path.split('.')) {
    if (cursor === undefined || cursor === null) return '';
    cursor = cursor[part];
  }
  if (cursor === undefined || cursor === null) return '';
  return String(cursor).slice(0, 120);
}
