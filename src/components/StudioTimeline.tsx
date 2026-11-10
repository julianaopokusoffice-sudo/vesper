import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Loader2, MessageSquarePlus, Pause, Play, Scissors, Trash2, Upload, Wand2 } from 'lucide-react';
import type { StudioClip, StudioMedia, StudioProject } from '@shared/types';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button, SectionLabel, cn, inputClass } from './ui';

const TRACK_HEIGHT = 58;
const DEFAULT_DURATION = 5;

function blankProject(): StudioProject {
  return {
    id: 'main',
    name: 'Untitled edit',
    width: 1920,
    height: 1080,
    fps: 30,
    updatedAt: 0,
    tracks: [
      { id: 'v1', kind: 'video', clips: [] },
      { id: 'o1', kind: 'overlay', clips: [] },
    ],
  };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function projectEnd(project: StudioProject): number {
  return Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)));
}

/** The clip visible at a time, with overlay winning ties. */
function clipAt(project: StudioProject, time: number): { clip: StudioClip; track: string } | null {
  const order = [...project.tracks].sort((a, b) => (a.kind === 'overlay' ? -1 : 0) - (b.kind === 'overlay' ? -1 : 0));
  for (const track of order) {
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) {
        if (clip.kind === 'audio') continue;
        return { clip, track: track.id };
      }
    }
  }
  return null;
}

function overlayAt(project: StudioProject, time: number): StudioClip | null {
  for (const track of project.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'audio' && time >= clip.start && time < clip.start + clip.duration) return clip;
    }
  }
  return null;
}

/**
 * The edit surface. The timeline is ordinary state — clips have a start, a
 * source in-point and a duration — which is why an agent can read it, reason
 * about it and hand back a new cut. Drag a clip to move it, drag its right edge
 * to trim, drag media from the bin onto a track.
 */
