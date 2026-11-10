import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronUp,
  FileText,
  FolderClosed,
  ImagePlus,
  Mic,
  Plus,
  Sparkles,
  Square,
  Telescope,
  Users2,
  Wrench,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn, Glyph, Kbd, Tooltip } from './ui';

export function Composer() {
  const [value, setValue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const run = useStore((s) => s.run);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const agents = useStore((s) => s.agents);
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeThreadId);
  const setThreadAgent = useStore((s) => s.setThreadAgent);
  const council = useStore((s) => s.council);
  const setCouncil = useStore((s) => s.setCouncil);
  const setMode = useStore((s) => s.setMode);
  const draftImages = useStore((s) => s.draftImages);
  const setDraftImages = useStore((s) => s.setDraftImages);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);
  const projects = useStore((s) => s.projects);
  const threadProjects = useStore((s) => s.threadProjects);
  const skills = useStore((s) => s.skills);
  const setThreadProject = useStore((s) => s.setThreadProject);
  const newThread = useStore((s) => s.newThread);
  const running = run && (run.status === 'streaming' || run.status === 'submitted');

  const [menu, setMenu] = useState<{ kind: 'slash' | 'mention'; query: string; start: number; end: number } | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  /**
   * Voice input uses the browser's own recogniser — no audio leaves the browser
   * process, and Chrome/Edge/Android ship one. The transcript lands in the same
   * composer, so a rough spoken sentence can be edited before it is sent.
   */
  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      toast('info', 'This webview has no built-in recogniser — opening voice mode so you can use your configured speech model.');
      useStore.getState().setView('voice');
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event: any) => {
        const transcript = [...event.results]
          .map((result: any) => result[0]?.transcript ?? '')
          .join(' ')
          .trim();
        if (!transcript) return;
        setValue((current) => (current ? `${current} ${transcript}` : transcript));
        requestAnimationFrame(() => textareaRef.current?.focus());
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => {
        setListening(false);
        toast('error', 'Could not hear that — check microphone permission.');
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch (err) {
      setListening(false);
      toast('error', err instanceof Error ? err.message : 'Microphone unavailable');
    }
  };
  const [files, setFiles] = useState<{ name: string; dir: boolean }[]>([]);

  const activeProject = projects.find((p) => p.id === (activeId ? threadProjects[activeId] : undefined));

  useEffect(() => {
    if (menu?.kind !== 'mention' || files.length) return;
    void api
      .workspace()
      .then((result) => setFiles(result.entries))
      .catch(() => undefined);
  }, [menu?.kind, files.length]);

  /** Tokens are detected at the caret, so mid-sentence mentions work too. */
  const detect = (el: HTMLTextAreaElement) => {
    const text = el.value;
    const caret = el.selectionStart;
    const before = text.slice(0, caret);
    const slash = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(before);
    const mention = /(?:^|\s)@([\w./-]*)$/.exec(before);
    if (slash && before.trimStart().startsWith('/')) {
      setMenu({ kind: 'slash', query: slash[1]!.toLowerCase(), start: caret - slash[1]!.length - 1, end: caret });
      setMenuIndex(0);
      return;
    }
    if (mention) {
      setMenu({ kind: 'mention', query: mention[1]!.toLowerCase(), start: caret - mention[1]!.length - 1, end: caret });
      setMenuIndex(0);
      return;
    }
    setMenu(null);
  };

  /** Replaces the active token and puts the caret after the insertion. */
  const insertToken = (insert: string) => {
    const el = textareaRef.current;
    if (!menu || !el) return;
    const next = value.slice(0, menu.start) + insert + value.slice(menu.end);
    setValue(next);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      const position = menu.start + insert.length;
      el.setSelectionRange(position, position);
    });
  };

  type MenuItem = {
    id: string;
    label: string;
    hint: string;
    icon?: React.ReactNode;
    insert?: string;
    run?: () => void;
  };

  const items: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'slash') {
      const base: MenuItem[] = [
        { id: 'new', label: 'New thread', hint: 'start a clean conversation', icon: <Plus size={12} />, run: () => void newThread() },
        { id: 'council', label: 'Council mode', hint: 'parallel agents, then a synthesis pass', icon: <Users2 size={12} />, run: () => void setMode('council') },
        { id: 'single', label: 'Single agent', hint: 'one agent, one answer', icon: <Users2 size={12} />, run: () => void setMode('single') },
        { id: 'image', label: 'Image prompt', hint: 'prefix a generation request', icon: <ImagePlus size={12} />, insert: 'Generate an image: ' },
        { id: 'chart', label: 'Chart from data', hint: 'ask for a chart or scene', icon: <Sparkles size={12} />, insert: 'Turn this into a chart: ' },
        { id: 'doc', label: 'Document export', hint: 'markdown, html or docx', icon: <FileText size={12} />, insert: 'Turn this into a document: ' },
        { id: 'research', label: 'Research brief', hint: 'sources, numbers, write-up', icon: <Sparkles size={12} />, insert: 'Research this and write it up with sources: ' },
      ];
      for (const project of projects) {
        base.push({
          id: `project:${project.id}`,
          label: `Use project: ${project.name}`,
          hint: `${project.kind} · ${project.path}`,
          icon: <FolderClosed size={12} />,
          run: () => {
            void setThreadProject(activeId, project.id);
            setValue('');
          },
        });
      }
      for (const skill of skills.slice(0, 8)) {
        base.push({
          id: `skill:${skill.id}`,
          label: `Skill: ${skill.name}`,
          hint: skill.description.slice(0, 70),
          icon: <Sparkles size={12} />,
          insert: `Use the skill \`${skill.id}\`. `,
        });
      }
      return base.filter((item) => menu.query ? item.label.toLowerCase().includes(menu.query) || item.id.includes(menu.query) : true);
    }

    const mentions: MenuItem[] = [];
    for (const option of agents) {
      mentions.push({
        id: `agent:${option.id}`,
        label: `@${option.name}`,
        hint: `${option.role} · ${option.description.slice(0, 50)}`,
        icon: <Glyph agent={option} size="sm" />,
        run: () => {
          void setThreadAgent(option.id);
          setCouncil(council.includes(option.id) ? council : [...council, option.id]);
          insertToken(`@${option.name} `);
        },
      });
    }
    for (const entry of files) {
      if (entry.dir) {
        mentions.push({
          id: `dir:${entry.name}`,
          label: `@${entry.name}/`,
          hint: 'folder in the active workspace',
          icon: <FolderClosed size={12} />,
          insert: `@${entry.name}/`,
        });
      } else {
        mentions.push({
          id: `file:${entry.name}`,
          label: `@${entry.name}`,
          hint: 'file in the active workspace',
          icon: <FileText size={12} />,
          insert: `@${entry.name}`,
        });
      }
    }
    return mentions.filter((item) => (menu.query ? item.label.toLowerCase().includes(menu.query) : true)).slice(0, 8);
  }, [menu, agents, projects, skills, files, activeProject?.id, activeId]);

  const choose = (item: MenuItem) => {
    if (item.run) {
      item.run();
      setMenu(null);
      return;
    }
    if (item.insert !== undefined) insertToken(item.insert);
  };

  const thread = threads.find((t) => t.id === activeId);
  const mode = thread?.mode ?? 'single';
  const agent = agents.find((a) => a.id === thread?.agentId) ?? agents[0];

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [value]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === textareaRef.current) {
        textareaRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    if (running) return;
    const text = value.trim();
    if (!text && !draftImages.length) return;
    setValue('');
    const images = draftImages;
    void send(text, images);
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, 4 - draftImages.length);
    const chosen = Array.from(files).slice(0, room);
    const read = await Promise.all(
      chosen.map(
        (file) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    const kept = read.filter((result): result is string => !!result && result.length < 12_000_000);
    setDraftImages([...draftImages, ...kept]);
    if (kept.length < chosen.length) toast('error', 'Images over 12 MB were dropped.');
  };

  return (
    <div className="relative z-10 shrink-0 px-3 pb-3 pt-1 sm:px-5 sm:pb-4">
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-ink-1000 to-transparent" />
      <div className="mx-auto max-w-[52rem]">
        <div
          className={cn(
            'focus-ring relative rounded-2xl border border-line bg-ink-900/85 shadow-panel backdrop-blur-xl transition-all',
            running && 'border-accent/25',
          )}
        >
          {draftImages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3.5 pt-3">
              {draftImages.map((image, index) => (
                <div key={index} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-line bg-ink-950">
                  <img src={image} alt="attachment" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setDraftImages(draftImages.filter((_, i) => i !== index))}
                    aria-label="Remove image"
                    className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-1000/80 text-fg opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {menu && items.length ? (
            <div className="absolute bottom-[calc(100%+8px)] left-2 right-2 z-30 overflow-hidden rounded-xl border border-line bg-ink-900/98 shadow-panel backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-line-soft px-2.5 py-1.5">
                <span className="label">
                  {menu.kind === 'slash' ? 'commands' : 'mention'} · {activeProject?.name ?? 'default workspace'}
                </span>
                <span className="font-mono text-[9px] text-faint">↑↓ · ↵</span>
              </div>
              <div className="max-h-[240px] overflow-y-auto p-1">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMenuIndex(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                      index === menuIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.035]',
                    )}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line-soft text-faint">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-fg-2">{item.label}</span>
                      <span className="block truncate font-mono text-[9.5px] text-faint">{item.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            onChange={(event) => {
              setValue(event.target.value);
              detect(event.target);
            }}
            onKeyDown={(event) => {
              if (menu && items.length) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMenuIndex((index) => (index + 1) % items.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMenuIndex((index) => (index - 1 + items.length) % items.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  choose(items[Math.min(menuIndex, items.length - 1)]!);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMenu(null);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            onBlur={() => setMenu(null)}
            placeholder={
              running
                ? 'Streaming… press stop to interrupt'
                : mode === 'council'
                  ? `Ask ${council.length || 3} agents at once — they answer in parallel, then a chair merges them`
                  : `Ask ${agent?.name ?? 'an agent'} anything — ⌘↵ to send`
            }
            className="w-full bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-[1.6] text-fg outline-none placeholder:text-faint/75"
          />

          <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void attach(event.target.files);
                event.target.value = '';
              }}
            />
            <Tooltip text="Attach images (vision)" side="top">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach images"
                className="grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/[0.05] hover:text-fg-2"
              >
                <ImagePlus size={14} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip text={listening ? 'Stop dictating' : 'Dictate — speak the request'} side="top">
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={listening ? 'Stop dictating' : 'Dictate'}
                aria-pressed={listening}
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-lg transition-colors',
                  listening ? 'bg-danger/15 text-danger pulse-dot' : 'text-faint hover:bg-white/[0.05] hover:text-fg-2',
                )}
              >
                <Mic size={14} strokeWidth={1.8} />
              </button>
            </Tooltip>
            {mode === 'single' ? (
              <div className="relative">
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-line-soft bg-ink-950/60 py-1 pl-1 pr-2 transition-colors hover:border-line"
                >
                  {agent && <Glyph agent={agent} size="sm" />}
                  <span className="text-[11.5px] text-fg-2">{agent?.name ?? 'Agent'}</span>
                  <ChevronUp size={11} className={cn('text-faint transition-transform', pickerOpen && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {pickerOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.99 }}
                        transition={{ duration: 0.14 }}
                        className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[280px] overflow-hidden rounded-xl border border-line bg-ink-900 shadow-panel"
                      >
                        <div className="border-b border-line-soft px-3 py-2">
                          <span className="label">Send this thread to</span>
                        </div>
                        <div className="max-h-[260px] overflow-y-auto p-1">
                          {agents.map((option) => (
                            <button
                              key={option.id}
                              onClick={() => {
                                void setThreadAgent(option.id);
                                setPickerOpen(false);
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]',
                                option.id === agent?.id && 'bg-white/[0.035]',
                              )}
                            >
                              <Glyph agent={option} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[12px] text-fg">{option.name}</span>
                                <span className="block truncate text-[10.5px] text-faint">{option.description}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={() => setMode('single')}
                className="flex items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/[0.07] py-1 pl-1.5 pr-2 transition-colors hover:bg-accent/10"
              >
                {mode === 'research' ? <Telescope size={11} className="text-accent" /> : <Users2 size={11} className="text-accent" />}
                <span className="text-[11.5px] text-accent">
                  {mode === 'research' ? 'Deep research' : `Council · ${council.length}`}
                </span>
              </button>
            )}

            {mode === 'council' && (
              <div className="hidden items-center gap-0.5 sm:flex">
                {agents.map((option) => {
                  const on = council.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      onClick={() => setCouncil(on ? council.filter((id) => id !== option.id) : [...council, option.id])}
                      className={cn('-ml-1 rounded transition-opacity first:ml-0', on ? 'opacity-100' : 'opacity-30 hover:opacity-60')}
                      title={`${on ? 'Remove' : 'Add'} ${option.name}`}
                    >
                      <Glyph agent={option} size="sm" />
                    </button>
                  );
                })}
              </div>
            )}

            <Tooltip text="Tools are chosen by the model and executed locally">
              <span className="ml-1 hidden items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-faint/80 sm:flex">
                <Wrench size={10} /> tools on
              </span>
            </Tooltip>

            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden items-center gap-1 font-mono text-[9.5px] text-faint/70 md:flex">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </span>
              {running ? (
                <button
                  onClick={stop}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-danger/35 bg-danger/10 px-2.5 text-[11.5px] text-danger transition-colors hover:bg-danger/20"
                >
                  <Square size={9} fill="currentColor" /> Stop
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={!value.trim() && !draftImages.length}
                  aria-label="Send"
                  className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[oklch(0.2_0.05_78)] shadow-[0_6px_16px_-8px_oklch(0.805_0.148_78/0.9)] transition-all hover:brightness-105 active:translate-y-px disabled:pointer-events-none disabled:opacity-25"
                >
                  <ArrowUp size={15} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between px-1.5 font-mono text-[9.5px] text-faint/70">
          <span>
            <span className="text-fg-2/70">/</span> commands · <span className="text-fg-2/70">@</span> agents & files · tools pause for approval
          </span>
          <span className="hidden sm:inline">shift+↵ for a new line</span>
        </div>
      </div>
    </div>
  );
}
