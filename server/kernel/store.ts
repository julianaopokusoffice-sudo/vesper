import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { PATHS, ensureDirs } from './paths.ts';
import type {
  Agent,
  Automation,
  LibraryEntry,
  LibraryStatus,
  LinkAuditEntry,
  MemoryEntry,
  Message,
  NodeKind,
  NodeScope,
  PairedNode,
  RunMode,
  Settings,
  Thread,
  Usage,
} from '../../shared/types.ts';

type Row = Record<string, any>;

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: { provider: 'demo', id: 'vesper-demo-1' },
  wallpaper: 'aurora',
  speakReplies: false,
  councilSize: 3,
  theme: 'dark',
  reduceMotion: false,
  showInspector: true,
  systemPreamble: 'Answer directly. Prefer concrete examples over abstraction. Cite sources when you used tools.',
  maxSteps: 6,
  temperature: 0.7,
  image: { backend: 'off', baseURL: 'http://127.0.0.1:8080', model: '', steps: 20, size: '1024x1024' },
  voice: {
    stt: 'browser',
    tts: 'browser',
    baseURL: 'http://127.0.0.1:8081/v1',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    character: 'aura',
    visual: 'character',
    autoListen: true,
  },
};

/**
 * Single SQLite database for threads, messages, custom agents, and settings.
 * Uses Node's built-in `node:sqlite` so there is no native build step and the
 * exact same storage works inside Electron's bundled Node.
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(file = PATHS.db) {
    ensureDirs();
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'single',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        agent_id TEXT,
        lane TEXT,
        content TEXT NOT NULL DEFAULT '',
        reasoning TEXT,
        traces TEXT NOT NULL DEFAULT '[]',
        usage TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, seq);
    `);
    // Columns added after the fact for existing databases; SQLite has no IF NOT EXISTS for columns.
    for (const sql of ["ALTER TABLE messages ADD COLUMN images TEXT", "ALTER TABLE messages ADD COLUMN sources TEXT"]) {
      try {
        this.db.exec(sql);
      } catch {
        /* already present */
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL,
        source_node_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_updated ON memory(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_hash ON memory(hash);
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        outbound TEXT NOT NULL DEFAULT '',
        scopes TEXT NOT NULL DEFAULT '[]',
        granted TEXT NOT NULL DEFAULT '[]',
        paired_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS link_audit (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        direction TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_name TEXT NOT NULL,
        action TEXT NOT NULL,
        ok INTEGER NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_audit_at ON link_audit(at DESC);
      CREATE TABLE IF NOT EXISTS library (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '[]',
        year INTEGER,
        venue TEXT,
        doi TEXT,
        url TEXT,
        pdf TEXT,
        abstract TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'inbox',
        source TEXT NOT NULL DEFAULT 'manual',
        citations INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_library_updated ON library(updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_library_doi ON library(doi) WHERE doi IS NOT NULL AND doi <> '';
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'atlas',
        every_minutes INTEGER NOT NULL DEFAULT 1440,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        last_status TEXT,
        last_output TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Older databases predate these columns.
    for (const sql of [
      "ALTER TABLE nodes ADD COLUMN granted TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE nodes ADD COLUMN outbound TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.db.exec(sql);
      } catch {
        /* already present */
      }
    }
  }

  // ---- threads -------------------------------------------------------------

  listThreads(): Thread[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
                (SELECT content FROM messages m WHERE m.thread_id = t.id AND m.role = 'user' ORDER BY seq DESC LIMIT 1) AS preview
         FROM threads t ORDER BY t.pinned DESC, t.updated_at DESC`,
      )
      .all() as Row[];
    return rows.map(mapThread);
  }

  getThread(id: string): Thread | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Row | undefined;
    return row ? mapThread(row) : null;
  }

  createThread(input: { title?: string; agentId: string; mode?: RunMode }): Thread {
    const now = Date.now();
    const thread: Thread = {
      id: randomUUID(),
      title: input.title?.trim() || 'Untitled thread',
      agentId: input.agentId,
      mode: input.mode ?? 'single',
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare('INSERT INTO threads (id, title, agent_id, mode, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(thread.id, thread.title, thread.agentId, thread.mode, 0, now, now);
    return { ...thread, messageCount: 0 };
  }

  updateThread(id: string, patch: Partial<Pick<Thread, 'title' | 'agentId' | 'mode' | 'pinned'>>): Thread | null {
    const current = this.getThread(id);
    if (!current) return null;
    const next: Thread = {
      ...current,
      title: patch.title ?? current.title,
      agentId: patch.agentId ?? current.agentId,
      mode: patch.mode ?? current.mode,
      pinned: patch.pinned ?? current.pinned,
      updatedAt: Date.now(),
    };
    this.db
      .prepare('UPDATE threads SET title=?, agent_id=?, mode=?, pinned=?, updated_at=? WHERE id=?')
      .run(next.title, next.agentId, next.mode, next.pinned ? 1 : 0, next.updatedAt, id);
    return next;
  }

  touchThread(id: string) {
    this.db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(Date.now(), id);
  }

  deleteThread(id: string) {
    this.db.prepare('DELETE FROM threads WHERE id=?').run(id);
  }

  // ---- messages ------------------------------------------------------------

  listMessages(threadId: string): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY seq ASC')
      .all(threadId) as Row[];
    return rows.map(mapMessage);
  }

  addMessage(input: Omit<Message, 'seq' | 'createdAt'> & { createdAt?: number }): Message {
    const seq =
      ((this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE thread_id=?').get(input.threadId) as Row).s as number) + 1;
    const message: Message = {
      ...input,
      createdAt: input.createdAt ?? Date.now(),
      seq,
    };
    this.db
      .prepare(
        'INSERT INTO messages (id, thread_id, role, agent_id, lane, content, reasoning, images, traces, usage, model, sources, created_at, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        message.id,
        message.threadId,
        message.role,
        message.agentId ?? null,
        message.lane ?? null,
        message.content,
        message.reasoning ?? null,
        message.images?.length ? JSON.stringify(message.images) : null,
        JSON.stringify(message.traces ?? []),
        message.usage ? JSON.stringify(message.usage) : null,
        message.model ?? null,
        message.sources?.length ? JSON.stringify(message.sources) : null,
        message.createdAt,
        seq,
      );
    this.touchThread(input.threadId);
    return message;
  }

  deleteMessages(threadId: string, ids: string[]) {
    const stmt = this.db.prepare('DELETE FROM messages WHERE thread_id=? AND id=?');
    for (const id of ids) stmt.run(threadId, id);
  }

  /** Drop the trailing assistant turns so a regenerate produces a clean run. */
  truncateAfterLastUser(threadId: string) {
    const rows = this.db.prepare('SELECT id, role, seq FROM messages WHERE thread_id=? ORDER BY seq DESC').all(threadId) as Row[];
    const victims: string[] = [];
    let sawUser = false;
    for (const row of rows) {
      if (row.role === 'user') {
        if (sawUser) break;
        sawUser = true;
        continue;
      }
      victims.push(row.id);
    }
    for (const id of victims) this.db.prepare('DELETE FROM messages WHERE id=?').run(id);
  }

  // ---- research library ----------------------------------------------------

  listLibrary(input?: { query?: string; status?: string; tag?: string; limit?: number }): LibraryEntry[] {
    const limit = Math.min(Math.max(input?.limit ?? 300, 1), 1000);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (input?.query?.trim()) {
      const q = `%${input.query.trim().toLowerCase()}%`;
      where.push('(lower(title) LIKE ? OR lower(authors) LIKE ? OR lower(abstract) LIKE ? OR lower(note) LIKE ? OR lower(tags) LIKE ? OR lower(venue) LIKE ?)');
      params.push(q, q, q, q, q, q);
    }
    if (input?.status) {
      where.push('status = ?');
      params.push(input.status);
    }
    if (input?.tag?.trim()) {
      where.push('lower(tags) LIKE ?');
      params.push(`%"${input.tag.trim().toLowerCase()}"%`);
    }
    const sql = `SELECT * FROM library${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as Row[];
    return rows.map(mapLibrary);
  }

  getLibraryEntry(id: string): LibraryEntry | null {
    const row = this.db.prepare('SELECT * FROM library WHERE id = ?').get(id) as Row | undefined;
    return row ? mapLibrary(row) : null;
  }

  /** Dedupe key for an import: DOI first, then normalised title. */
  findLibraryDuplicate(input: { doi?: string; title: string }): LibraryEntry | null {
    const doi = input.doi?.trim().toLowerCase();
    if (doi) {
      const row = this.db.prepare('SELECT * FROM library WHERE lower(doi) = ? LIMIT 1').get(doi) as Row | undefined;
      if (row) return mapLibrary(row);
    }
    const title = input.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!title) return null;
    // Titles differ by punctuation and initials between sources, so compare on
    // the first 60 characters rather than requiring an exact match.
    const prefix = title.slice(0, 60);
    const rows = this.db.prepare('SELECT * FROM library WHERE lower(title) LIKE ? LIMIT 20').all(`%${prefix.replace(/[%_]/g, '')}%`) as Row[];
    const match = rows.find((row) => String(row.title).trim().toLowerCase().replace(/\s+/g, ' ') === title);
    return match ? mapLibrary(match) : null;
  }

  saveLibraryEntry(entry: LibraryEntry): LibraryEntry {
    this.db
      .prepare(
        `INSERT INTO library (id, title, authors, year, venue, doi, url, pdf, abstract, tags, note, status, source, citations, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, authors=excluded.authors, year=excluded.year, venue=excluded.venue,
           doi=excluded.doi, url=excluded.url, pdf=excluded.pdf, abstract=excluded.abstract,
           tags=excluded.tags, note=excluded.note, status=excluded.status, source=excluded.source,
           citations=excluded.citations, updated_at=excluded.updated_at`,
      )
      .run(
        entry.id,
        entry.title,
        JSON.stringify(entry.authors ?? []),
        entry.year ?? null,
        entry.venue ?? null,
        entry.doi ?? null,
        entry.url ?? null,
        entry.pdf ?? null,
        entry.abstract ?? null,
        JSON.stringify(entry.tags ?? []),
        entry.note ?? '',
        entry.status,
        entry.source,
        entry.citations ?? null,
        entry.createdAt,
        entry.updatedAt,
      );
    return this.getLibraryEntry(entry.id)!;
  }

  deleteLibraryEntry(id: string) {
    this.db.prepare('DELETE FROM library WHERE id = ?').run(id);
  }

  libraryStats() {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'reading' THEN 1 ELSE 0 END) AS reading,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read,
                SUM(CASE WHEN status = 'inbox' THEN 1 ELSE 0 END) AS inbox
         FROM library`,
      )
      .get() as Row;
    return {
      total: Number(row.total ?? 0),
      reading: Number(row.reading ?? 0),
      read: Number(row.read ?? 0),
      inbox: Number(row.inbox ?? 0),
    };
  }

  // ---- automations ---------------------------------------------------------

  listAutomations(): Automation[] {
    const rows = this.db.prepare('SELECT * FROM automations ORDER BY created_at ASC').all() as Row[];
    return rows.map(mapAutomation);
  }

  getAutomation(id: string): Automation | null {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Row | undefined;
    return row ? mapAutomation(row) : null;
  }

  saveAutomation(entry: Automation): Automation {
    this.db
      .prepare(
        `INSERT INTO automations (id, name, prompt, agent_id, every_minutes, enabled, next_run_at, last_run_at, last_status, last_output, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, prompt=excluded.prompt, agent_id=excluded.agent_id,
           every_minutes=excluded.every_minutes, enabled=excluded.enabled, next_run_at=excluded.next_run_at,
           last_run_at=excluded.last_run_at, last_status=excluded.last_status, last_output=excluded.last_output,
           updated_at=excluded.updated_at`,
      )
      .run(
        entry.id,
        entry.name,
        entry.prompt,
        entry.agentId,
        entry.everyMinutes,
        entry.enabled ? 1 : 0,
        entry.nextRunAt,
        entry.lastRunAt ?? null,
        entry.lastStatus ?? null,
        entry.lastOutput ?? null,
        entry.createdAt,
        entry.updatedAt,
      );
    return this.getAutomation(entry.id)!;
  }

  deleteAutomation(id: string) {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
  }

  // ---- custom agents -------------------------------------------------------

  customAgents(): Agent[] {
    const rows = this.db.prepare('SELECT json FROM agents ORDER BY created_at ASC').all() as Row[];
    return rows.map((r) => JSON.parse(r.json) as Agent);
  }

  saveAgent(agent: Agent) {
    this.db
      .prepare('INSERT INTO agents (id, json, created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
      .run(agent.id, JSON.stringify(agent), agent.createdAt ?? Date.now());
  }

  deleteAgent(id: string) {
    this.db.prepare('DELETE FROM agents WHERE id=?').run(id);
  }

  // ---- settings ------------------------------------------------------------

  settings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...stored } as Settings;
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    const stmt = this.db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [key, value] of Object.entries(next)) stmt.run(key, JSON.stringify(value));
    return next;
  }

  // ---- shared memory -------------------------------------------------------

  listMemory(input?: { query?: string; limit?: number }): MemoryEntry[] {
    const limit = Math.min(Math.max(input?.limit ?? 200, 1), 500);
    const query = input?.query?.trim().toLowerCase();
    const rows = query
      ? (this.db
          .prepare(
            `SELECT * FROM memory
             WHERE lower(title) LIKE ? OR lower(body) LIKE ? OR lower(tags) LIKE ?
             ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
          )
          .all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as Row[])
      : (this.db.prepare('SELECT * FROM memory ORDER BY pinned DESC, updated_at DESC LIMIT ?').all(limit) as Row[]);
    return rows.map(mapMemory);
  }

  getMemory(id: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memory WHERE id = ?').get(id) as Row | undefined;
    return row ? mapMemory(row) : null;
  }

  findByHash(hash: string): MemoryEntry | null {
    const row = this.db.prepare('SELECT * FROM memory WHERE hash = ? LIMIT 1').get(hash) as Row | undefined;
    return row ? mapMemory(row) : null;
  }

  upsertMemory(entry: MemoryEntry): MemoryEntry {
    const existing = this.getMemory(entry.id);
    // Last-write-wins per id, but never let an older edit clobber a newer one.
    if (existing && existing.updatedAt > entry.updatedAt) return existing;
    this.db
      .prepare(
        `INSERT INTO memory (id, kind, title, body, tags, source, source_node_id, pinned, created_at, updated_at, hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind, title=excluded.title, body=excluded.body, tags=excluded.tags,
           source=excluded.source, source_node_id=excluded.source_node_id, pinned=excluded.pinned,
           updated_at=excluded.updated_at, hash=excluded.hash`,
      )
      .run(
        entry.id,
        entry.kind,
        entry.title,
        entry.body,
        JSON.stringify(entry.tags ?? []),
        entry.source,
        entry.sourceNodeId ?? null,
        entry.pinned ? 1 : 0,
        entry.createdAt,
        entry.updatedAt,
        entry.hash,
      );
    return this.getMemory(entry.id)!;
  }

  deleteMemory(id: string) {
    this.db.prepare('DELETE FROM memory WHERE id = ?').run(id);
  }

  // ---- paired nodes --------------------------------------------------------

  listNodes(): PeerRecord[] {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY last_seen DESC').all() as Row[];
    return rows.map((row) => ({ ...mapNode(row), secret: row.secret as string, outbound: (row.outbound as string) ?? '' }));
  }

  getNode(id: string): PeerRecord | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Row | undefined;
    return row ? { ...mapNode(row), secret: row.secret as string, outbound: (row.outbound as string) ?? '' } : null;
  }

  findNodeByName(name: string): PeerRecord | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE lower(name) = lower(?) LIMIT 1').get(name) as Row | undefined;
    return row ? { ...mapNode(row), secret: row.secret as string, outbound: (row.outbound as string) ?? '' } : null;
  }

  saveNode(node: PeerRecord) {
    this.db
      .prepare(
        `INSERT INTO nodes (id, name, platform, kind, url, secret, outbound, scopes, granted, paired_at, last_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, platform=excluded.platform, kind=excluded.kind, url=excluded.url,
           secret=excluded.secret, outbound=excluded.outbound, scopes=excluded.scopes,
           granted=excluded.granted, last_seen=excluded.last_seen`,
      )
      .run(
        node.id,
        node.name,
        node.platform,
        node.kind,
        node.url,
        node.secret,
        node.outbound ?? '',
        JSON.stringify(node.scopes ?? []),
        JSON.stringify(node.granted ?? []),
        node.pairedAt,
        node.lastSeen,
      );
  }

  updateNode(id: string, patch: Partial<Pick<PairedNode, 'name' | 'url' | 'scopes' | 'granted' | 'lastSeen'>>): PairedNode | null {
    const current = this.getNode(id);
    if (!current) return null;
    const next = {
      ...current,
      name: patch.name ?? current.name,
      url: patch.url ?? current.url,
      scopes: patch.scopes ?? current.scopes,
      granted: patch.granted ?? current.granted,
      lastSeen: patch.lastSeen ?? current.lastSeen,
    };
    this.saveNode(next);
    const { secret: _secret, outbound: _outbound, ...rest } = next;
    return rest;
  }

  deleteNode(id: string) {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  }

  logLink(entry: LinkAuditEntry) {
    this.db
      .prepare('INSERT INTO link_audit (id, at, direction, node_id, node_name, action, ok, detail, ms) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(entry.id, entry.at, entry.direction, entry.nodeId, entry.nodeName, entry.action, entry.ok ? 1 : 0, entry.detail, entry.ms);
    this.db.prepare('DELETE FROM link_audit WHERE id NOT IN (SELECT id FROM link_audit ORDER BY at DESC LIMIT 200)').run();
  }

  listLinkAudit(limit = 40): LinkAuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM link_audit ORDER BY at DESC LIMIT ?').all(limit) as Row[];
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      direction: row.direction,
      nodeId: row.node_id,
      nodeName: row.node_name,
      action: row.action,
      ok: !!row.ok,
      detail: row.detail,
      ms: row.ms,
    }));
  }

  stats() {
    const threads = (this.db.prepare('SELECT COUNT(*) AS n FROM threads').get() as Row).n as number;
    const messages = (this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as Row).n as number;
    const tokens = (this.db
      .prepare("SELECT COALESCE(SUM(JSON_EXTRACT(usage, '$.completionTokens')), 0) AS n FROM messages WHERE usage IS NOT NULL")
      .get() as Row).n as number;
    return { threads, messages, tokens };
  }
}

