/**
 * Visual artifact specs. These are the contract between the model and the
 * console: the model emits a fenced block tagged `chart`, `scene` or `html`,
 * the console parses it here and renders something the user can touch, inspect
 * and download. Keeping the schema small and forgiving is deliberate — a
 * weaker model should still produce a valid visual, and a broken spec should
 * degrade to a readable error instead of a blank chat.
 */

export const CHART_TYPES = ['line', 'area', 'bar', 'scatter', 'pie', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeries {
  key: string;
  name?: string;
  color?: string;
  /** Multiply the raw value for display, e.g. 100 for ratios shown as %. */
  scale?: number;
}

export interface ChartSpec {
  type: ChartType;
  data: Array<Record<string, string | number | null>>;
  title?: string;
  subtitle?: string;
  /** Key holding the category or x value. Defaults to the first string key. */
  x?: string;
  /** Numeric keys to draw. Defaults to every numeric key except `x`. */
  series?: Array<string | ChartSeries>;
  stacked?: boolean;
  yLabel?: string;
  xLabel?: string;
  unit?: string;
  /** 'compact' (1.2k), 'percent' (adds %), 'raw'. Default: compact. */
  format?: 'compact' | 'percent' | 'raw';
  height?: number;
  legend?: boolean;
}

export const SCENE_OBJECTS = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'ring'] as const;
export type SceneObjectType = (typeof SCENE_OBJECTS)[number];

export interface SceneObject {
  type: SceneObjectType;
  /** Alias for `type`, so `{ "shape": "sphere" }` also works. */
  shape?: SceneObjectType;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** [width, height, depth] for boxes, [radius] for round shapes. */
  size?: [number, number, number];
  radius?: number;
  color?: string;
  opacity?: number;
  wireframe?: boolean;
  /** Per-object spin in radians per second. */
  spin?: number;
}

export interface SceneLight {
  type: 'ambient' | 'directional' | 'point';
  color?: string;
  intensity?: number;
  position?: [number, number, number];
}

export interface SceneSpec {
  objects?: SceneObject[];
  /** Object array under a friendlier name also works. */
  meshes?: SceneObject[];
  title?: string;
  background?: string;
  grid?: boolean;
  /** Degrees per second. 0 disables. */
  autoRotate?: number;
  camera?: { position?: [number, number, number]; fov?: number };
  lights?: SceneLight[];
  height?: number;
}

export const CHART_PALETTE = ['#efc07a', '#89d6ea', '#8fe3b6', '#bda6f5', '#f29a7f', '#9db8ff', '#e8d47f'];

const chartTypes = new Set<string>(CHART_TYPES);
const sceneObjects = new Set<string>(SCENE_OBJECTS);

/** Parses a fenced block body, tolerating prose-wrapped or single-quoted JSON. */
export function parseSpec<T>(raw: string): { spec?: T; error?: string } {
  const text = raw.trim();
  if (!text) return { error: 'The block is empty.' };
  const attempts = [text, sliceBalanced(text)];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return { spec: value as T };
      if (Array.isArray(value)) return { spec: { data: value } as T };
    } catch {
      /* try the next shape */
    }
  }
  return { error: 'Expected a JSON object. Check for a trailing comma or a missing quote.' };
}

