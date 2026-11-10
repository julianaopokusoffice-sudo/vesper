import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { downloadBlob, safeFilename } from '@/lib/download';
import { PageHeader, SectionLabel, cn, inputClass } from './ui';
import { TimelineStudio } from './StudioTimeline';

/* ------------------------------------------------------------------ photo -- */

interface Grade {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  fade: number;
  vignette: number;
  grain: number;
  blur: number;
}

const NEUTRAL: Grade = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  warmth: 0,
  fade: 0,
  vignette: 0.25,
  grain: 0.08,
  blur: 0,
};

const PRESETS: { id: string; name: string; grade: Grade }[] = [
  { id: 'neutral', name: 'Neutral', grade: NEUTRAL },
  {
    id: 'editorial',
    name: 'Editorial',
    grade: { ...NEUTRAL, contrast: 1.12, saturation: 0.92, warmth: 0.18, fade: 0.05, vignette: 0.38, grain: 0.14 },
  },
  {
    id: 'film',
    name: 'Warm film',
    grade: { brightness: 1.03, contrast: 1.05, saturation: 1.08, warmth: 0.55, fade: 0.1, vignette: 0.45, grain: 0.3, blur: 0 },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    grade: { ...NEUTRAL, contrast: 1.18, saturation: 0.72, warmth: -0.22, fade: 0.02, vignette: 0.25, grain: 0.2 },
  },
  {
    id: 'mono',
    name: 'Mono',
    grade: { ...NEUTRAL, contrast: 1.16, saturation: 0, fade: 0.03, vignette: 0.42, grain: 0.24 },
  },
];

/** One filter string for the preview and for the exported pixels. */
function filterFor(grade: Grade): string {
  const sepia = Math.max(0, grade.warmth) * 0.32;
  const hue = grade.warmth * -10;
  return `brightness(${grade.brightness}) contrast(${grade.contrast}) saturate(${grade.saturation}) sepia(${sepia}) hue-rotate(${hue}deg)${grade.blur ? ` blur(${grade.blur}px)` : ''}`;
}

const GRAIN_TILE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")";