function mapThread(row: Row): Thread {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agent_id,
    mode: row.mode as RunMode,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preview: row.preview ?? undefined,
    messageCount: row.message_count ?? undefined,
  };
}

function mapMessage(row: Row): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    agentId: row.agent_id ?? undefined,
    lane: (row.lane ?? undefined) as Message['lane'],
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    images: row.images ? safeParse<string[] | undefined>(row.images, undefined) : undefined,
    traces: safeParse(row.traces, []),
    usage: row.usage ? safeParse<Usage | undefined>(row.usage, undefined) : undefined,
    model: row.model ?? undefined,
    sources: row.sources ? safeParse(row.sources, undefined) : undefined,
    createdAt: row.created_at,
    seq: row.seq,
  };
}

/** A peer record, with both directional credentials sealed at rest. */
export type PeerRecord = PairedNode & { secret: string; outbound: string };

function mapMemory(row: Row): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    tags: safeParse<string[]>(row.tags, []),
    source: row.source,
    sourceNodeId: row.source_node_id ?? undefined,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hash: row.hash,
  };
}

function mapAutomation(row: Row): Automation {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentId: row.agent_id,
    everyMinutes: Number(row.every_minutes),
    enabled: !!row.enabled,
    nextRunAt: Number(row.next_run_at),
    lastRunAt: row.last_run_at ?? undefined,
    lastStatus: (row.last_status ?? undefined) as Automation['lastStatus'],
    lastOutput: row.last_output ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLibrary(row: Row): LibraryEntry {
  return {
    id: row.id,
    title: row.title,
    authors: safeParse<string[]>(row.authors, []),
    year: row.year ?? undefined,
    venue: row.venue ?? undefined,
    doi: row.doi ?? undefined,
    url: row.url ?? undefined,
    pdf: row.pdf ?? undefined,
    abstract: row.abstract ?? undefined,
    tags: safeParse<string[]>(row.tags, []),
    note: row.note ?? '',
    status: (row.status ?? 'inbox') as LibraryStatus,
    source: row.source ?? 'manual',
    citations: row.citations ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNode(row: Row): PairedNode {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    kind: row.kind as NodeKind,
    url: row.url,
    scopes: safeParse<NodeScope[]>(row.scopes, []),
    granted: safeParse<NodeScope[]>(row.granted, []),
    pairedAt: row.paired_at,
    lastSeen: row.last_seen,
  };
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

let singleton: Store | null = null;
export function store(): Store {
  singleton ??= new Store();
  return singleton;
}