/** Pulls the first balanced {...} out of a block that also contains prose. */
function sliceBalanced(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export interface NormalizedChart {
  spec: ChartSpec;
  xKey: string;
  rows: Array<{ label: string; values: Record<string, number | null> }>;
  series: ChartSeries[];
  format: 'compact' | 'percent' | 'raw';
}

/**
 * Coerces a loose spec into something drawable: string numbers become numbers,
 * missing series become every numeric column, and pie charts get their single
 * series from the first numeric column.
 */
export function normalizeChart(input: ChartSpec): { chart?: NormalizedChart; error?: string } {
  const type = String(input.type ?? 'bar').toLowerCase() as ChartType;
  if (!chartTypes.has(type)) {
    return { error: `Unknown chart type "${input.type}". Use one of: ${CHART_TYPES.join(', ')}.` };
  }
  const rawRows = Array.isArray(input.data) ? input.data : [];
  if (!rawRows.length) return { error: 'The chart has no `data` rows.' };

  const keys = Object.keys(rawRows[0] ?? {});
  const xKey =
    input.x ??
    keys.find((key) => rawRows.some((row) => typeof row[key] === 'string')) ??
    keys[0] ??
    'x';

  const numeric = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };

  const isNumericColumn = (key: string) => rawRows.some((row) => numeric(row[key]) !== null);

  const declared: ChartSeries[] = Array.isArray(input.series)
    ? input.series.map((entry) =>
        typeof entry === 'string' ? { key: entry } : { ...entry, key: String(entry.key ?? '') },
      )
    : [];
  const discovered: ChartSeries[] = keys
    .filter((key) => key !== xKey && isNumericColumn(key))
    .map((key) => ({ key }));

  const series = (declared.length && declared.every((s) => s.key) ? declared : discovered).map((entry, index) => ({
    ...entry,
    name: entry.name ?? entry.key,
    color: entry.color ?? CHART_PALETTE[index % CHART_PALETTE.length]!,
  }));

  if (!series.length) return { error: 'No numeric columns to plot. Add numbers, or name them in `series`.' };

  const rows = rawRows.map((row, index) => {
    const label = String(row[xKey] ?? index + 1);
    const values: Record<string, number | null> = {};
    for (const entry of series) {
      const value = numeric(row[entry.key]);
      values[entry.key] = value === null ? null : value * (entry.scale ?? 1);
    }
    return { label, values };
  });

  return {
    chart: {
      spec: { ...input, type },
      xKey,
      rows,
      series,
      format: input.format ?? 'compact',
    },
  };
}

export interface NormalizedScene {
  spec: SceneSpec;
  objects: Array<SceneObject & { type: SceneObjectType }>;
  lights: SceneLight[];
  spin: number;
}

export function normalizeScene(input: SceneSpec): { scene?: NormalizedScene; error?: string } {
  const list = Array.isArray(input.objects) ? input.objects : Array.isArray(input.meshes) ? input.meshes : [];
  const objects: Array<SceneObject & { type: SceneObjectType }> = [];
  for (const raw of list) {
    const type = String((raw as SceneObject).type ?? (raw as SceneObject).shape ?? '').toLowerCase();
    if (!sceneObjects.has(type)) continue;
    objects.push({ ...raw, type: type as SceneObjectType });
  }
  if (!objects.length) {
    return { error: 'No drawable `objects`. Each needs a type: ' + SCENE_OBJECTS.join(', ') + '.' };
  }
  const lights = Array.isArray(input.lights) && input.lights.length ? input.lights : DEFAULT_LIGHTS();
  return {
    scene: {
      spec: input,
      objects,
      lights,
      spin: typeof input.autoRotate === 'number' ? input.autoRotate : 0,
    },
  };
}

function DEFAULT_LIGHTS(): SceneLight[] {
  return [
    { type: 'ambient', intensity: 0.55 },
    { type: 'directional', intensity: 1.6, position: [5, 8, 4] },
    { type: 'directional', intensity: 0.5, color: '#89d6ea', position: [-4, 2, -5] },
  ];
}

/** 1.2k / 3.4M / 12% — the label shape researchers expect on an axis. */
export function formatValue(value: number, format: ChartSpec['format'] = 'compact', unit?: string): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let text: string;
  if (format === 'percent') text = `${trim(abs)}%`;
  else if (format === 'raw') text = trim(abs);
  else if (abs >= 1_000_000_000) text = `${trim(abs / 1_000_000_000)}B`;
  else if (abs >= 1_000_000) text = `${trim(abs / 1_000_000)}M`;
  else if (abs >= 1_000) text = `${trim(abs / 1_000)}k`;
  else text = trim(abs);
  return `${sign}${text}${unit ? ` ${unit}` : ''}`;
}

function trim(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}

/** Axis ticks on 1/2/5 boundaries, so labels read as numbers people trust. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min, min + 1];
  }
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(step0)));
  const normalized = step0 / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Charts ship as CSV too — that is what ends up in a paper. */
export function chartToCsv(chart: NormalizedChart): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = [chart.xKey, ...chart.series.map((s) => s.name ?? s.key)].map((cell) => escape(String(cell)));
  const rows = chart.rows.map((row) =>
    [row.label, ...chart.series.map((s) => (row.values[s.key] ?? ''))].map((cell) => escape(String(cell))),
  );
  return [header, ...rows].map((cells) => cells.join(',')).join('\n');
}