function PhotoStudio() {
  const [gallery, setGallery] = useState<{ name: string; bytes: number }[]>([]);
  const [source, setSource] = useState<{ url: string; name: string } | null>(null);
  const [grade, setGrade] = useState<Grade>({ ...PRESETS[1]!.grade });
  const [preset, setPreset] = useState('editorial');
  const [compare, setCompare] = useState(100);
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const localUrl = useRef<string | null>(null);

  useEffect(() => {
    void api
      .images()
      .then((result) => setGallery(result.files))
      .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    },
    [],
  );

  const pickFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = URL.createObjectURL(file);
    setSource({ url: localUrl.current, name: file.name.replace(/\.[a-z0-9]+$/i, '') });
  };

  const set = (patch: Partial<Grade>) => {
    setGrade((current) => ({ ...current, ...patch }));
    setPreset('custom');
  };

  const exportStill = async () => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth) return;
    setSaving(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable.');
      ctx.filter = filterFor(grade);
      ctx.drawImage(image, 0, 0);
      ctx.filter = 'none';

      if (grade.fade > 0) {
        ctx.fillStyle = `rgba(10,10,14,${grade.fade})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (grade.vignette > 0) {
        const radius = Math.hypot(canvas.width, canvas.height) / 2;
        const gradient = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          radius * 0.35,
          canvas.width / 2,
          canvas.height / 2,
          radius,
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${grade.vignette})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (grade.grain > 0) {
        const tile = document.createElement('canvas');
        tile.width = 160;
        tile.height = 160;
        const tileCtx = tile.getContext('2d');
        if (tileCtx) {
          const data = tileCtx.createImageData(160, 160);
          for (let i = 0; i < data.data.length; i += 4) {
            const value = 120 + Math.random() * 135;
            data.data[i] = value;
            data.data[i + 1] = value;
            data.data[i + 2] = value;
            data.data[i + 3] = 255;
          }
          tileCtx.putImageData(data, 0, 0);
          const pattern = ctx.createPattern(tile, 'repeat');
          if (pattern) {
            ctx.save();
            ctx.globalAlpha = grade.grain * 0.5;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) downloadBlob(blob, safeFilename(`${source?.name ?? 'image'}-graded`, 'export', 'png'));
    } finally {
      setSaving(false);
    }
  };

  const filter = filterFor(grade);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[1fr_320px] sm:px-8">
      <div className="min-w-0">
        <div
          className={cn(
            'relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-line-soft bg-ink-950/40 p-3',
            !source && 'border-dashed',
          )}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            pickFile(event.dataTransfer.files[0]);
          }}
        >
          {source ? (
            <div className="relative inline-block max-w-full">
              <img
                ref={imageRef}
                src={source.url}
                alt=""
                crossOrigin="anonymous"
                className="block max-h-[58vh] w-auto max-w-full rounded-lg"
              />
              <img
                src={source.url}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full rounded-lg"
                style={{ filter, clipPath: `inset(0 0 0 ${100 - compare}%)` }}
              />
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{
                  background: `radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,${grade.vignette}) 100%)`,
                }}
              />
              <div
                className="pointer-events-none absolute inset-0 rounded-lg"
                style={{ background: `rgba(9,9,13,${grade.fade})` }}
              />
              <div
                className="pointer-events-none absolute inset-0 rounded-lg mix-blend-overlay"
                style={{ backgroundImage: GRAIN_TILE, backgroundSize: '160px 160px', opacity: grade.grain * 0.5 }}
              />
              {compare < 100 ? (
                <>
                  <span className="pointer-events-none absolute left-3 top-3 rounded bg-ink-1000/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-2 backdrop-blur">
                    original
                  </span>
                  <span className="pointer-events-none absolute right-3 top-3 rounded bg-ink-1000/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent backdrop-blur">
                    graded
                  </span>
                  <div
                    className="pointer-events-none absolute inset-y-0 w-px bg-white/60"
                    style={{ left: `${100 - compare}%` }}
                  />
                </>
              ) : null}
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="group flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-ink-900 text-faint group-hover:text-accent">
                <Upload size={17} />
              </span>
              <span className="text-[13px] text-fg-2">Drop an image, or choose one</span>
              <span className="max-w-xs text-[11px] leading-relaxed text-faint">
                Frames from <span className="mono">generate_image</span> appear below. Grading is applied live and exported at full resolution.
              </span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex min-w-[180px] flex-1 items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">before / after</span>
            <input
              type="range"
              min={0}
              max={100}
              value={compare}
              onChange={(event) => setCompare(Number(event.target.value))}
              className="accent-[var(--accent)] flex-1"
            />
          </label>
          <button
            onClick={() => void exportStill()}
            disabled={!source || saving}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-ink-1000 disabled:opacity-40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Export PNG
          </button>
        </div>

        {gallery.length ? (
          <div className="mt-4">
            <SectionLabel>from the agents</SectionLabel>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {gallery.map((file) => (
                <button
                  key={file.name}
                  onClick={() => setSource({ url: api.imageUrl(`image://${file.name}`), name: file.name.replace(/\.[a-z0-9]+$/i, '') })}
                  className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-line-soft transition-colors hover:border-accent/50"
                  title={file.name}
                >
                  <img src={api.imageUrl(`image://${file.name}`)} alt={file.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <aside className="min-h-0 space-y-3 overflow-y-auto">
        <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3">
          <SectionLabel right={<span className="font-mono text-[9.5px] text-faint">{preset}</span>}>look</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {PRESETS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  setGrade({ ...entry.grade });
                  setPreset(entry.id);
                }}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-left text-[11.5px] transition-colors',
                  preset === entry.id ? 'border-accent/40 bg-accent-wash text-fg' : 'border-line-soft text-muted hover:border-line',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3">
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal size={10} /> grade
            </span>
          </SectionLabel>
          <div className="mt-2 space-y-2.5">
            <Slider label="exposure" value={grade.brightness} min={0.5} max={1.6} step={0.01} onChange={(value) => set({ brightness: value })} />
            <Slider label="contrast" value={grade.contrast} min={0.6} max={1.6} step={0.01} onChange={(value) => set({ contrast: value })} />
            <Slider label="saturation" value={grade.saturation} min={0} max={2} step={0.01} onChange={(value) => set({ saturation: value })} />
            <Slider label="warmth" value={grade.warmth} min={-1} max={1} step={0.01} onChange={(value) => set({ warmth: value })} />
            <Slider label="fade" value={grade.fade} min={0} max={0.4} step={0.01} onChange={(value) => set({ fade: value })} />
            <Slider label="vignette" value={grade.vignette} min={0} max={0.9} step={0.01} onChange={(value) => set({ vignette: value })} />
            <Slider label="grain" value={grade.grain} min={0} max={0.8} step={0.01} onChange={(value) => set({ grain: value })} />
            <Slider label="blur" value={grade.blur} min={0} max={10} step={0.1} onChange={(value) => set({ blur: value })} />
          </div>
        </div>
      </aside>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{label}</span>
        <span className="mono text-[10px] text-fg-2">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-0.5 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

