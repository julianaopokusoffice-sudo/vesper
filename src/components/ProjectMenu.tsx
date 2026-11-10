import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FlaskConical, FolderClosed, PenLine, Plus, SquareCode } from 'lucide-react';
import type { ProjectKind } from '@shared/types';
import { useStore } from '@/lib/store';
import { Modal, cn, inputClass } from './ui';

const KINDS: { id: ProjectKind; label: string; hint: string; icon: typeof FolderClosed }[] = [
  { id: 'code', label: 'Code', hint: 'src/ + notes/ scaffolding', icon: SquareCode },
  { id: 'research', label: 'Research', hint: 'sources/ notes/ drafts/', icon: FlaskConical },
  { id: 'writing', label: 'Writing', hint: 'a clean folder for drafts', icon: PenLine },
  { id: 'general', label: 'General', hint: 'just a folder', icon: FolderClosed },
];

/**
 * A thread's project is its sandbox: the file and shell tools cannot leave it.
 * Keeping that visible in the top bar means nobody runs `rm -rf` in the wrong
 * research folder because they forgot which thread they were in.
 */
export function ProjectMenu() {
  const projects = useStore((s) => s.projects);
  const threadProjects = useStore((s) => s.threadProjects);
  const activeId = useStore((s) => s.activeThreadId);
  const setThreadProject = useStore((s) => s.setThreadProject);
  const createProject = useStore((s) => s.createProject);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('code');
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  const currentId = activeId ? threadProjects[activeId] : undefined;
  const current = projects.find((p) => p.id === currentId);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const project = await createProject(name.trim(), kind);
    setBusy(false);
    if (project) {
      await setThreadProject(activeId, project.id);
      setCreating(false);
      setName('');
      setOpen(false);
    }
  };

  return (
    <div ref={host} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={current ? `${current.kind} project · ${current.path}` : 'Default workspace'}
        className={cn(
          'flex max-w-[190px] items-center gap-1.5 rounded-lg border border-line bg-ink-1000/60 px-2 py-1 transition-colors hover:border-line-strong',
          current ? 'text-fg-2' : 'text-muted',
        )}
      >
        <FolderClosed size={11} className={current ? 'text-accent/90' : 'text-faint'} />
        <span className="truncate text-[11.5px]">{current?.name ?? 'Default workspace'}</span>
        <ChevronDown size={10} className="ml-auto shrink-0 text-faint" />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[260px] overflow-hidden rounded-xl border border-line bg-ink-950/98 p-1 shadow-[var(--shadow-panel)] backdrop-blur-xl">
          <p className="label px-2 pb-1 pt-1.5">isolated workspace</p>
          <button
            onClick={() => {
              void setThreadProject(activeId, null);
              setOpen(false);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.05]',
              !current ? 'text-fg' : 'text-muted',
            )}
          >
            <FolderClosed size={12} className="text-faint" />
            <span className="flex-1 truncate">Default workspace</span>
            {!current ? <Check size={12} className="text-accent" /> : null}
          </button>

          <div className="my-1 h-px bg-line-soft" />

          <div className="max-h-[220px] space-y-0.5 overflow-y-auto">
            {projects.map((project) => {
              const Icon = KINDS.find((k) => k.id === project.kind)?.icon ?? FolderClosed;
              return (
                <button
                  key={project.id}
                  onClick={() => {
                    void setThreadProject(activeId, project.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]',
                    project.id === currentId ? 'text-fg' : 'text-muted',
                  )}
                >
                  <Icon size={12} className="shrink-0 text-accent/70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{project.name}</span>
                    <span className="block truncate font-mono text-[9px] text-faint">{project.kind}</span>
                  </span>
                  {project.id === currentId ? <Check size={12} className="shrink-0 text-accent" /> : null}
                </button>
              );
            })}
            {!projects.length ? (
              <p className="px-2 py-2 text-[11px] text-faint">No projects yet. Make one and this thread gets its own folder.</p>
            ) : null}
          </div>

          <div className="my-1 h-px bg-line-soft" />
          <button
            onClick={() => {
              setCreating(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg-2 transition-colors hover:bg-white/[0.05]"
          >
            <Plus size={12} className="text-accent" /> New project…
          </button>
        </div>
      ) : null}

      <Modal open={creating} onClose={() => setCreating(false)} title="New project">
        <div className="space-y-4">
          <div>
            <label className="label">name</label>
            <input
              autoFocus
              className={cn(inputClass, 'mt-1')}
              value={name}
              placeholder="Solar adoption study"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
          </div>
          <div>
            <label className="label">kind</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {KINDS.map((entry) => {
                const Icon = entry.icon;
                const active = kind === entry.id;
                return (
                  <button
                    key={entry.id}
                    onClick={() => setKind(entry.id)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      active ? 'border-accent/40 bg-accent-wash' : 'border-line-soft hover:border-line',
                    )}
                  >
                    <Icon size={13} className={active ? 'mt-[2px] text-accent' : 'mt-[2px] text-faint'} />
                    <span>
                      <span className={cn('block text-[12px]', active ? 'text-fg' : 'text-fg-2')}>{entry.label}</span>
                      <span className="block text-[10px] text-faint">{entry.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="rounded-lg border border-line-soft bg-ink-1000/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
            The folder lives under <span className="mono text-[10.5px] text-fg-2">~/.vesper/projects</span>. Files, shell commands and coding
            agents run inside it — nothing above it.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-lg px-3 py-1.5 text-[12px] text-muted hover:text-fg">
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-ink-1000 transition-opacity disabled:opacity-40"
            >
              {busy ? 'creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
