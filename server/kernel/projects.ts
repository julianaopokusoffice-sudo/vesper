import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readKV, writeKV } from './kv.ts';
import { PATHS } from './paths.ts';

/**
 * Projects are isolated workspaces: a folder under ~/.vesper/projects that the
 * filesystem and shell tools are sandboxed to for a given thread. Research and
 * coding do not belong in the same pile of files, and neither do two clients.
 */
export type ProjectKind = 'code' | 'research' | 'writing' | 'general';

export interface Project {
  id: string;
  name: string;
  kind: ProjectKind;
  path: string;
  createdAt: number;
  updatedAt: number;
}

interface ProjectState {
  items: Project[];
  /** threadId -> projectId */
  threads: Record<string, string>;
}

const FALLBACK: ProjectState = { items: [], threads: {} };

function read(): ProjectState {
  const state = readKV<ProjectState>('projects', FALLBACK);
  return { items: Array.isArray(state.items) ? state.items : [], threads: state.threads ?? {} };
}

function write(state: ProjectState) {
  writeKV('projects', state);
}

export function listProjects(): Project[] {
  return read().items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function threadProjectMap(): Record<string, string> {
  return read().threads;
}

export function createProject(input: { name: string; kind?: ProjectKind }): Project {
  const state = read();
  const name = input.name.trim().slice(0, 80) || 'Untitled project';
  const kind: ProjectKind = input.kind ?? 'general';
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project';
  let id = base;
  let suffix = 2;
  while (state.items.some((project) => project.id === id)) id = `${base}-${suffix++}`;

  const path = join(PATHS.projects, id);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  seedProject(path, name, kind);

  const now = Date.now();
  const project: Project = { id, name, kind, path, createdAt: now, updatedAt: now };
  state.items.push(project);
  write(state);
  return project;
}

/** Attaching a thread to a project is what scopes its tools. */
export function attachThread(threadId: string, projectId: string | null): void {
  const state = read();
  if (projectId && !state.items.some((project) => project.id === projectId)) {
    throw new Error(`No project "${projectId}"`);
  }
  const next = { ...state.threads };
  if (projectId) next[threadId] = projectId;
  else delete next[threadId];
  write({ ...state, threads: next });
}

export function projectForThread(threadId: string): Project | undefined {
  const state = read();
  const project = state.items.find((item) => item.id === state.threads[threadId]);
  return project && existsSync(project.path) ? project : undefined;
}

export function workspaceForThread(threadId: string): string {
  return projectForThread(threadId)?.path ?? PATHS.workspace;
}

function seedProject(path: string, name: string, kind: ProjectKind) {
  const readme = join(path, 'README.md');
  if (existsSync(readme)) return;
  const body =
    kind === 'code'
      ? `# ${name}\n\nWorkspace for ${name}. Vesper's file and shell tools are sandboxed to this folder.\n\n- \`src/\` — code\n- \`notes/\` — decisions and open questions\n`
      : kind === 'research'
        ? `# ${name}\n\nResearch workspace. Keep the question, the evidence and the write-up separate.\n\n- \`sources/\` — fetched pages, PDFs, datasets\n- \`notes/\` — findings, one file per thread\n- \`drafts/\` — documents and figures\n`
        : `# ${name}\n\nWorkspace for ${name}.\n`;
  writeFileSync(readme, body, 'utf8');
  if (kind === 'research') for (const dir of ['sources', 'notes', 'drafts']) mkdirSync(join(path, dir), { recursive: true });
  if (kind === 'code') for (const dir of ['src', 'notes']) mkdirSync(join(path, dir), { recursive: true });
}