export function TimelineStudio() {
  const toast = useStore((state) => state.toast);
  const send = useStore((state) => state.send);
  const setView = useStore((state) => state.setView);
  const [media, setMedia] = useState<StudioMedia[]>([]);
  const [project, setProject] = useState<StudioProject>(blankProject);
  const [selected, setSelected] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(64);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [asking, setAsking] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const overlayImageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runnerRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const dirtyRef = useRef(false);
  const savedSnapshotRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);

  const total = Math.max(projectEnd(project), 12);
  const active = useMemo(() => clipAt(project, playhead), [project, playhead]);
  const overlay = useMemo(() => overlayAt(project, playhead), [project, playhead]);

  // --- load ---------------------------------------------------------------

  const load = useCallback(async () => {
    try {
      const [mediaResult, studio] = await Promise.all([api.media(), api.studioList()]);
      setMedia(mediaResult.files);
      if (studio.latest) {
        setProject(studio.latest);
        savedSnapshotRef.current = JSON.stringify(studio.latest);
      } else {
        const fresh = blankProject();
        setProject(fresh);
        dirtyRef.current = true;
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not open the studio');
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- save (debounced) ---------------------------------------------------

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      const snapshot = JSON.stringify(project);
      if (snapshot === savedSnapshotRef.current) return;
      setSaving('saving');
      try {
        const result = await api.saveStudio(project);
        savedSnapshotRef.current = JSON.stringify({ ...project, updatedAt: result.project.updatedAt });
        dirtyRef.current = false;
        setProject((current) => ({ ...current, updatedAt: result.project.updatedAt }));
        setSaving('saved');
        window.setTimeout(() => setSaving('idle'), 1600);
      } catch (err) {
        setSaving('idle');
        toast('error', err instanceof Error ? err.message : 'Could not save the timeline');
      }
    }, 700);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [project, toast]);

  const mutate = useCallback((next: StudioProject) => {
    dirtyRef.current = true;
    setProject({ ...next, updatedAt: Date.now() });
  }, []);

  // --- poll for agent edits ----------------------------------------------

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (playing || dirtyRef.current) return;
      try {
        const result = await api.studioProject(project.id);
        if (result.project.updatedAt > project.updatedAt) {
          setProject(result.project);
          savedSnapshotRef.current = JSON.stringify(result.project);
          toast('info', 'The agent updated the timeline');
        }
      } catch {
        /* project may not exist yet */
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [project.id, project.updatedAt, playing, toast]);

  // --- playback -----------------------------------------------------------

  useEffect(() => {
    if (!playing) {
      if (runnerRef.current) cancelAnimationFrame(runnerRef.current);
      runnerRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setPlayhead((current) => {
        const next = current + delta;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      runnerRef.current = requestAnimationFrame(tick);
    };
    runnerRef.current = requestAnimationFrame(tick);
    return () => {
      if (runnerRef.current) cancelAnimationFrame(runnerRef.current);
    };
  }, [playing, total]);

  // Keep the media element at the playhead. A small drift is tolerated so the
  // browser's own decoder can run ahead; a large one is corrected by seeking.
  useEffect(() => {
    const sync = (element: HTMLVideoElement | null, clip: StudioClip | null) => {
      if (!element || !clip) return;
      const target = Math.max(0, clip.in + (playhead - clip.start));
      if (Math.abs(element.currentTime - target) > (playing ? 0.28 : 0.02)) {
        try {
          element.currentTime = target;
        } catch {
          /* metadata not ready */
        }
      }
      if (playing) void element.play().catch(() => undefined);
      else element.pause();
    };
    sync(videoRef.current, active?.clip ?? null);
    sync(overlayVideoRef.current, overlay ?? null);
  }, [playhead, active, overlay, playing]);

  useEffect(() => {
    setPlaying(false);
  }, [selected]);

  // --- media --------------------------------------------------------------

  const upload = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files].filter((file) => /^(video|image|audio)\//.test(file.type));
    if (!list.length) {
      toast('info', 'Drop video, image or audio files');
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadMedia(list);
      setMedia(result.media);
      toast('success', `${result.files.length} file${result.files.length === 1 ? '' : 's'} added to the bin`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const probeDuration = (url: string, kind: StudioClip['kind']): Promise<number> => {
    if (kind === 'image') return Promise.resolve(DEFAULT_DURATION);
    return new Promise((resolve) => {
      const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
      element.preload = 'metadata';
      element.src = url;
      const done = (value: number) => resolve(Number.isFinite(value) && value > 0.1 ? value : DEFAULT_DURATION);
      element.onloadedmetadata = () => done(element.duration);
      element.onerror = () => done(DEFAULT_DURATION);
      window.setTimeout(() => done(element.duration), 4000);
    });
  };

  const addClip = async (item: StudioMedia, trackId: string, start: number) => {
    const duration = await probeDuration(item.url, item.kind);
    const track = project.tracks.find((entry) => entry.id === trackId);
    if (!track) return;
    const clip: StudioClip = {
      id: uid(),
      name: item.name,
      url: item.url,
      kind: item.kind,
      start: Math.max(0, Math.round(start * 20) / 20),
      in: 0,
      duration,
      volume: 1,
      muted: false,
    };
    mutate({
      ...project,
      tracks: project.tracks.map((entry) => (entry.id === trackId ? { ...entry, clips: [...entry.clips, clip] } : entry)),
    });
    setSelected(clip.id);
  };

  const updateClip = (id: string, patch: Partial<StudioClip>) => {
    mutate({
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
      })),
    });
  };

  const removeClip = (id: string) => {
    mutate({ ...project, tracks: project.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== id) })) });
    setSelected(null);
  };

  const splitClip = (id: string) => {
    for (const track of project.tracks) {
      const clip = track.clips.find((entry) => entry.id === id);
      if (!clip) continue;
      const cut = playhead - clip.start;
      if (cut <= 0.15 || cut >= clip.duration - 0.15) {
        toast('info', 'Put the playhead inside the clip to split it');
        return;
      }
      const left: StudioClip = { ...clip, duration: cut };
      const right: StudioClip = {
        ...clip,
        id: uid(),
        start: clip.start + cut,
        in: clip.in + cut,
        duration: clip.duration - cut,
      };
      mutate({
        ...project,
        tracks: project.tracks.map((entry) =>
          entry.id === track.id ? { ...entry, clips: entry.clips.flatMap((item) => (item.id === id ? [left, right] : [item])) } : entry,
        ),
      });
      setSelected(right.id);
      return;
    }
  };

  const allClips = project.tracks.flatMap((track) => track.clips);
  const current = allClips.find((clip) => clip.id === selected) ?? null;

  // --- drag ---------------------------------------------------------------

  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'trim-start' | 'trim-end';
    x: number;
    start: number;
    in: number;
    duration: number;
  } | null>(null);

  const onClipPointerDown = (event: React.PointerEvent, clip: StudioClip, mode: 'move' | 'trim-start' | 'trim-end') => {
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setSelected(clip.id);
    dragRef.current = { id: clip.id, mode, x: event.clientX, start: clip.start, in: clip.in, duration: clip.duration };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = (event.clientX - drag.x) / zoom;
    if (drag.mode === 'move') {
      updateClip(drag.id, { start: Math.max(0, Math.round((drag.start + delta) * 20) / 20) });
    } else if (drag.mode === 'trim-end') {
      updateClip(drag.id, { duration: Math.max(0.2, Math.round((drag.duration + delta) * 20) / 20) });
    } else {
      const shift = Math.min(Math.max(delta, -drag.start), drag.duration - 0.2);
      updateClip(drag.id, {
        start: Math.max(0, Math.round((drag.start + shift) * 20) / 20),
        in: Math.max(0, Math.round((drag.in + shift) * 20) / 20),
        duration: Math.max(0.2, Math.round((drag.duration - shift) * 20) / 20),
      });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // --- agent handoff ------------------------------------------------------

  const captureFrame = (): string | null => {
    const element = overlayVideoRef.current ?? videoRef.current ?? overlayImageRef.current ?? imageRef.current;
    if (!element) return null;
    const width = 'videoWidth' in element ? element.videoWidth : element.naturalWidth;
    const height = 'videoHeight' in element ? element.videoHeight : element.naturalHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, 720 / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  };

  const timelineBrief = () => {
    const lines = [
      `Studio timeline “${project.name}” (${project.width}×${project.height}, ${project.fps}fps). Playhead at ${playhead.toFixed(2)}s of ${projectEnd(project).toFixed(2)}s.`,
    ];
    for (const track of project.tracks) {
      lines.push(`${track.kind} track ${track.id}:`);
      if (!track.clips.length) lines.push('  (empty)');
      for (const clip of track.clips) {
        const mark = clip.id === selected ? '  ← selected' : '';
        lines.push(
          `  - ${clip.name} [${clip.kind}] ${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)}s, source in ${clip.in.toFixed(2)}${mark}`,
        );
      }
    }
    lines.push('Frames attached are the preview at the playhead. Use studio_state for the full JSON and studio_edit to return a revised cut.');
    return lines.join('\n');
  };

  const askAgent = async () => {
    const text = askText.trim();
    if (!text) return;
    setAsking(true);
    try {
      const frame = captureFrame();
      const payload = `${text}\n\n---\n${timelineBrief()}`;
      await send(payload, frame ? [frame] : []);
      setAskText('');
      setAskOpen(false);
      setView('chat');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not reach the agent');
    } finally {
      setAsking(false);
    }
  };

  const duration = projectEnd(project);
  const width = Math.max(total, duration + 4) * zoom;
  const ticks = useMemo(() => {
    const step = zoom < 40 ? 5 : zoom < 90 ? 2 : 1;
    const out: number[] = [];
    for (let second = 0; second <= Math.ceil(total) + 1; second += step) out.push(second);
    return out;
  }, [total, zoom]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_1fr_260px]">
        {/* media bin */}
        <aside className="flex min-h-0 flex-col border-b border-line-soft lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="label">media</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-faint hover:text-accent"
            >
              {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} add
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*,audio/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
          <div
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files);
            }}
          >
            {media.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-line px-3 py-6 text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void upload(event.dataTransfer.files);
                }}
              >
                <Upload size={16} className="mx-auto text-faint" />
                <p className="mt-2 text-[10.5px] leading-relaxed text-muted">Drop footage here, or add files. Nothing leaves this machine.</p>
              </div>
            ) : (
              media.map((item) => (
                <div
                  key={item.name}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-vesper-media', item.name);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="flex cursor-grab items-center gap-2 rounded-md border border-line-soft bg-ink-950/40 px-2 py-1.5 active:cursor-grabbing"
                  title={`${item.name} · ${Math.round(item.bytes / 1024)} KB`}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', item.kind === 'video' ? 'bg-accent' : item.kind === 'image' ? 'bg-cool' : 'bg-violet')} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{item.name}</span>
                  <span className="font-mono text-[8.5px] uppercase tracking-wider text-faint">{item.kind}</span>
                </div>
              ))
            )}
          </div>
          <p className="border-t border-line-soft px-3 py-2 font-mono text-[9px] leading-relaxed text-faint">
            drag a file onto a track · drag clips to move · right edge trims
          </p>
        </aside>

        {/* preview */}
        <div className="flex min-h-0 flex-col">
          <div className="relative flex min-h-[220px] flex-1 items-center justify-center overflow-hidden bg-black/70">
            {active?.clip ? (
              <Layer clip={active.clip} videoRef={videoRef} imageRef={imageRef} />
            ) : (
              <div className="text-center">
                <Scissors size={20} className="mx-auto text-faint" />
                <p className="mt-2 text-[11.5px] text-muted">Nothing at {playhead.toFixed(2)}s</p>
              </div>
            )}
            {overlay && (
              <div className="pointer-events-none absolute inset-0">
                <Layer clip={overlay} videoRef={overlayVideoRef} imageRef={overlayImageRef} overlay />
              </div>
            )}
            <span className="absolute left-2 top-2 rounded bg-ink-1000/80 px-1.5 py-0.5 font-mono text-[9.5px] text-fg-2">
              {playhead.toFixed(2)}s / {duration.toFixed(2)}s
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
            <button
              onClick={() => {
                if (playhead >= duration) setPlayhead(0);
                setPlaying((value) => !value);
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-line bg-ink-850 text-fg hover:border-line-strong"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <span className="font-mono text-[10px] text-faint">{fpsTime(playhead)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(total, 0.1)}
              step={0.01}
              value={playhead}
              onChange={(event) => {
                setPlaying(false);
                setPlayhead(Number(event.target.value));
              }}
              className="min-w-[120px] flex-1 accent-[var(--accent)]"
              aria-label="Playhead"
            />
            <label className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-faint">
              zoom
              <input
                type="range"
                min={20}
                max={160}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="w-20 accent-[var(--accent)]"
              />
            </label>
            <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{saving === 'saving' ? 'saving…' : saving === 'saved' ? 'saved' : ''}</span>
          </div>
        </div>

        {/* inspector */}
        <aside className="min-h-0 overflow-y-auto border-t border-line-soft px-3 py-3 lg:border-l lg:border-t-0">
          <SectionLabel>clip</SectionLabel>
          {current ? (
            <div className="mt-2 space-y-2">
              <p className="truncate text-[12px] text-fg">{current.name}</p>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="start" value={current.start} onChange={(value) => updateClip(current.id, { start: value })} />
                <NumberField label="length" value={current.duration} onChange={(value) => updateClip(current.id, { duration: Math.max(0.2, value) })} />
                <NumberField label="source in" value={current.in} onChange={(value) => updateClip(current.id, { in: value })} />
                <NumberField
                  label="volume"
                  value={current.volume ?? 1}
                  step={0.1}
                  onChange={(value) => updateClip(current.id, { volume: Math.max(0, Math.min(1, value)) })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={() => splitClip(current.id)}>
                  <Scissors size={10} /> split at playhead
                </Button>
                <Button size="xs" variant="danger" onClick={() => removeClip(current.id)}>
                  <Trash2 size={10} /> remove
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">Select a clip to trim it, split it, or set its volume.</p>
          )}

          <div className="mt-4 border-t border-line-soft pt-3">
            <SectionLabel right={<Wand2 size={11} className="text-accent" />}>ask the agent</SectionLabel>
            {!askOpen ? (
              <Button size="sm" variant="subtle" className="mt-2 w-full" onClick={() => setAskOpen(true)}>
                <MessageSquarePlus size={12} /> edit with the agent
              </Button>
            ) : (
              <div className="mt-2">
                <textarea
                  value={askText}
                  onChange={(event) => setAskText(event.target.value)}
                  rows={4}
                  placeholder="Tighten the opening to four seconds, put the title over the second clip, and tell me what the pacing feels like."
                  className={cn(inputClass, 'resize-y text-[11.5px] leading-relaxed')}
                />
                <p className="mt-1 font-mono text-[9px] leading-relaxed text-faint">
                  The agent receives this cut and a frame at the playhead.
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="xs" variant="primary" onClick={() => void askAgent()} disabled={asking || !askText.trim()}>
                    {asking ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} send
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setAskOpen(false)}>
                    cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-line-soft pt-3">
            <SectionLabel>project</SectionLabel>
            <input
              value={project.name}
              onChange={(event) => mutate({ ...project, name: event.target.value })}
              className={cn(inputClass, 'mt-2 text-[11.5px]')}
              aria-label="Project name"
            />
            <p className="mt-1.5 font-mono text-[9px] text-faint">
              {allClips.length} clips · {project.tracks.length} tracks · saved locally
            </p>
          </div>
        </aside>
      </div>

      {/* timeline */}
      <div
        className="flex h-[224px] shrink-0 flex-col border-t border-line-soft bg-ink-950/30"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="label">timeline</span>
          <span className="font-mono text-[9.5px] text-faint">{duration.toFixed(2)}s · {project.fps}fps</span>
          <button
            onClick={() => setPlayhead(0)}
            className="ml-auto font-mono text-[9px] uppercase tracking-wider text-faint hover:text-fg-2"
          >
            back to start
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="relative min-w-full" style={{ width }}>
            <div className="sticky top-0 z-10 h-5 border-b border-line-soft bg-ink-950/90">
              {ticks.map((second) => (
                <button
                  key={second}
                  onClick={() => setPlayhead(second)}
                  className="absolute top-0 h-5 border-l border-line-soft pl-1 text-left font-mono text-[8.5px] text-faint hover:text-fg-2"
                  style={{ left: second * zoom }}
                >
                  {second}s
                </button>
              ))}
            </div>

            {project.tracks.map((track) => (
              <div
                key={track.id}
                className="relative border-b border-line-soft"
                style={{ height: TRACK_HEIGHT }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const name = event.dataTransfer.getData('application/x-vesper-media');
                  const item = media.find((entry) => entry.name === name);
                  if (!item) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const at = Math.max(0, (event.clientX - rect.left) / zoom);
                  void addClip(item, track.id, at);
                }}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPlaying(false);
                  setPlayhead(Math.max(0, (event.clientX - rect.left) / zoom));
                  setSelected(null);
                }}
              >
                <span className="pointer-events-none absolute left-1 top-1 z-10 font-mono text-[8.5px] uppercase tracking-wider text-faint">
                  {track.kind} · {track.id}
                </span>
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    onPointerDown={(event) => onClipPointerDown(event, clip, 'move')}
                    onClick={() => setSelected(clip.id)}
                    className={cn(
                      'group absolute top-4 h-[38px] cursor-grab overflow-hidden rounded-md border text-left active:cursor-grabbing',
                      clip.id === selected
                        ? 'border-accent/70 bg-accent/15'
                        : clip.kind === 'video'
                          ? 'border-line bg-ink-850'
                          : clip.kind === 'image'
                            ? 'border-cool/30 bg-cool/10'
                            : 'border-violet/30 bg-violet/10',
                    )}
                    style={{ left: clip.start * zoom, width: Math.max(18, clip.duration * zoom) }}
                    title={`${clip.name} · ${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)}s`}
                  >
                    <span className="block truncate px-1.5 pt-1 text-[10px] text-fg">{clip.name}</span>
                    <span className="block truncate px-1.5 font-mono text-[8.5px] text-faint">{clip.duration.toFixed(2)}s</span>
                    <span
                      onPointerDown={(event) => onClipPointerDown(event, clip, 'trim-start')}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-accent/40"
                    />
                    <span
                      onPointerDown={(event) => onClipPointerDown(event, clip, 'trim-end')}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-accent/40"
                    />
                  </div>
                ))}
              </div>
            ))}

            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-accent shadow-[0_0_6px_oklch(0.805_0.148_78/0.8)]"
              style={{ left: playhead * zoom }}
            >
              <span className="absolute -top-0 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Layer({
  clip,
  videoRef,
  imageRef,
  overlay,
}: {
  clip: StudioClip;
  videoRef: RefObject<HTMLVideoElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  overlay?: boolean;
}) {
  if (clip.kind === 'video') {
    return (
      <video
        ref={videoRef}
        key={`${clip.id}-${clip.in}`}
        src={clip.url}
        playsInline
        muted={overlay || clip.muted}
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  if (clip.kind === 'audio') return null;
  return <img ref={imageRef} key={clip.id} src={clip.url} alt="" className="max-h-full max-w-full object-contain" />;
}

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(inputClass, 'mt-0.5 px-2 py-1 font-mono text-[11px]')}
      />
    </label>
  );
}

function fpsTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const frames = Math.round((seconds - whole) * 30);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}
