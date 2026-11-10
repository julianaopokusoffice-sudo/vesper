import { useEffect, useState } from 'react';
import { ChevronLeft, File, Folder, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn } from './ui';

/**
 * The workspace, beside the conversation. This is the part every serious agent
 * surface has: you should be able to see what the agent is looking at without
 * leaving the thread. The full Workspace view still exists for reading a file
 * properly; this one is for orientation.
 */
export function ChatSidebar({ tab }: { tab: 'files' | 'git' }) {
  return tab === 'files' ? <FilesTab /> : <GitTab />;
}

function FilesTab() {
  const toast = useStore((state) => state.toast);
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<{ name: string; dir: boolean; size: number }[]>([]);
  const [selected, setSelected] = useState<{ path: string; text: string; binary: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (target: string) => {
    setLoading(true);
    try {
      const result = await api.tree(target);
      setEntries(result.entries);
      setPath(result.path);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not list the workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (name: string, dir: boolean) => {
    const next = path === '.' ? name : `${path}/${name}`;
    if (dir) {
      setSelected(null);
      void load(next);
      return;
    }
    try {
      const file = await api.fileText(next);
      setSelected({ path: next, text: file.binary ? '(binary file)' : file.text, binary: file.binary });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
        {path !== '.' && (
          <button
            onClick={() => {
              const parent = path.split('/').slice(0, -1).join('/') || '.';
              setSelected(null);
              void load(parent);
            }}
            className="text-faint hover:text-fg"
            aria-label="Up one level"
          >
            <ChevronLeft size={12} />
          </button>
        )}
        <span className="mono truncate text-[10px] text-faint">{path === '.' ? 'workspace' : path}</span>
        <button onClick={() => void load(path)} className="ml-auto text-faint hover:text-fg" aria-label="Refresh files">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-4 font-mono text-[10px] uppercase tracking-wider text-faint">
            <Loader2 size={10} className="animate-spin" /> reading
          </div>
        ) : entries.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-faint">Empty folder.</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.name}>
                <button
                  onClick={() => void open(entry.name, entry.dir)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-muted transition-colors hover:bg-white/[0.04] hover:text-fg-2"
                >
                  {entry.dir ? <Folder size={11} className="shrink-0 text-accent/70" /> : <File size={11} className="shrink-0 text-faint" />}
                  <span className="truncate text-[11.5px]">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="flex min-h-0 max-h-[45%] flex-col border-t border-line-soft">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="mono truncate text-[10px] text-fg-2">{selected.path}</span>
            <button onClick={() => setSelected(null)} className="ml-auto font-mono text-[9px] uppercase tracking-wider text-faint hover:text-fg-2">
              close
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto border-t border-line-soft bg-ink-1000/60 px-3 py-2 font-mono text-[10px] leading-relaxed text-fg-2">
            {selected.text.slice(0, 20_000)}
          </pre>
        </div>
      )}
    </div>
  );
}

function GitTab() {
  const toast = useStore((state) => state.toast);
  const [status, setStatus] = useState('');
  const [diff, setDiff] = useState('');
  const [repo, setRepo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [statusResult, diffResult] = await Promise.all([api.git('status'), api.git('diff')]);
      setStatus(statusResult.output);
      setDiff(diffResult.output);
      setRepo(statusResult.repo);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'git is unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <GitBranch size={11} className="text-faint" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">working tree</span>
        <button onClick={() => void load()} className="ml-auto text-faint hover:text-fg" aria-label="Refresh git">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setShowDiff((value) => !value)}
          className={cn('font-mono text-[9px] uppercase tracking-wider', showDiff ? 'text-accent' : 'text-faint hover:text-fg-2')}
        >
          diff
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 font-mono text-[10px] uppercase tracking-wider text-faint">
            <Loader2 size={10} className="animate-spin" /> reading git
          </div>
        ) : !repo ? (
          <p className="text-[11px] leading-relaxed text-muted">{status}</p>
        ) : (
          <>
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-fg-2">{status}</pre>
            {showDiff && (
              <pre className="mt-2 whitespace-pre-wrap border-t border-line-soft pt-2 font-mono text-[9.5px] leading-relaxed text-muted">
                {diff}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
