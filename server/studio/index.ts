import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import type { StudioClipKind, StudioMedia, StudioProject } from '../../shared/types.ts';

/**
 * Studio storage: a media bin and saved timelines.
 *
 * Media is the user's own footage, so it never leaves the machine. Files are
 * served back to the editor with HTTP range support, which is what makes a
 * 4 GB clip scrubbable without loading it into memory. Timelines are plain JSON
 * in ~/.vesper/studio, which means an agent can read and rewrite them and the
 * user can keep a project in version control if they want.
 */

const VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function kindOf(name: string): StudioClipKind | null {
  const ext = extname(name).toLowerCase();
  if (VIDEO.has(ext)) return 'video';
  if (IMAGE.has(ext)) return 'image';
  if (AUDIO.has(ext)) return 'audio';
  return null;
}

export function listMedia(): StudioMedia[] {
  if (!existsSync(PATHS.media)) return [];
  return readdirSync(PATHS.media)
    .map((name) => {
      const kind = kindOf(name);
      if (!kind) return null;
      try {
        const info = statSync(join(PATHS.media, name));
        if (!info.isFile()) return null;
        return {
          name,
          kind,
          bytes: info.size,
          modified: info.mtimeMs,
          url: `/api/media/${encodeURIComponent(name)}`,
        } satisfies StudioMedia;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is StudioMedia => !!entry)
    .sort((a, b) => b.modified - a.modified);
}

function safeName(input: string): string {
  const base = input.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  return base && kindOf(base) ? base : '';
}

/** Store one upload without overwriting an existing take. */
export function saveMedia(name: string, bytes: Uint8Array): StudioMedia {
  const clean = safeName(name);
  if (!clean) throw new Error(`Unsupported file type: ${name}`);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('File is larger than the 200 MB limit.');
  mkdirSync(PATHS.media, { recursive: true, mode: 0o700 });
  let target = join(PATHS.media, clean);
  if (existsSync(target)) {
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let index = 2;
    while (existsSync(target)) {
      target = join(PATHS.media, `${stem}-${index}${ext}`);
      index += 1;
    }
  }
  writeFileSync(target, bytes, { mode: 0o600 });
  const info = statSync(target);
  return {
    name: target.slice(PATHS.media.length + 1),
    kind: kindOf(target)!,
    bytes: info.size,
    modified: info.mtimeMs,
    url: `/api/media/${encodeURIComponent(target.slice(PATHS.media.length + 1))}`,
  };
}

export function mediaPath(name: string): { file: string; kind: StudioClipKind } | null {
  const clean = safeName(name);
  if (!clean) return null;
  const file = resolve(PATHS.media, clean);
  if (!file.startsWith(resolve(PATHS.media))) return null;
  if (!existsSync(file)) return null;
  const kind = kindOf(clean);
  return kind ? { file, kind } : null;
}

export function contentTypeFor(name: string): string {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  };
  return map[ext] ?? 'application/octet-stream';
}

// --- projects ----------------------------------------------------------------

function projectFile(id: string): string | null {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return clean ? join(PATHS.studio, `${clean}.json`) : null;
}

export function listProjects(): { id: string; name: string; updatedAt: number; clips: number }[] {
  if (!existsSync(PATHS.studio)) return [];
  const out: { id: string; name: string; updatedAt: number; clips: number }[] = [];
  for (const name of readdirSync(PATHS.studio)) {
    if (!name.endsWith('.json')) continue;
    try {
      const project = JSON.parse(readFileSync(join(PATHS.studio, name), 'utf8')) as StudioProject;
      out.push({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        clips: project.tracks?.reduce((sum, track) => sum + (track.clips?.length ?? 0), 0) ?? 0,
      });
    } catch {
      /* a corrupt project is skipped, not fatal */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): StudioProject | null {
  const file = projectFile(id);
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StudioProject;
  } catch {
    return null;
  }
}

export function latestProject(): StudioProject | null {
  const first = listProjects()[0];
  return first ? getProject(first.id) : null;
}

export function saveProject(input: StudioProject): StudioProject {
  const file = projectFile(input.id);
  if (!file) throw new Error('A project needs a simple id (letters, numbers, dash, underscore).');
  const project: StudioProject = {
    id: input.id,
    name: String(input.name ?? 'Untitled edit').slice(0, 120),
    width: Math.max(16, Math.min(Number(input.width) || 1920, 7680)),
    height: Math.max(16, Math.min(Number(input.height) || 1080, 4320)),
    fps: Math.max(1, Math.min(Number(input.fps) || 30, 120)),
    tracks: (Array.isArray(input.tracks) ? input.tracks : []).slice(0, 6).map((track, index) => ({
      id: String(track.id ?? `t${index}`).replace(/[^a-zA-Z0-9_-]/g, '') || `t${index}`,
      kind: track.kind === 'overlay' ? 'overlay' : 'video',
      clips: (Array.isArray(track.clips) ? track.clips : []).slice(0, 200).map((clip) => ({
        id: String(clip.id ?? ''),
        name: String(clip.name ?? 'clip').slice(0, 200),
        url: String(clip.url ?? ''),
        kind: clip.kind === 'image' || clip.kind === 'audio' ? clip.kind : 'video',
        start: Math.max(0, Number(clip.start) || 0),
        in: Math.max(0, Number(clip.in) || 0),
        duration: Math.max(0.05, Number(clip.duration) || 5),
        volume: clip.volume === undefined ? 1 : Math.max(0, Math.min(Number(clip.volume), 1)),
        muted: Boolean(clip.muted),
      })),
    })),
    updatedAt: Date.now(),
  };
  const json = JSON.stringify(project, null, 2);
  if (json.length > 4_000_000) throw new Error('Project is too large to save (4 MB max).');
  mkdirSync(PATHS.studio, { recursive: true, mode: 0o700 });
  writeFileSync(file, json, { mode: 0o600 });
  return project;
}

export function projectSummary(project: StudioProject): string {
  const lines = [
    `Project “${project.name}” (${project.id}) — ${project.width}×${project.height} @ ${project.fps}fps, updated ${new Date(project.updatedAt).toISOString()}`,
  ];
  for (const track of project.tracks) {
    lines.push(`Track ${track.id} (${track.kind}):`);
    if (!track.clips.length) lines.push('  (empty)');
    for (const clip of track.clips) {
      lines.push(
        `  - ${clip.name} [${clip.kind}] timeline ${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)}s (source in ${clip.in.toFixed(2)}, ${clip.duration.toFixed(2)}s)`,
      );
    }
  }
  const end = Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)));
  lines.push(`Total duration: ${end.toFixed(2)}s`);
  return lines.join('\n');
}
