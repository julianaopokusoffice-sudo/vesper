import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../../', import.meta.url));

/** Where Vesper keeps state. Override with VESPER_HOME for portable installs. */
export const HOME = resolve(process.env.VESPER_HOME ?? join(homedir(), '.vesper'));

export const PATHS = {
  home: HOME,
  db: join(HOME, 'vesper.db'),
  config: join(HOME, 'config.json'),
  keyfile: join(HOME, '.key'),
  skills: join(HOME, 'skills'),
  plugins: join(HOME, 'plugins'),
  personas: join(HOME, 'agents'),
  mcp: join(HOME, 'mcp.json'),
  models: join(HOME, 'models'),
  images: join(HOME, 'images'),
  /** Deliverables the agent produces: documents, exports, downloads. */
  artifacts: join(HOME, 'artifacts'),
  /** Isolated workspaces, one folder per project. */
  projects: join(HOME, 'projects'),
  /** Studio media bin: footage the user dropped in, served back with range support. */
  media: join(HOME, 'media'),
  /** Saved studio timelines (JSON), one file per project. */
  studio: join(HOME, 'studio'),
  workspace: resolve(process.env.VESPER_WORKSPACE ?? join(HOME, 'workspace')),
  logs: join(HOME, 'logs'),
};

/** Read-only seed content shipped with the app. */
export const BUNDLED = {
  root: here,
  skills: join(here, 'data', 'skills'),
  plugins: join(here, 'data', 'plugins'),
};

export function ensureDirs() {
  for (const dir of [
    PATHS.home,
    PATHS.skills,
    PATHS.plugins,
    PATHS.personas,
    PATHS.workspace,
    PATHS.logs,
    PATHS.artifacts,
    PATHS.projects,
    PATHS.media,
    PATHS.studio,
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
