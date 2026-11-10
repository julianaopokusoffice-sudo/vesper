import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, File, Folder, GitBranch, Loader2, RefreshCw, WrapText } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { CodeBlock } from './CodeBlock';
import { Button, Chip, PageHeader, cn } from './ui';

type Entry = { name: string; dir: boolean; size: number; modified: number };

/**
 * The code side of the app. A read-only tree over the workspace plus the three
 * git views an agent needs before it edits anything: status, diff, log. Writes
 * stay with the agent (approval-gated) — this screen is for seeing what is
 * actually there, which is the part chat transcripts are worst at.
 */
export function WorkspaceView() {
  const app = useStore((state) => state.app);
  const toast = useStore((state) => state.toast);
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text: string; truncated: boolean; binary: boolean; bytes: number } | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [git, setGit] = useState<{ status: string; diff: string; log: string; repo: boolean } | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [wrap, setWrap] = useState(false);

  const loadTree = async (target: string) => {
    setLoadingTree(true);
    try {
      const result = await api.tree(target);
      setEntries(result.entries);
      setPath(result.path);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not list the workspace');
      setEntries([]);
    } finally {
      setLoadingTree(false);
    }
  };

  useEffect(() => {
    void loadTree('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setFile(null);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    void api
      .fileText(selected)
      .then((result) => {
        if (!cancelled) setFile(result);
      })
      .catch((err) => {
        if (!cancelled) toast('error', err instanceof Error ? err.message : 'Could not read that file');
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const loadGit = async () => {
    setLoadingGit(true);
    try {
      const [status, diff, log] = await Promise.all([
        api.git('status'),
        api.git('diff'),
        api.git('log', { path: undefined }),
      ]);
      setGit({ status: status.output, diff: diff.output, log: log.output, repo: status.repo });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'git is not available here');
    } finally {
      setLoadingGit(false);
    }
  };

  useEffect(() => {
    if (tab === 'changes' && !git) void loadGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const crumbs = useMemo(() => {
    const parts = path === '.' ? [] : path.split('/').filter(Boolean);
    return [{ label: 'workspace', target: '.' }, ...parts.map((part, index) => ({ label: part, target: parts.slice(0, index + 1).join('/') }))];
  }, [path]);

  const open = (entry: Entry) => {
    if (entry.dir) {
      setSelected(null);
      void loadTree(path === '.' ? entry.name : `${path}/${entry.name}`);
      return;
    }
    setSelected(path === '.' ? entry.name : `${path}/${entry.name}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 py-5 sm:px-8">
        <PageHeader
          title="Workspace"
          meta={<Chip tone="cool">{app?.platform ?? 'local'}</Chip>}
          subtitle={app?.workspace ? `${app.workspace} — files and git state the agents see. Read-only here; edits go through approvals.` : 'Files and git state the agents see.'}
          actions={
            <>
              <div className="flex items-center rounded-lg border border-line bg-ink-1000/60 p-0.5">
                {(['files', 'changes'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setTab(value)}
                    className={cn(
                      'rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                      tab === value ? 'bg-ink-850 text-fg' : 'text-faint hover:text-fg-2',
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (tab === 'files' ? void loadTree(path) : void loadGit())}
                disabled={loadingTree || loadingGit}
              >
                <RefreshCw size={11} className={loadingTree || loadingGit ? 'animate-spin' : ''} /> refresh
              </Button>
            </>
          }
        />
      </div>

      {tab === 'files' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-line-soft md:grid-cols-[280px_1fr]">
          <div className="flex min-h-0 flex-col border-b border-line-soft md:border-b-0 md:border-r">
            <div className="flex flex-wrap items-center gap-0.5 border-b border-line-soft px-2 py-1.5">
              {crumbs.map((crumb, index) => (
                <span key={crumb.target} className="flex items-center gap-0.5">
                  {index > 0 && <ChevronRight size={9} className="text-faint" />}
                  <button
                    onClick={() => {
                      setSelected(null);
                      void loadTree(crumb.target);
                    }}
                    className="rounded px-1 py-0.5 font-mono text-[10px] text-faint hover:bg-white/5 hover:text-fg-2"
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {loadingTree ? (
                <div className="flex items-center gap-2 px-2 py-6 font-mono text-[10px] uppercase tracking-wider text-faint">
                  <Loader2 size={11} className="animate-spin" /> reading
                </div>
              ) : entries.length === 0 ? (
                <p className="px-2 py-6 text-center text-[11.5px] leading-relaxed text-faint">
                  Empty. Point a thread at a project folder, or write files with the agent.
                </p>
              ) : (
                <ul>
                  {entries.map((entry) => {
                    const entryPath = path === '.' ? entry.name : `${path}/${entry.name}`;
                    return (
                      <li key={entry.name}>
                        <button
                          onClick={() => open(entry)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors',
                            selected === entryPath ? 'bg-white/[0.06] text-fg' : 'text-muted hover:bg-white/[0.03] hover:text-fg-2',
                          )}
                        >
                          {entry.dir ? (
                            <Folder size={12} className="shrink-0 text-accent/70" />
                          ) : (
                            <File size={12} className="shrink-0 text-faint" />
                          )}
                          <span className="truncate text-[12px]">{entry.name}</span>
                          {!entry.dir && (
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-faint/70">{size(entry.size)}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {!selected ? (
              <div className="grid h-full min-h-[220px] place-items-center px-6 text-center">
                <div>
                  <File size={22} className="mx-auto text-faint" />
                  <p className="mt-3 font-serif text-[19px] text-fg">Choose a file</p>
                  <p className="mt-1 text-[11.5px] text-muted">Read what the agent will read before you ask it to change things.</p>
                </div>
              </div>
            ) : loadingFile ? (
              <div className="flex items-center gap-2 px-5 py-6 font-mono text-[10px] uppercase tracking-wider text-faint">
                <Loader2 size={12} className="animate-spin" /> opening
              </div>
            ) : file?.binary ? (
              <div className="px-5 py-6">
                <p className="font-serif text-[18px] text-fg">Binary file</p>
                <p className="mt-1 text-[12px] text-muted">{file.bytes.toLocaleString()} bytes — not shown in the browser.</p>
              </div>
            ) : file ? (
              <div className="px-3 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
                  <span className="mono truncate text-[11.5px] text-fg-2">{file.path}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">
                    {size(file.bytes)} {file.truncated ? '· truncated' : ''}
                  </span>
                  <button
                    onClick={() => setWrap((value) => !value)}
                    className={cn(
                      'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider',
                      wrap ? 'text-accent' : 'text-faint hover:text-fg-2',
                    )}
                  >
                    <WrapText size={10} /> wrap
                  </button>
                </div>
                <CodeBlock code={file.text} lang={languageOf(file.path)} className={cn('mt-0', wrap && '[&_pre]:whitespace-pre-wrap')} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft px-4 py-4 sm:px-8">
          {loadingGit && !git ? (
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-faint">
              <Loader2 size={12} className="animate-spin" /> reading git
            </div>
          ) : !git?.repo ? (
            <div className="rounded-xl border border-dashed border-line bg-ink-950/20 px-5 py-8 text-center">
              <GitBranch size={20} className="mx-auto text-faint" />
              <p className="mt-3 font-serif text-[19px] text-fg">No repository yet</p>
              <p className="mx-auto mt-1 max-w-[44ch] text-[11.5px] leading-relaxed text-muted">
                {git?.status ?? 'This workspace is not a git repository.'} Ask an agent to run <span className="mono text-fg-2">git init</span> and make the
                first commit, or attach the thread to a project folder.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="status" hint="working tree" body={git.status} />
              <Panel title="diff" hint="unstaged changes" body={git.diff} lang="diff" />
              <Panel title="log" hint="recent commits" body={git.log} className="lg:col-span-2" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ title, hint, body, lang, className }: { title: string; hint: string; body: string; lang?: string; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="flex items-baseline gap-2">
        <span className="label">{title}</span>
        <span className="font-mono text-[9.5px] text-faint">{hint}</span>
      </div>
      <CodeBlock code={body} lang={lang} className="mt-1.5" />
    </section>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function languageOf(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    rs: 'rust',
    go: 'go',
    diff: 'diff',
  };
  return ext ? map[ext] : undefined;
}
