#!/usr/bin/env node
/**
 * Assembles everything the Android app carries to run Vesper on-device:
 *
 *   android/app/src/main/assets/payload/
 *     server/server.mjs   the whole Express-less Hono server, bundled with its deps
 *     dist/**             the built web console
 *     data/**             built-in agents' skills and plugin examples
 *     package.json        marks the tree as ESM
 *     runtime.json        pinned runtime artifacts (see fetch-runtime.mjs)
 *
 * The server lives two levels below its package root because `paths.ts` resolves
 * the bundled `data/` directory as `../../` from `import.meta.url`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Call esbuild's JS API. Its `bin/esbuild` is a JS shim on Windows but the
// native ELF binary on Linux, so spawning it with `node` breaks CI there.
import { build as esbuildBuild } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'android', 'app', 'src', 'main', 'assets');
const payload = join(assets, 'payload');
const runtimeSource = join(root, 'android', 'runtime');

/** Run a package binary through Node itself: no shell, no .cmd shims. */
function runNodeTool(relativeEntry, args) {
  execFileSync(process.execPath, [join(root, 'node_modules', relativeEntry), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
}

console.log('\nVesper · Android payload\n');

console.log('1/4  building the web console');
runNodeTool('vite/bin/vite.js', ['build']);

console.log('2/4  bundling the server');
mkdirSync(join(root, 'build', 'mobile'), { recursive: true });
await esbuildBuild({
  entryPoints: [join(root, 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(root, 'build', 'mobile', 'server.mjs'),
  logLevel: 'warning',
});

console.log('3/4  assembling assets/payload');
mkdirSync(assets, { recursive: true });
rmSync(payload, { recursive: true, force: true });
mkdirSync(join(payload, 'server'), { recursive: true });
cpSync(join(root, 'build', 'mobile', 'server.mjs'), join(payload, 'server', 'server.mjs'));
cpSync(join(root, 'dist'), join(payload, 'dist'), { recursive: true });
cpSync(join(root, 'data'), join(payload, 'data'), { recursive: true });
writeFileSync(
  join(payload, 'package.json'),
  `${JSON.stringify({ name: 'vesper-node', private: true, type: 'module', version: '1.0.0' }, null, 2)}\n`,
);

console.log('4/4  staging the Linux runtime');
const runtimeManifest = join(runtimeSource, 'runtime.json');
if (existsSync(runtimeManifest)) {
  cpSync(runtimeManifest, join(assets, 'runtime.json'));
  const artifacts = join(runtimeSource, 'artifacts');
  if (existsSync(artifacts)) {
    cpSync(artifacts, join(assets, 'runtime', 'artifacts'), { recursive: true });
  }
  console.log('     runtime.json staged');
} else {
  for (const stale of [join(assets, 'runtime.json'), join(assets, 'runtime')]) {
    rmSync(stale, { recursive: true, force: true });
  }
  console.log('     no runtime.json — run `npm run mobile:runtime` first');
  console.log('     the APK will build, but refuse to install a Linux runtime until you do.');
}

console.log('\nPayload ready. Next: npx cap sync android\n');
