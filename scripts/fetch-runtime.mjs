#!/usr/bin/env node
/**
 * Pins the three binaries the Android app needs into `android/runtime/`:
 *
 *   rootfs  Ubuntu base (arm64)          the Linux userland PRoot boots
 *   node    Official Node.js (linux-arm64)  runs the Vesper server inside it
 *   proot   Alpine `proot-static`        the unprivileged chroot/ptrace layer
 *
 * Every file is downloaded once, hashed, and recorded in runtime.json. The app
 * refuses to install an artifact whose SHA-256 does not match, so this is the
 * one place that decides what code ends up running on a phone.
 *
 *   npm run mobile:runtime                  bundle artifacts into the APK (offline)
 *   npm run mobile:runtime -- --remote URL  point the app at a mirror instead
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.runtime-cache');
const outDir = join(root, 'android', 'runtime');
const artifactDir = join(outDir, 'artifacts');

const NODE_VERSION = '24.22.0';
const SOURCES = {
  rootfs: 'https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.3-base-arm64.tar.gz',
  node: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.gz`,
  // Alpine's package is a static aarch64 ELF, which is what makes it usable
  // outside Alpine at all: no musl loader to resolve on Android.
  proot: 'https://dl-cdn.alpinelinux.org/alpine/edge/community/aarch64/proot-static-5.4.0-r2.apk',
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const remote = flag('remote', null);
const rootfsSource = flag('rootfs', SOURCES.rootfs);
const nodeSource = flag('node', SOURCES.node);
const prootSource = flag('proot', SOURCES.proot);

function log(message) {
  process.stdout.write(`${message}\n`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function fetchTo(url, destination) {
  if (existsSync(destination) && !has('refresh')) {
    log(`  cached  ${destination.split(/[\\/]/).pop()}`);
    return destination;
  }
  log(`  fetch   ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
  log(`  saved   ${(buffer.length / 1_048_576).toFixed(1)} MB`);
  return destination;
}

/**
 * Alpine .apk files are gzipped tar archives. We only want one file out of it,
 * so hand that to the platform tar (old bsdtar on Windows handles gzip fine).
 */
function extractProot(apkPath, destination) {
  const work = join(tmpdir(), `vesper-proot-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    execFileSync('tar', ['-xzf', apkPath, '-C', work, 'usr/bin/proot.static'], { stdio: 'inherit' });
    const binary = join(work, 'usr/bin/proot.static');
    if (!existsSync(binary)) throw new Error('proot.static is missing from the Alpine package');
    const staged = join(work, 'proot');
    copyFileSync(binary, staged);
    // Repack as a one-file gzipped tar so the installer has a single format.
    execFileSync('tar', ['-czf', destination, '-C', work, 'proot'], { stdio: 'inherit' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  log('\nVesper · Android runtime\n');

  const rootfsCache = join(cacheDir, 'rootfs.tar.gz');
  await fetchTo(rootfsSource, rootfsCache);

  const nodeCache = join(cacheDir, 'node.tar.gz');
  await fetchTo(nodeSource, nodeCache);
  const nodeTop = execFileSync('tar', ['-tzf', nodeCache], { encoding: 'utf8' })
    .split('\n')[0]
    .split('/')[0];
  if (!nodeTop.startsWith('node-v')) {
    throw new Error(`Unexpected Node archive layout (top entry: ${nodeTop})`);
  }

  const prootCache = join(artifactDir, 'proot.tar.gz');
  if (!existsSync(prootCache) || has('refresh')) {
    const apkCache = join(cacheDir, 'proot.apk');
    await fetchTo(prootSource, apkCache);
    log('  extract usr/bin/proot.static → proot.tar.gz');
    extractProot(apkCache, prootCache);
  } else {
    log('  cached  proot.tar.gz');
  }

  if (!remote) {
    copyFileSync(rootfsCache, join(artifactDir, 'rootfs.tar.gz'));
    copyFileSync(nodeCache, join(artifactDir, 'node.tar.gz'));
  }

  const kinds = ['rootfs', 'proot', 'node'];
  const artifacts = kinds.map((kind) => {
    const file = join(artifactDir, `${kind}.tar.gz`);
    if (!remote) {
      return {
        kind,
        asset: `runtime/artifacts/${kind}.tar.gz`,
        sha256: sha256(file),
        bytes: statSync(file).size,
      };
    }
    const source = { rootfs: rootfsCache, proot: prootCache, node: nodeCache }[kind];
    return {
      kind,
      url: `${remote.replace(/\/+$/, '')}/${kind}.tar.gz`,
      sha256: sha256(source),
      bytes: statSync(source).size,
    };
  });

  const manifest = {
    version: 1,
    node: NODE_VERSION,
    generatedAt: new Date().toISOString(),
    notes: remote
      ? `Artifacts are downloaded from ${remote} on first run.`
      : 'Artifacts are bundled in the APK and verified on first run.',
    artifacts,
  };

  writeFileSync(join(outDir, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const bundled = remote
    ? 0
    : kinds.reduce((total, kind) => total + statSync(join(artifactDir, `${kind}.tar.gz`)).size, 0);
  log(`\nManifest → android/runtime/runtime.json`);
  for (const artifact of artifacts) {
    log(`  ${artifact.kind.padEnd(7)} ${artifact.sha256.slice(0, 16)}…  ${(artifact.bytes / 1_048_576).toFixed(1)} MB`);
  }
  if (bundled) log(`  bundled into the APK: ${(bundled / 1_048_576).toFixed(1)} MB`);
  log(remote ? '\nThe app will download these on first run.\n' : '\nBundled. Next: npm run mobile:assets\n');
}

main().catch((error) => {
  console.error(`\nfetch-runtime failed: ${error.message}\n`);
  process.exit(1);
});