/* ----------------------------------------------------------------- motion -- */

interface MotionSpec {
  title: string;
  subtitle: string;
  accent: string;
  duration: number;
  motion: 'rise' | 'fade' | 'wipe';
  style: 'editorial' | 'bold' | 'minimal';
}

const MOTION_DEFAULT: MotionSpec = {
  title: 'The quiet part of the energy transition',
  subtitle: 'Solar adoption, Portugal · 2020–2024',
  accent: '#efc07a',
  duration: 8,
  motion: 'rise',
  style: 'editorial',
};

const ease = (value: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Draws one frame of the title sequence. Pure enough to scrub and to record. */
function drawFrame(ctx: CanvasRenderingContext2D, time: number, spec: MotionSpec) {
  const W = 1280;
  const H = 720;
  const progress = clamp01(time / spec.duration);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f0f15';
  ctx.fillRect(0, 0, W, H);

  const wash = ctx.createRadialGradient(W * 0.32, H * 0.28, 40, W * 0.32, H * 0.28, W * 0.9);
  wash.addColorStop(0, 'rgba(239,192,122,0.09)');
  wash.addColorStop(1, 'rgba(15,15,21,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let x = 96; x < W; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 96; y < H; y += 96) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const bold = spec.style === 'bold';
  const minimal = spec.style === 'minimal';
  const entry = ease(clamp01(time / 1.1));
  const subtitleIn = ease(clamp01((time - 0.55) / 0.9));
  const rule = ease(clamp01(time / 0.9));
  const left = minimal ? W / 2 : 104;
  const align: CanvasTextAlign = minimal ? 'center' : 'left';

  if (spec.style !== 'minimal') {
    ctx.fillStyle = spec.accent;
    ctx.fillRect(left, 244, 64 * rule, 3);
  }

  ctx.save();
  const vertical = spec.motion === 'rise' ? 26 * (1 - entry) : 0;
  if (spec.motion === 'wipe') {
    ctx.beginPath();
    ctx.rect(0, 0, W * entry, H);
    ctx.clip();
  }
  ctx.globalAlpha = spec.motion === 'wipe' ? 1 : entry;
  ctx.textAlign = align;

  if (!minimal) {
    ctx.fillStyle = 'rgba(236,234,244,0.55)';
    ctx.font = "500 13px 'Instrument Sans', ui-sans-serif, system-ui";
    ctx.fillText('V E S P E R   S T U D I O', left, 210 - vertical * 0.4);
  }

  ctx.fillStyle = '#f2f0f7';
  ctx.font = `600 ${bold ? 84 : minimal ? 64 : 70}px 'Instrument Sans', ui-sans-serif, system-ui`;
  const words = spec.title.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > (minimal ? W - 240 : W - 260) && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  const lineHeight = bold ? 96 : 84;
  const startY = bold ? 360 : 340;
  lines.slice(0, 3).forEach((text, index) => {
    ctx.fillText(text, left, startY + index * lineHeight + vertical);
  });

  ctx.globalAlpha = spec.motion === 'wipe' ? 1 : subtitleIn;
  ctx.fillStyle = 'rgba(201,198,214,0.82)';
  ctx.font = "400 22px 'Instrument Sans', ui-sans-serif, system-ui";
  ctx.fillText(spec.subtitle, left, startY + Math.min(3, lines.length) * lineHeight + 16 + (1 - subtitleIn) * 12);
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, H - 4, W, 4);
  ctx.fillStyle = spec.accent;
  ctx.fillRect(0, H - 4, W * progress, 4);

  if (bold) {
    ctx.fillStyle = spec.accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, H - 220, 6, 220);
    ctx.globalAlpha = 1;
  }
}

function MotionStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spec, setSpec] = useState<MotionSpec>(MOTION_DEFAULT);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const startedAt = useRef(0);
  const raf = useRef(0);

  const paint = useCallback(
    (at: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      drawFrame(ctx, at, spec);
    },
    [spec],
  );

  useEffect(() => {
    paint(timeRef.current);
  }, [paint]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current);
      playingRef.current = false;
    };
  }, []);

  const loop = useCallback(() => {
    if (!playingRef.current) return;
    const elapsed = (performance.now() - startedAt.current) / 1000;
    if (elapsed >= spec.duration) {
      timeRef.current = spec.duration;
      setTime(spec.duration);
      paint(spec.duration);
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    timeRef.current = elapsed;
    setTime(elapsed);
    paint(elapsed);
    raf.current = requestAnimationFrame(loop);
  }, [paint, spec.duration]);

  const toggle = () => {
    if (playingRef.current) {
      playingRef.current = false;
      cancelAnimationFrame(raf.current);
      setPlaying(false);
      return;
    }
    if (timeRef.current >= spec.duration) timeRef.current = 0;
    startedAt.current = performance.now() - timeRef.current * 1000;
    playingRef.current = true;
    setPlaying(true);
    raf.current = requestAnimationFrame(loop);
  };

  const scrub = (value: number) => {
    playingRef.current = false;
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    timeRef.current = value;
    setTime(value);
    paint(value);
  };

  const poster = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) downloadBlob(blob, safeFilename(spec.title, 'still', 'png'));
  };

  /** Records the real canvas stream, so what you previewed is what ships. */
  const exportVideo = async () => {
    const canvas = canvasRef.current;
    if (!canvas || exporting) return;
    const supported = typeof MediaRecorder !== 'undefined' && ['video/webm;codecs=vp9', 'video/webm'].some((type) => MediaRecorder.isTypeSupported(type));
    if (!supported) {
      await poster();
      return;
    }
    setExporting(true);
    try {
      const stream = canvas.captureStream(30);
      const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      playingRef.current = false;
      cancelAnimationFrame(raf.current);
      timeRef.current = 0;
      paint(0);
      setPlaying(false);
      setTime(0);
      recorder.start();

      const started = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const elapsed = (performance.now() - started) / 1000;
          const at = Math.min(spec.duration, elapsed);
          paint(at);
          setTime(at);
          if (elapsed >= spec.duration) resolve();
          else raf.current = requestAnimationFrame(step);
        };
        raf.current = requestAnimationFrame(step);
      });
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (blob.size) downloadBlob(blob, safeFilename(spec.title, 'motion', 'webm'));
    } finally {
      setExporting(false);
      timeRef.current = 0;
      setTime(0);
      paint(0);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[1fr_320px] sm:px-8">
      <div className="min-w-0">
        <div className="overflow-hidden rounded-xl border border-line-soft bg-ink-950">
          <canvas ref={canvasRef} width={1280} height={720} className="block h-auto w-full" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={toggle}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-ink-900 text-fg-2 hover:text-fg"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={spec.duration}
            step={0.05}
            value={time}
            onChange={(event) => scrub(Number(event.target.value))}
            className="min-w-[140px] flex-1 accent-[var(--accent)]"
            aria-label="Timeline"
          />
          <span className="mono text-[10.5px] text-faint">
            {time.toFixed(1)}s / {spec.duration.toFixed(0)}s
          </span>
          <button
            onClick={() => void exportVideo()}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-ink-1000 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
            {exporting ? `recording ${spec.duration}s…` : 'Export WebM'}
          </button>
          <button
            onClick={() => void poster()}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-fg-2 hover:border-line-strong"
          >
            <Download size={12} /> Still
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Export records the live canvas at 30 fps for the full duration — keep this tab visible while it runs. WebM opens in any editor; stills are 1280×720 PNG.
        </p>
      </div>

      <aside className="min-h-0 space-y-3 overflow-y-auto">
        <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3">
          <SectionLabel>script</SectionLabel>
          <div className="mt-2 space-y-2">
            <textarea
              className={cn(inputClass, 'min-h-[64px] resize-none text-[12px]')}
              value={spec.title}
              onChange={(event) => setSpec({ ...spec, title: event.target.value })}
              placeholder="Title"
            />
            <input
              className={cn(inputClass, 'text-[12px]')}
              value={spec.subtitle}
              onChange={(event) => setSpec({ ...spec, subtitle: event.target.value })}
              placeholder="Subtitle / attribution"
            />
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3">
          <SectionLabel>direction</SectionLabel>
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-3 gap-1">
              {(['editorial', 'bold', 'minimal'] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => setSpec({ ...spec, style })}
                  className={cn(
                    'rounded-md border px-1.5 py-1 text-[11px] capitalize transition-colors',
                    spec.style === style ? 'border-accent/40 bg-accent-wash text-fg' : 'border-line-soft text-muted hover:border-line',
                  )}
                >
                  {style}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['rise', 'fade', 'wipe'] as const).map((motion) => (
                <button
                  key={motion}
                  onClick={() => setSpec({ ...spec, motion })}
                  className={cn(
                    'rounded-md border px-1.5 py-1 text-[11px] capitalize transition-colors',
                    spec.motion === motion ? 'border-accent/40 bg-accent-wash text-fg' : 'border-line-soft text-muted hover:border-line',
                  )}
                >
                  {motion}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">accent</span>
              <input
                type="color"
                value={spec.accent}
                onChange={(event) => setSpec({ ...spec, accent: event.target.value })}
                className="h-6 w-10 rounded border border-line bg-transparent"
              />
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">duration</span>
                <span className="mono text-[10px] text-fg-2">{spec.duration}s</span>
              </span>
              <input
                type="range"
                min={3}
                max={15}
                step={1}
                value={spec.duration}
                onChange={(event) => setSpec({ ...spec, duration: Number(event.target.value) })}
                className="mt-0.5 w-full accent-[var(--accent)]"
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-line-soft bg-ink-950/30 p-3">
          <SectionLabel>handoff</SectionLabel>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Need a different cut? Ask an agent in chat for a <span className="mono text-[10.5px] text-fg-2">```scene</span> or{' '}
            <span className="mono text-[10.5px] text-fg-2">```html</span> block, then bring the still here to grade it. Studio renders locally —
            nothing is uploaded.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ shell -- */

export function StudioView() {
  const [mode, setMode] = useState<'photo' | 'motion' | 'edit'>('edit');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-5 sm:px-8">
        <PageHeader
          title="Studio"
          subtitle="Cut footage on a timeline, grade a still, or generate a title sequence. Local files, local canvas — no upload, no render farm."
          meta={<span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">real time</span>}
          actions={
            <div className="flex rounded-lg border border-line p-0.5">
              {([
                { id: 'edit' as const, label: 'Edit', icon: Film },
                { id: 'photo' as const, label: 'Photo', icon: ImageIcon },
                { id: 'motion' as const, label: 'Motion', icon: Clapperboard },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] transition-colors',
                    mode === id ? 'bg-ink-850 text-fg' : 'text-faint hover:text-fg-2',
                  )}
                >
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>
          }
        />
      </div>
      {mode === 'edit' ? <TimelineStudio /> : mode === 'photo' ? <PhotoStudio /> : <MotionStudio />}
    </div>
  );
}
