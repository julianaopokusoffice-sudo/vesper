import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import { store } from '../kernel/store.ts';
import type { ImageBackend, ImageSettings } from '../../shared/types.ts';

/**
 * Image generation, wired to whatever the user already runs:
 *
 *   sdcpp    stable-diffusion.cpp — its `/v1/images/generations` is OpenAI-shaped
 *   a1111    AUTOMATIC1111 / Stable Diffusion WebUI — `/sdapi/v1/txt2img`
 *   openai   any OpenAI-compatible images endpoint (hosted or self-hosted)
 *   off      the tool reports how to switch it on
 *
 * Generated files land in `~/.vesper/images` and are handed back as
 * `image://<name>` markers, never as base64: a 1 MB image in the model's context
 * would cost thousands of tokens and it cannot do anything with it anyway.
 */

export const IMAGE_MARKER = 'image://';

export function imagesDir(): string {
  return PATHS.images;
}

export interface ResolvedImageSettings {
  backend: ImageBackend;
  baseURL: string;
  model: string;
  apiKey?: string;
  steps: number;
  size: string;
}

export function imageSettings(): ResolvedImageSettings {
  const settings = store().settings();
  const image = (settings as { image?: Partial<ImageSettings> }).image ?? {};
  return {
    backend: image.backend ?? 'off',
    baseURL: image.baseURL ?? 'http://127.0.0.1:8080',
    model: image.model ?? '',
    apiKey: image.apiKey,
    steps: image.steps ?? 20,
    size: image.size ?? '1024x1024',
  };
}

export function imageBackendHint(): string {
  const config = imageSettings();
  if (config.backend === 'off') {
    return 'No image backend is configured. Set one in Settings → Image, e.g. backend "sdcpp" pointing at a stable-diffusion.cpp server, or "a1111" at a Stable Diffusion WebUI.';
  }
  return `${config.backend} · ${config.baseURL}${config.model ? ` · ${config.model}` : ''}`;
}

export interface GeneratedImage {
  file: string;
  url: string;
  bytes: number;
  prompt: string;
  backend: string;
  ms: number;
}

export async function generateImage(input: {
  prompt: string;
  negativePrompt?: string;
  size?: string;
  steps?: number;
  count?: number;
  signal?: AbortSignal;
}): Promise<GeneratedImage[]> {
  const config = imageSettings();
  if (config.backend === 'off') throw new Error(imageBackendHint());

  const size = normalizeSize(input.size ?? config.size);
  const count = Math.min(Math.max(Number(input.count) || 1, 1), 4);
  const started = Date.now();
  const payload = await dispatch(config, { ...input, size, steps: input.steps ?? config.steps, count });

  const dir = imagesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return payload.map((base64, index) => {
    const name = `${stamp}-${createHash('sha256').update(base64).digest('hex').slice(0, 8)}.png`;
    writeFileSync(join(dir, name), Buffer.from(base64, 'base64'), { mode: 0o600 });
    return {
      file: `${IMAGE_MARKER}${name}`,
      url: `/api/images/${name}`,
      bytes: Buffer.from(base64, 'base64').length,
      prompt: input.prompt,
      backend: config.backend,
      ms: Date.now() - started,
    };
  });
}

export function readImage(name: string): { buffer: Buffer; type: string } | null {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = join(imagesDir(), safe);
  if (!safe || !existsSync(file)) return null;
  const type = safe.endsWith('.jpg') || safe.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return { buffer: readFileSync(file), type };
}

// --- backends ----------------------------------------------------------------

interface DispatchInput {
  prompt: string;
  negativePrompt?: string;
  size: string;
  steps: number;
  count: number;
  signal?: AbortSignal;
}

async function dispatch(config: ImageSettings, input: DispatchInput): Promise<string[]> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const base = config.baseURL.replace(/\/+$/, '');
  const signal = input.signal ?? AbortSignal.timeout(180_000);

  if (config.backend === 'a1111') {
    const [width, height] = input.size.split('x').map(Number);
    const response = await fetch(`${base}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negativePrompt ?? '',
        steps: input.steps,
        width,
        height,
        batch_size: input.count,
      }),
      signal,
    });
    const json = (await response.json().catch(() => ({}))) as { images?: string[]; error?: string };
    if (!response.ok || !json.images?.length) {
      throw new Error(json.error ?? `Stable Diffusion WebUI responded ${response.status}`);
    }
    return json.images;
  }

  // sdcpp and openai-compatible servers share one request shape.
  const response = await fetch(`${base}/v1/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model || undefined,
      prompt: input.prompt,
      n: input.count,
      size: input.size,
      response_format: 'b64_json',
      negative_prompt: input.negativePrompt || undefined,
      steps: config.backend === 'sdcpp' ? input.steps : undefined,
    }),
    signal,
  });
  const json = (await response.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[];
    images?: string[];
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    const message = typeof json.error === 'string' ? json.error : (json.error?.message ?? `HTTP ${response.status}`);
    throw new Error(`${config.backend} backend: ${message}`);
  }
  // sd.cpp also answers with a bare `images` array on its native route.
  if (Array.isArray(json.images) && json.images.length) return json.images.slice(0, input.count);
  const data = json.data ?? [];
  const out: string[] = [];
  for (const entry of data.slice(0, input.count)) {
    if (entry.b64_json) out.push(entry.b64_json);
    else if (entry.url) out.push(await downloadAsBase64(entry.url, signal));
  }
  if (!out.length) throw new Error('The image backend returned no images.');
  return out;
}

async function downloadAsBase64(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not download the generated image (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

function normalizeSize(size: string): string {
  const match = /^(\d{2,5})\s*[x×*\s]\s*(\d{2,5})$/i.exec(size.trim());
  if (!match) return '1024x1024';
  const clamp = (value: number) => Math.min(Math.max(Math.round(value / 64) * 64, 256), 2048);
  return `${clamp(Number(match[1]))}x${clamp(Number(match[2]))}`;
}
