import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './paths.ts';

/** Tiny JSON store for extension toggles. Deliberately not a database. */
export function readKV<T extends object>(name: string, fallback: T): T {
  const file = join(PATHS.home, `${name}.json`);
  try {
    if (!existsSync(file)) return fallback;
    return { ...fallback, ...(JSON.parse(readFileSync(file, 'utf8')) as T) };
  } catch {
    return fallback;
  }
}

export function writeKV(name: string, value: object) {
  mkdirSync(PATHS.home, { recursive: true, mode: 0o700 });
  writeFileSync(join(PATHS.home, `${name}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
}
