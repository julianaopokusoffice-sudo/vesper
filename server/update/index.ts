import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED } from '../kernel/paths.ts';
import { readKV, writeKV } from '../kernel/kv.ts';
import type { UpdateAsset, UpdateInfo } from '../../shared/types.ts';

/**
 * Update detection is deliberately independent of the auto-updater: the server
 * can compare versions and read release notes on every platform (web, phone,
 * desktop), while the Electron shell is the only surface that can actually
 * replace its own binary.
 *
 * The source is the repository's public GitHub Releases. A token is optional;
 * without one GitHub rate-limits anonymous checks, so results are cached for
 * six hours and a failure never breaks the app.
 */

const DEFAULT_REPO = 'julianaopokusoffice-sudo/vesper';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const LAST_FILE = 'update';

interface Stored {
  info?: UpdateInfo;
  checkedAt?: number;
}

let cached: UpdateInfo | null = null;
let inflight: Promise<UpdateInfo> | null = null;
let timer: NodeJS.Timeout | null = null;

function repoSlug(): string {
  if (process.env.VESPER_REPO) return process.env.VESPER_REPO.trim();
  try {
    const pkg = JSON.parse(readFileSync(join(BUNDLED.root, 'package.json'), 'utf8')) as {
      repository?: string | { url?: string };
    };
    const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const match = raw?.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    /* packaged builds may not expose package.json; fall through */
  }
  return DEFAULT_REPO;
}

export function currentUpdate(): UpdateInfo | null {
  if (cached) return cached;
  const stored = readKV<Stored>(LAST_FILE, {});
  cached = stored.info ?? null;
  return cached;
}

export function startUpdateChecks(currentVersion: string): void {
  if (timer) return;
  const schedule = () => {
    timer = setTimeout(() => {
      void checkForUpdate(currentVersion).finally(schedule);
    }, CHECK_INTERVAL);
    timer.unref?.();
  };
  // Let the runtime finish booting and serving before touching the network.
  setTimeout(() => {
    void checkForUpdate(currentVersion)
      .catch(() => undefined)
      .finally(schedule);
  }, 12_000).unref?.();
}

export function stopUpdateChecks(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export async function checkForUpdate(currentVersion: string, force = false): Promise<UpdateInfo> {
  const existing = currentUpdate();
  const fresh = existing && Date.now() - existing.checkedAt < CHECK_INTERVAL;
  if (!force && fresh) return existing!;

  if (inflight) return inflight;
  inflight = fetchLatest(currentVersion, repoSlug()).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function fetchLatest(currentVersion: string, repo: string): Promise<UpdateInfo> {
  const checkedAt = Date.now();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': `vesper/${currentVersion}`,
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) {
      return remember({
        currentVersion,
        repo,
        available: false,
        checkedAt,
        assets: [],
        error: 'No published release yet. The app will notice the first release automatically.',
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return remember({
        currentVersion,
        repo,
        available: false,
        checkedAt,
        assets: [],
        error: `GitHub answered ${response.status}. ${detail.includes('rate limit') ? 'Anonymous checks are rate-limited; set GITHUB_TOKEN to raise the limit.' : ''}`.trim(),
      });
    }

    const release = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      published_at?: string;
      prerelease?: boolean;
      assets?: { name?: string; browser_download_url?: string; size?: number }[];
    };

    const latestVersion = (release.tag_name ?? '').replace(/^v/i, '').trim();
    const assets: UpdateAsset[] = (release.assets ?? [])
      .filter((asset): asset is { name: string; browser_download_url: string; size?: number } =>
        Boolean(asset.name && asset.browser_download_url),
      )
      .map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size ?? 0,
        platform: platformOf(asset.name),
      }));

    return remember({
      currentVersion,
      latestVersion: latestVersion || undefined,
      available: Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0),
      releaseUrl: release.html_url,
      notes: (release.body ?? '').slice(0, 8_000),
      publishedAt: release.published_at ? Date.parse(release.published_at) : undefined,
      repo,
      assets,
      checkedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return remember({
      currentVersion,
      repo,
      available: false,
      checkedAt,
      assets: [],
      error: /timed? ?out|abort/i.test(message) ? 'GitHub did not answer in time.' : `Could not reach GitHub: ${message}`,
    });
  }
}

function remember(info: UpdateInfo): UpdateInfo {
  cached = info;
  try {
    writeKV(LAST_FILE, { info, checkedAt: info.checkedAt } satisfies Stored);
  } catch {
    /* a read-only home still gets the in-memory result */
  }
  return info;
}

/** -1, 0 or 1 for dotted numeric versions; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function platformOf(name: string): UpdateAsset['platform'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.apk')) return 'android';
  if (lower.endsWith('.exe') || lower.endsWith('.msi')) return 'windows';
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg')) return 'macos';
  if (lower.endsWith('.appimage') || lower.endsWith('.deb')) return 'linux';
  return 'other';
}
